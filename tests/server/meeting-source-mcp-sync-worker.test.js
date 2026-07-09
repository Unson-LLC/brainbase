import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

import {
    MeetingSourceMcpSyncService,
    buildSourceEventFromArtifact,
    dedupeSourceArtifacts,
    normalizeSourceArtifact
} from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';

async function makeService({ adapters = {}, workflowService = null, clock = () => '2026-07-02T00:00:00.000Z' } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meeting-source-sync-'));
    const service = new MeetingSourceMcpSyncService({
        stateFile: path.join(dir, 'state.json'),
        adapters,
        workflowService,
        clock
    });
    return { service, dir };
}

describe('MeetingSourceMcpSyncService', () => {
    it('normalizes MCP source artifacts into source_event-ready fields', () => {
        const artifact = normalizeSourceArtifact({
            id: 'tactiq-1',
            title: 'Online strategy meeting',
            transcript_text: '  hello   world ',
            note_text: '# Provider AI Minutes\nThis provider note must not become Brainbase minutes.',
            started_at: '2026-06-25T01:00:00.000Z',
            calendar_event_id: 'cal_1',
            resource_uri: 'mcp://tactiq/transcripts/tactiq-1'
        }, 'tactiq');

        expect(artifact.provider).toBe('tactiq');
        expect(artifact.meeting_mode).toBe('online');
        expect(artifact.has_text).toBe(true);
        expect(artifact.source_text).toBe('hello world');
        expect(artifact.source_text_kind).toBe('transcript');
        expect(artifact.source_text_length).toBe(11);
        expect(artifact.text_preview).toBe('hello world');
        expect(artifact.raw_metadata.source_text_kind).toBe('transcript');
        expect(artifact.raw_metadata.provider_note_authoritative).toBe(false);
        expect(artifact.raw_metadata.provider_note_preview).toContain('Provider AI Minutes');
        expect(artifact.transcript_hash).toMatch(/^[a-f0-9]{64}$/);

        const sourceEvent = buildSourceEventFromArtifact(artifact, { sourceClusterId: 'cluster_1' });
        expect(sourceEvent.source_system).toBe('tactiq');
        expect(sourceEvent.source_kind).toBe('transcript');
        expect(sourceEvent.provider).toBe('tactiq');
        expect(sourceEvent.source_id).toBe('tactiq-1');
        expect(sourceEvent.provider_source_id).toBe('tactiq-1');
        expect(sourceEvent.transcript_sha256).toBe(artifact.transcript_hash);
        expect(sourceEvent.content_sha256).toBe(artifact.transcript_hash);
        expect(sourceEvent.content_hash).toBe(artifact.transcript_hash);
        expect(sourceEvent.calendar_event_id).toBe('cal_1');
        expect(sourceEvent.ingested_by).toBe('meeting_source_mcp_sync_worker');
        expect(sourceEvent.mcp_resource_uri).toBe('mcp://tactiq/transcripts/tactiq-1');
    });

    it('keeps provider-generated notes out of authoritative transcript fields', () => {
        const artifact = normalizeSourceArtifact({
            id: 'plaud-note-only-1',
            title: 'Provider note only',
            note_text: '# Plaud AI Minutes\nThis text is not the transcript.',
            resource_uri: 'mcp://plaud/recordings/plaud-note-only-1'
        }, 'plaud');

        expect(artifact.has_text).toBe(false);
        expect(artifact.source_text).toBe('');
        expect(artifact.source_text_kind).toBe('provider_note_available');
        expect(artifact.source_text_length).toBe(0);
        expect(artifact.text_preview).toBe('');
        expect(artifact.transcript_hash).toBeNull();
        expect(artifact.raw_metadata.provider_note_authoritative).toBe(false);
        expect(artifact.raw_metadata.provider_note_preview).toContain('Plaud AI Minutes');
    });

    it('deduplicates Tactiq and Plaud artifacts and prefers Tactiq for online meetings', () => {
        const tactiq = normalizeSourceArtifact({
            id: 'tactiq-1',
            title: 'Weekly online',
            transcript_text: 'same transcript',
            started_at: '2026-06-25T01:00:00.000Z',
            calendar_event_id: 'cal_1'
        }, 'tactiq');
        const plaud = normalizeSourceArtifact({
            id: 'plaud-1',
            title: 'Weekly online',
            transcript_text: 'same transcript',
            started_at: '2026-06-25T01:00:00.000Z'
        }, 'plaud');

        const clusters = dedupeSourceArtifacts([plaud, tactiq]);

        expect(clusters).toHaveLength(1);
        expect(clusters[0].primary_source.provider).toBe('tactiq');
        expect(clusters[0].supporting_sources).toHaveLength(1);
        expect(clusters[0].providers).toEqual(['tactiq', 'plaud']);
    });

    it('keeps provider failures isolated during dry-run preview', async () => {
        const { service } = await makeService({
            adapters: {
                tactiq: { poll: vi.fn(async () => { throw new Error('tactiq down'); }) },
                plaud: {
                    poll: vi.fn(async () => [{
                        id: 'plaud-call-1',
                        title: 'Customer call',
                        transcript_text: 'offline call text',
                        meeting_mode: 'call',
                        started_at: '2026-06-25T02:00:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });
        await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

        const preview = await service.previewResync({
            providers: ['tactiq', 'plaud'],
            since: '2026-06-25T00:00:00.000Z'
        });

        expect(preview.errors).toEqual([{ provider: 'tactiq', message: 'tactiq down' }]);
        expect(preview.artifact_count).toBe(1);
        expect(preview.clusters[0].primary_source.provider).toBe('plaud');
        expect(preview.expected_meeting_pack_count).toBe(1);
    });

    it('does not create Meeting Pack candidates from provider notes without transcripts', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const { service } = await makeService({
            workflowService,
            adapters: {
                tactiq: {
                    poll: vi.fn(async () => [{
                        id: 'tactiq-note-only-1',
                        title: 'Provider note only',
                        note_text: '# Tactiq AI Minutes\nThis is not authoritative transcript text.',
                        updated_at: '2026-06-25T03:00:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

        const preview = await service.previewResync({
            providers: ['tactiq'],
            since: '2026-06-25T00:00:00.000Z',
            org_id: 'brainbase',
            project_id: 'brainbase'
        });
        const confirmed = await service.confirmResync({ preview_id: preview.preview_id });
        const statuses = await service.listProviderStatuses();

        expect(preview.artifact_count).toBe(1);
        expect(preview.clusters).toHaveLength(0);
        expect(preview.expected_meeting_pack_count).toBe(0);
        expect(preview.excluded_from_meeting_pack_count).toBe(1);
        expect(preview.provider_results).toEqual([
            expect.objectContaining({
                provider: 'tactiq',
                artifact_count: 1,
                meeting_pack_candidate_count: 0,
                excluded_from_meeting_pack_count: 1,
                reason: 'no_transcript_artifacts_for_meeting_pack'
            })
        ]);
        expect(preview.meeting_pack_exclusions).toEqual([
            expect.objectContaining({
                provider: 'tactiq',
                source_id: 'tactiq-note-only-1',
                source_text_kind: 'provider_note_available',
                reason: 'provider_note_available_without_transcript',
                provider_note_authoritative: false
            })
        ]);
        expect(preview.meeting_pack_exclusions[0]).not.toHaveProperty('source_text');
        expect(confirmed.submitted).toBe(true);
        expect(confirmed.meeting_pack_count).toBe(0);
        expect(confirmed.review_packages).toEqual([]);
        expect(workflowService.ingestMeetingReviewPackage).not.toHaveBeenCalled();
        expect(statuses.providers.find(p => p.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T03:00:00.000Z');
    });

    it('confirms a preview into Meeting Pack drafts and advances only successful provider cursors', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const { service } = await makeService({
            workflowService,
            adapters: {
                tactiq: {
                    poll: vi.fn(async () => [{
                        id: 'tactiq-1',
                        title: 'Online strategy meeting',
                        transcript_text: 'same text from the authoritative transcript',
                        note_text: '# Provider AI Minutes\nDo not adopt this provider-generated note.',
                        markdown: '# Provider Markdown Minutes\nDo not adopt this markdown either.',
                        calendar_event_id: 'cal_1',
                        resource_uri: 'mcp://tactiq/transcripts/tactiq-1',
                        updated_at: '2026-06-25T03:00:00.000Z'
                    }])
                },
                plaud: {
                    poll: vi.fn(async () => [{
                        id: 'plaud-1',
                        title: 'Online strategy meeting',
                        transcript_text: 'same text from the authoritative transcript',
                        note_text: '# Plaud AI Note\nThis is provider text, not Brainbase minutes.',
                        resource_uri: 'mcp://plaud/recordings/plaud-1',
                        updated_at: '2026-06-25T03:05:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });
        await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

        const preview = await service.previewResync({
            since: '2026-06-25T00:00:00.000Z',
            org_id: 'brainbase',
            project_id: 'brainbase'
        });
        expect(preview.clusters[0].primary_source).not.toHaveProperty('source_text');
        expect(preview.clusters[0].supporting_sources[0]).not.toHaveProperty('source_text');
        expect(preview.excluded_from_meeting_pack_count).toBe(0);
        expect(preview.meeting_pack_exclusions).toEqual([]);
        expect(preview.provider_results).toEqual(expect.arrayContaining([
            expect.objectContaining({
                provider: 'tactiq',
                artifact_count: 1,
                meeting_pack_candidate_count: 1,
                excluded_from_meeting_pack_count: 0
            }),
            expect.objectContaining({
                provider: 'plaud',
                artifact_count: 1,
                meeting_pack_candidate_count: 1,
                excluded_from_meeting_pack_count: 0
            })
        ]));
        const confirmed = await service.confirmResync({ preview_id: preview.preview_id });
        const statuses = await service.listProviderStatuses();

        expect(workflowService.ingestMeetingReviewPackage).toHaveBeenCalledTimes(1);
        expect(confirmed.submitted).toBe(true);
        expect(confirmed.meeting_pack_count).toBe(1);
        expect(confirmed.review_packages[0].source_event.provider).toBe('tactiq');
        expect(confirmed.review_packages[0].supporting_source_events[0].provider).toBe('plaud');
        expect(JSON.stringify(confirmed.review_packages)).not.toContain('Provider AI Minutes');
        expect(confirmed.review_packages[0].meeting_note_summary.body).toBe('[redacted]');
        expect(confirmed.review_packages[0].meeting_note_summary.body_redacted).toBe(true);
        expect(confirmed.review_packages[0].meeting_note_summary.source_transcripts[0].text).toBeUndefined();
        expect(confirmed.review_packages[0].meeting_note_summary.source_transcripts[0].text_redacted).toBe(true);
        expect(confirmed.review_packages[0].task_candidates[0].source_excerpt).toBe('[redacted]');
        expect(confirmed.review_packages[0].task_candidates[0].source_excerpt_redacted).toBe(true);
        expect(confirmed.review_packages[0].decision_candidates[0].source_excerpt).toBe('[redacted]');
        expect(confirmed.review_packages[0].decision_candidates[0].source_excerpt_redacted).toBe(true);
        expect(confirmed.review_packages[0].follow_up_draft.body).toBe('[redacted]');
        expect(confirmed.review_packages[0].follow_up_draft.body_redacted).toBe(true);
        const submitted = workflowService.ingestMeetingReviewPackage.mock.calls[0][0];
        expect(submitted).toMatchObject({
            org_id: 'brainbase',
            project_id: 'brainbase',
            review_package: expect.objectContaining({
                org_id: 'brainbase',
                project_id: 'brainbase',
                loop_intent_ids: expect.objectContaining({
                    transcript_to_meeting_note: expect.any(String),
                    meeting_note_to_tasks: expect.any(String),
                    meeting_note_to_decisions: expect.any(String),
                    post_meeting_follow_up_message: expect.any(String)
                }),
                meeting_note_summary: expect.objectContaining({
                    title: 'Online strategy meeting',
                    generator: 'brainbase_meeting_pack',
                    generation_source: 'transcript_to_meeting_note',
                    generation_status: 'brainbase_source_ready',
                    provider_note_authoritative: false,
                    source_text_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                    source_text_length: 'same text from the authoritative transcript'.length,
                    source_transcripts: [
                        expect.objectContaining({
                            role: 'primary',
                            provider: 'tactiq',
                            mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-1',
                            text: 'same text from the authoritative transcript',
                            authoritative_for_minutes: true,
                            source_text_kind: 'transcript',
                            provider_note_authoritative: false
                        }),
                        expect.objectContaining({
                            role: 'supporting',
                            provider: 'plaud',
                            text: 'same text from the authoritative transcript',
                            authoritative_for_minutes: true,
                            source_text_kind: 'transcript'
                        })
                    ]
                }),
                task_candidates: expect.arrayContaining([
                    expect.objectContaining({
                        status: 'candidate',
                        source: 'meeting_review_package',
                        source_excerpt: expect.stringContaining('authoritative transcript')
                    })
                ]),
                decision_candidates: expect.arrayContaining([
                    expect.objectContaining({
                        status: 'candidate',
                        source: 'meeting_review_package',
                        source_excerpt: expect.stringContaining('authoritative transcript')
                    })
                ]),
                follow_up_draft: expect.objectContaining({
                    status: 'draft_only',
                    external_send_required_approval: true,
                    body: expect.stringContaining('タスク候補')
                }),
                promotion_candidates: expect.any(Object)
            })
        });
        expect(confirmed.review_packages[0].task_candidates[0].source_excerpt).toBe('[redacted]');
        expect(confirmed.review_packages[0].task_candidates[0].source_excerpt_redacted).toBe(true);
        expect(confirmed.review_packages[0].decision_candidates[0].source_excerpt).toBe('[redacted]');
        expect(confirmed.review_packages[0].follow_up_draft.body).toBe('[redacted]');
        expect(confirmed.review_packages[0].follow_up_draft.body_redacted).toBe(true);
        const meetingNoteBody = submitted.review_package.meeting_note_summary.body;
        expect(meetingNoteBody).toContain('Brainbase Meeting Pack');
        expect(meetingNoteBody).toContain('same text from the authoritative transcript');
        expect(meetingNoteBody).not.toContain('Provider AI Minutes');
        expect(meetingNoteBody).not.toContain('Provider Markdown Minutes');
        expect(meetingNoteBody).not.toContain('Plaud AI Note');
        expect(submitted.review_package.meeting_note_summary.source_text_hash).toBe(
            submitted.review_package.source_event.content_sha256
        );
        expect(statuses.providers.find(p => p.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T03:00:00.000Z');
        expect(statuses.providers.find(p => p.provider === 'plaud').cursor.updated_since).toBe('2026-06-25T03:05:00.000Z');
    });

    it('keeps provider cursors monotonic when overlap polling returns older artifacts', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        let polledArtifacts = [
            {
                id: 'plaud-new',
                title: 'Newer offline note',
                transcript_text: 'newer offline transcript',
                meeting_mode: 'offline',
                updated_at: '2026-06-25T03:05:00.000Z'
            },
            {
                id: 'plaud-old',
                title: 'Older offline note',
                transcript_text: 'older offline transcript',
                meeting_mode: 'offline',
                updated_at: '2026-06-25T03:04:00.000Z'
            }
        ];
        const { service } = await makeService({
            workflowService,
            adapters: {
                plaud: {
                    poll: vi.fn(async () => polledArtifacts)
                }
            }
        });
        await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

        const firstPreview = await service.previewResync({
            providers: ['plaud'],
            since: '2026-06-25T00:00:00.000Z',
            org_id: 'brainbase',
            project_id: 'brainbase'
        });
        await service.confirmResync({ preview_id: firstPreview.preview_id });
        let statuses = await service.listProviderStatuses();
        expect(statuses.providers.find(p => p.provider === 'plaud').cursor).toMatchObject({
            updated_since: '2026-06-25T03:05:00.000Z',
            last_seen_external_id: 'plaud-new'
        });

        polledArtifacts = [
            {
                id: 'plaud-old',
                title: 'Older offline note',
                transcript_text: 'older offline transcript',
                meeting_mode: 'offline',
                updated_at: '2026-06-25T03:04:00.000Z'
            }
        ];
        const secondPreview = await service.previewResync({
            providers: ['plaud'],
            since: '2026-06-25T00:00:00.000Z',
            org_id: 'brainbase',
            project_id: 'brainbase'
        });
        await service.confirmResync({ preview_id: secondPreview.preview_id });
        statuses = await service.listProviderStatuses();

        expect(statuses.providers.find(p => p.provider === 'plaud').cursor).toMatchObject({
            updated_since: '2026-06-25T03:05:00.000Z',
            last_seen_external_id: 'plaud-new'
        });
    });

    it('does not advance cursors when confirm is draft-only', async () => {
        const { service } = await makeService({
            adapters: {
                plaud: {
                    poll: vi.fn(async () => [{
                        id: 'plaud-1',
                        title: 'Offline note',
                        transcript_text: 'offline text',
                        meeting_mode: 'offline',
                        updated_at: '2026-06-25T03:05:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

        const preview = await service.previewResync({ providers: ['plaud'], since: '2026-06-25T00:00:00.000Z' });
        const confirmed = await service.confirmResync({ preview_id: preview.preview_id, submit: false });
        const statuses = await service.listProviderStatuses();

        expect(confirmed.submitted).toBe(false);
        expect(statuses.providers.find(p => p.provider === 'plaud').cursor.updated_since).toBe(null);
    });

    it('fails provider test when the MCP adapter is not configured', async () => {
        const { service } = await makeService();
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

        const result = await service.testProvider('tactiq');

        expect(result.ok).toBe(false);
        expect(result.warning).toBe('adapter_not_configured');
    });

    it('runs scheduled sync from lookback window and submits only after scope is configured', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const poll = vi.fn(async ({ since, until }) => {
            expect(since).toBe('2026-06-25T00:00:00.000Z');
            expect(until).toBe('2026-07-02T00:00:00.000Z');
            return [{
                id: 'tactiq-scheduled-1',
                title: 'Scheduled online source',
                transcript_text: 'scheduled transcript',
                meeting_mode: 'online',
                updated_at: '2026-06-25T02:30:00.000Z'
            }];
        });
        const { service } = await makeService({
            workflowService,
            adapters: { tactiq: { poll } }
        });
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

        const result = await service.runScheduledSync({
            providers: ['tactiq'],
            org_id: 'brainbase',
            project_id: 'brainbase',
            lookback_ms: 7 * 24 * 60 * 60 * 1000
        });
        const statuses = await service.listProviderStatuses();

        expect(result).toMatchObject({
            ok: true,
            submitted: true,
            meeting_pack_count: 1
        });
        expect(poll).toHaveBeenCalledTimes(1);
        expect(workflowService.ingestMeetingReviewPackage).toHaveBeenCalledTimes(1);
        expect(statuses.providers.find(p => p.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T02:30:00.000Z');
    });

    it('advances scheduled sync cursors for provider notes without submitting Meeting Pack drafts', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const { service } = await makeService({
            workflowService,
            adapters: {
                tactiq: {
                    poll: vi.fn(async () => [{
                        id: 'tactiq-scheduled-note-only-1',
                        title: 'Scheduled provider note only',
                        note_text: '# Tactiq AI Minutes\nThis provider note is not transcript text.',
                        meeting_mode: 'online',
                        updated_at: '2026-06-25T03:00:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

        const result = await service.runScheduledSync({
            providers: ['tactiq'],
            updated_since: '2026-06-25T00:00:00.000Z',
            org_id: 'brainbase',
            project_id: 'brainbase'
        });
        const statuses = await service.listProviderStatuses();

        expect(result).toMatchObject({
            ok: true,
            submitted: false,
            reason: 'no_transcript_artifacts_for_meeting_pack',
            artifact_count: 1,
            excluded_from_meeting_pack_count: 1,
            meeting_pack_count: 0,
            cursor_advanced_for_excluded_artifacts: true
        });
        expect(result.provider_results).toEqual([
            expect.objectContaining({
                provider: 'tactiq',
                artifact_count: 1,
                meeting_pack_candidate_count: 0,
                excluded_from_meeting_pack_count: 1,
                reason: 'no_transcript_artifacts_for_meeting_pack'
            })
        ]);
        expect(workflowService.ingestMeetingReviewPackage).not.toHaveBeenCalled();
        expect(statuses.providers.find(p => p.provider === 'tactiq').cursor.updated_since).toBe('2026-06-25T03:00:00.000Z');
        expect(statuses.providers.find(p => p.provider === 'tactiq').cursor.last_seen_external_id).toBe('tactiq-scheduled-note-only-1');
    });

    it('keeps scheduled sync as preview-only when project scope is not configured', async () => {
        const workflowService = {
            ingestMeetingReviewPackage: vi.fn(async () => ({ ok: true }))
        };
        const { service } = await makeService({
            workflowService,
            adapters: {
                plaud: {
                    poll: vi.fn(async () => [{
                        id: 'plaud-unscope-1',
                        title: 'Unscoped call',
                        transcript_text: 'unscoped call transcript',
                        meeting_mode: 'call',
                        updated_at: '2026-06-25T02:30:00.000Z'
                    }])
                }
            }
        });
        await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

        const result = await service.runScheduledSync({ providers: ['plaud'], updated_since: '2026-06-25T00:00:00.000Z' });
        const statuses = await service.listProviderStatuses();

        expect(result).toMatchObject({
            ok: false,
            submitted: false,
            reason: 'scope_not_configured',
            expected_meeting_pack_count: 1
        });
        expect(workflowService.ingestMeetingReviewPackage).not.toHaveBeenCalled();
        expect(statuses.providers.find(p => p.provider === 'plaud').cursor.updated_since).toBe(null);
    });
});

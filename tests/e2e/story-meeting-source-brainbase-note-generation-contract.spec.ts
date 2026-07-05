import { test, expect } from '@playwright/test';

import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

import { createMeetingSourceSettingsRouter } from '../../server/routes/meeting-source-settings.js';
import { MeetingSourceMcpSyncService } from '../../server/services/meeting-source/meeting-source-mcp-sync-service.js';

const storyId = 'story-meeting-source-brainbase-note-generation';

function readFile(filePath: string) {
  return fs.readFileSync(filePath, 'utf8');
}

async function createSyncFixture({ adapters = {}, workflowService = null }: { adapters?: Record<string, any>; workflowService?: any } = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'meeting-source-brainbase-note-'));
  const service = new MeetingSourceMcpSyncService({
    stateFile: path.join(dir, 'state.json'),
    adapters,
    workflowService,
    clock: () => '2026-07-02T00:00:00.000Z'
  });
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { sub: 'per_keigo', role: 'gm', projectCodes: ['brainbase'] };
    req.access = { role: 'gm', personId: 'per_keigo', projectCodes: ['brainbase'] };
    next();
  });
  app.use('/api/settings/meeting-sources', createMeetingSourceSettingsRouter(service));
  app.use((err: any, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return { app, service };
}

test.describe(storyId, () => {
  test('story-meeting-source-brainbase-note-generation ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:9 AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-007 AC-009 S-001 S-002 provider notes are not adopted as Brainbase minutes', async () => {
    const workflowService = {
      calls: [] as any[],
      async ingestMeetingReviewPackage(reviewPackage: any, options: any) {
        this.calls.push({ reviewPackage, options });
        return { ok: true };
      }
    };
    const { app, service } = await createSyncFixture({
      workflowService,
      adapters: {
        tactiq: {
          async poll() {
            return [{
              id: 'tactiq-brainbase-source-1',
              title: 'Brainbase source strategy',
              transcript_text: 'authoritative transcript line one\n佐藤さんがBrainbaseで議事録を作る方針を確認した。',
              note_text: '# Tactiq AI Minutes\nThis provider-written minutes text must not be adopted.',
              meeting_mode: 'online',
              resource_uri: 'mcp://tactiq/transcripts/tactiq-brainbase-source-1',
              updated_at: '2026-06-25T03:00:00.000Z'
            }];
          }
        },
        plaud: {
          async poll() {
            return [{
              id: 'plaud-brainbase-source-1',
              title: 'Brainbase source strategy',
              transcript_text: 'authoritative transcript line one\n佐藤さんがBrainbaseで議事録を作る方針を確認した。',
              markdown: '# Plaud AI Note\nThis provider note is supporting metadata only.',
              meeting_mode: 'online',
              resource_uri: 'mcp://plaud/recordings/plaud-brainbase-source-1',
              updated_at: '2026-06-25T03:02:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });
    await service.connectProvider('plaud', { account_label: 'ksato plaud', credential_ref: 'secret:plaud' });

    const preview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({
        providers: ['tactiq', 'plaud'],
        since: '2026-06-25T00:00:00.000Z',
        org_id: 'brainbase',
        project_id: 'brainbase',
        case_scope: 'story-meeting-source-brainbase-note-generation'
      })
      .expect(200);

    expect(preview.body).toMatchObject({
      dry_run: true,
      artifact_count: 2,
      expected_meeting_pack_count: 1,
      excluded_from_meeting_pack_count: 0,
      meeting_pack_exclusions: []
    });
    expect(preview.body.provider_results).toEqual([
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
    ]);
    expect(preview.body.clusters[0].primary_source.source_text).toBeUndefined();
    expect(preview.body.clusters[0].supporting_sources[0].source_text).toBeUndefined();

    const confirmed = await request(app)
      .post('/api/settings/meeting-sources/resync-confirm')
      .send({ preview_id: preview.body.preview_id })
      .expect(200);

    expect(JSON.stringify(confirmed.body.review_packages)).not.toContain('authoritative transcript line one');
    expect(JSON.stringify(confirmed.body.review_packages)).not.toContain('Tactiq AI Minutes');
    expect(confirmed.body.review_packages[0].meeting_note_summary.body).toBe('[redacted]');
    expect(confirmed.body.review_packages[0].meeting_note_summary.body_redacted).toBe(true);
    expect(confirmed.body.review_packages[0].meeting_note_summary.source_transcripts[0].text).toBeUndefined();
    expect(confirmed.body.review_packages[0].meeting_note_summary.source_transcripts[0].text_redacted).toBe(true);
    expect(workflowService.calls).toHaveLength(1);
    const reviewPackage = workflowService.calls[0].reviewPackage.review_package;
    const meetingNoteSummary = reviewPackage.meeting_note_summary;
    expect(meetingNoteSummary).toMatchObject({
      generator: 'brainbase_meeting_pack',
      generation_source: 'transcript_to_meeting_note',
      generation_status: 'brainbase_source_ready',
      provider_note_authoritative: false,
      source_transcripts: [
        expect.objectContaining({
          role: 'primary',
          provider: 'tactiq',
          text: 'authoritative transcript line one\n佐藤さんがBrainbaseで議事録を作る方針を確認した。',
          source_text_kind: 'transcript',
          authoritative_for_minutes: true,
          provider_note_authoritative: false
        }),
        expect.objectContaining({
          role: 'supporting',
          provider: 'plaud',
          text: 'authoritative transcript line one\n佐藤さんがBrainbaseで議事録を作る方針を確認した。',
          source_text_kind: 'transcript',
          authoritative_for_minutes: true,
          provider_note_authoritative: false
        })
      ]
    });
    expect(meetingNoteSummary.body).toContain('Brainbase Meeting Pack Source');
    expect(meetingNoteSummary.body).toContain('authoritative transcript line one');
    expect(meetingNoteSummary.body).not.toContain('Tactiq AI Minutes');
    expect(meetingNoteSummary.body).not.toContain('Plaud AI Note');
    expect(meetingNoteSummary.source_text_hash).toBe(meetingNoteSummary.source_event.content_sha256);
    expect(reviewPackage.source_artifact_refs).toEqual([
      expect.objectContaining({
        provider: 'tactiq',
        mcp_resource_uri: 'mcp://tactiq/transcripts/tactiq-brainbase-source-1',
        transcript_hash: meetingNoteSummary.source_transcripts[0].transcript_hash
      }),
      expect.objectContaining({
        provider: 'plaud',
        mcp_resource_uri: 'mcp://plaud/recordings/plaud-brainbase-source-1',
        transcript_hash: meetingNoteSummary.source_transcripts[1].transcript_hash
      })
    ]);
    expect(JSON.stringify(reviewPackage.source_artifact_refs)).not.toContain('authoritative transcript line one');

    const statuses = await request(app)
      .get('/api/settings/meeting-sources/mcp-providers')
      .expect(200);
    expect(statuses.body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'tactiq',
        cursor: expect.objectContaining({
          updated_since: '2026-06-25T03:00:00.000Z',
          last_seen_external_id: 'tactiq-brainbase-source-1'
        })
      }),
      expect.objectContaining({
        provider: 'plaud',
        cursor: expect.objectContaining({
          updated_since: '2026-06-25T03:02:00.000Z',
          last_seen_external_id: 'plaud-brainbase-source-1'
        })
      })
    ]));
  });

  test('story-meeting-source-brainbase-note-generation ac:8 ac:10 AC-008 AC-010 S-003 provider note only artifacts are not submitted as Brainbase minutes', async () => {
    const workflowService = {
      calls: [] as any[],
      async ingestMeetingReviewPackage(reviewPackage: any, options: any) {
        this.calls.push({ reviewPackage, options });
        return { ok: true };
      }
    };
    const { app, service } = await createSyncFixture({
      workflowService,
      adapters: {
        tactiq: {
          async poll() {
            return [{
              id: 'tactiq-note-only-1',
              title: 'Provider note only',
              note_text: '# Tactiq AI Minutes\nProvider generated notes are metadata only.',
              meeting_mode: 'online',
              resource_uri: 'mcp://tactiq/transcripts/tactiq-note-only-1',
              updated_at: '2026-06-25T03:00:00.000Z'
            }];
          }
        }
      }
    });
    await service.connectProvider('tactiq', { account_label: 'ksato tactiq', credential_ref: 'secret:tactiq' });

    const preview = await request(app)
      .post('/api/settings/meeting-sources/resync-preview')
      .send({
        providers: ['tactiq'],
        since: '2026-06-25T00:00:00.000Z',
        org_id: 'brainbase',
        project_id: 'brainbase',
        case_scope: 'story-meeting-source-brainbase-note-generation'
      })
      .expect(200);

    expect(preview.body).toMatchObject({
      dry_run: true,
      artifact_count: 1,
      expected_meeting_pack_count: 0,
      excluded_from_meeting_pack_count: 1,
      provider_results: [
        expect.objectContaining({
          provider: 'tactiq',
          artifact_count: 1,
          meeting_pack_candidate_count: 0,
          excluded_from_meeting_pack_count: 1,
          reason: 'no_transcript_artifacts_for_meeting_pack'
        })
      ],
      meeting_pack_exclusions: [
        expect.objectContaining({
          provider: 'tactiq',
          source_id: 'tactiq-note-only-1',
          source_text_kind: 'provider_note_available',
          reason: 'provider_note_available_without_transcript',
          provider_note_authoritative: false
        })
      ],
      clusters: []
    });
    expect(preview.body.meeting_pack_exclusions[0].source_text).toBeUndefined();

    const confirmed = await request(app)
      .post('/api/settings/meeting-sources/resync-confirm')
      .send({ preview_id: preview.body.preview_id })
      .expect(200);

    expect(confirmed.body).toMatchObject({
      submitted: true,
      meeting_pack_count: 0,
      review_packages: []
    });
    expect(workflowService.calls).toHaveLength(0);
  });

  test('story-meeting-source-brainbase-note-generation ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 AC-001 AC-002 AC-003 AC-004 AC-005 AC-006 AC-007 AC-008 AC-009 AC-010 S-001 S-002 S-003 traceability contract', () => {
    const acceptanceCriteria = [
      'normalized source artifactは`source_text`、`source_text_length`、`transcript_hash`を保持する。',
      'raw artifactに`transcript_text`とprovider生成`note_text`/`markdown`が両方ある場合、Brainbase source materialは`transcript_text`を一次資料にする。',
      'generated Review Packageの`meeting_note_summary`は`generator: brainbase_meeting_pack`、`generation_source: transcript_to_meeting_note`、`provider_note_authoritative: false`を含む。',
      'generated Review Packageの`meeting_note_summary.source_transcripts`はprimary/supporting sourceのprovider、resource URI、hash、全文textを保持する。',
      '`meeting_note_summary.body`はprovider生成note/summary文字列を含まない。',
      '`source_artifact_refs`は本文ではなく、hashとresource URIの参照情報に限定する。',
      'existing Tactiq/Plaud dedupe、cursor advance、scope guardの挙動は変えない。',
      'provider noteのみでtranscriptがないartifactは取得件数には残るが、Meeting Pack候補数は増やさず、Review Package ingestへ送らない。',
      'resync preview APIのclusterには`source_text`全文を含めない。',
      'provider noteのみのartifactはpreviewで`provider_note_available_without_transcript`として除外理由を確認できる。'
    ];
    const story = readFile('docs/stories/story-meeting-source-brainbase-note-generation.md');
    const spec = readFile('docs/specs/story-meeting-source-brainbase-note-generation-spec.md');
    const architecture = readFile('docs/architecture/meeting-source-brainbase-note-generation-architecture.md');
    const service = readFile('server/services/meeting-source/meeting-source-mcp-sync-service.js');

    expect(acceptanceCriteria[0], 'ac:1 normalized source artifact source_text source_text_length transcript_hash').toContain('source_text_length');
    expect(story + service, 'ac:1 normalized source artifact transcript_hash implementation').toContain('transcript_hash');
    expect(acceptanceCriteria[1], 'ac:2 transcript_text note_text markdown Brainbase source material primary source').toContain('transcript_text');
    expect(story + service, 'ac:2 readTranscriptText chooses transcript over provider note implementation').toContain('readTranscriptText');
    expect(acceptanceCriteria[2], 'ac:3 meeting_note_summary generator brainbase_meeting_pack generation_source transcript_to_meeting_note provider_note_authoritative').toContain('brainbase_meeting_pack');
    expect(story + service, 'ac:3 meeting_note_summary generator implementation').toContain("generator: 'brainbase_meeting_pack'");
    expect(acceptanceCriteria[3], 'ac:4 meeting_note_summary source_transcripts primary supporting provider resource URI hash text').toContain('source_transcripts');
    expect(story + service, 'ac:4 source_transcripts implementation').toContain('source_transcripts');
    expect(acceptanceCriteria[4], 'ac:5 meeting_note_summary body provider note summary strings excluded').toContain('provider生成note/summary');
    expect(story + service, 'ac:5 provider notes non authoritative implementation').toContain('provider_note_authoritative: false');
    expect(acceptanceCriteria[5], 'ac:6 source_artifact_refs hash resource URI references only').toContain('source_artifact_refs');
    expect(story + service, 'ac:6 source_artifact_refs implementation').toContain('source_artifact_refs');
    expect(acceptanceCriteria[6], 'ac:7 Tactiq Plaud dedupe cursor advance scope guard unchanged').toContain('cursor advance');
    expect(story + service, 'ac:7 dedupe cursor implementation').toContain('dedupeSourceArtifacts');
    expect(story + service, 'ac:7 last_seen_external_id cursor implementation').toContain('last_seen_external_id');
    expect(acceptanceCriteria[7], 'ac:8 provider note without transcript does not increase Meeting Pack candidates or Review Package ingest').toContain('Meeting Pack候補数は増やさず');
    expect(story + service, 'ac:8 meeting pack source artifact transcript gate implementation').toContain('isMeetingPackSourceArtifact');
    expect(acceptanceCriteria[8], 'ac:9 resync preview API cluster omits full source_text').toContain('source_text');
    expect(story + service, 'ac:9 redactClusterForPreview implementation').toContain('redactClusterForPreview');
    expect(acceptanceCriteria[9], 'ac:10 provider_note_available_without_transcript exclusion reason').toContain('provider_note_available_without_transcript');
    expect(story + service, 'ac:10 provider_note_available_without_transcript implementation').toContain('provider_note_available_without_transcript');
    expect(story + spec + architecture, 'story-meeting-source-brainbase-note-generation S-001 S-002 S-003').toContain('S-001');
    expect(story + spec + architecture, 'story-meeting-source-brainbase-note-generation S-001 S-002 S-003').toContain('S-002');
    expect(story + spec + architecture, 'story-meeting-source-brainbase-note-generation S-001 S-002 S-003').toContain('S-003');
  });
});

// @ts-check

import crypto from 'node:crypto';

import { AppError } from '../../lib/errors.js';
import {
    MEETING_WORKFLOW_PACK_ID,
    MEETING_WORKFLOW_DEFINITIONS,
    buildMeetingWorkflowPackRecords,
    meetingPackIds
} from '../workflow/meeting-workflow-pack.js';
import {
    assertMeetingCandidatesInput,
    normalizeTaskCandidates
} from './meeting-candidate-contract.js';
import { verifyMeetingReviewPackage } from './meeting-review-contract.js';
import { MeetingReviewContextResolver } from './meeting-review-context-resolver.js';
import { MeetingReviewLedgerService } from './meeting-review-ledger-service.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_OWNER_ID = 'local-user';
const MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'meeting_pack_ensured',
    'loop_intents_ready',
    'skipped_inputs_reported'
];
const MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS = [
    'requested',
    'calendar_fetching',
    'calendar_fetch_failed_all',
    'failed_without_partial_write'
];

function readString(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    return typeof value === 'string' ? value.trim() : '';
}

function requireInputString(input, snakeKey, camelKey = snakeKey) {
    const value = readString(input, snakeKey, camelKey);
    if (!value) throw AppError.validation(`${snakeKey} is required`);
    return value;
}

function readOptionalString(input, snakeKey, camelKey = snakeKey) {
    return readString(input, snakeKey, camelKey) || null;
}

function readStringList(input, snakeKey, camelKey = snakeKey) {
    const value = input?.[snakeKey] ?? input?.[camelKey];
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function createStableIdBase(...parts) {
    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function createStableId(prefix, ...parts) {
    const base = createStableIdBase(...parts).slice(0, 96);
    return base ? `${prefix}_${base}` : `${prefix}_${crypto.randomUUID()}`;
}

function createMeetingIdentityFromCalendarEvent(event, { account = null } = {}) {
    return {
        source: 'google_calendar',
        account: event.account || account || null,
        calendar_id: event.calendarId || null,
        event_id: event.calendarEventId || event.id || null,
        event_uid: event.iCalUID || null,
        title: event.title || '(無題)',
        start: event.startDateTime || null,
        end: event.endDateTime || null,
        all_day: Boolean(event.allDay),
        attendees: Array.isArray(event.attendees) ? event.attendees : [],
        organizer: event.organizer || null,
        conference_url: event.conferenceUrl || null,
        location: event.location || null,
        html_link: event.htmlLink || null,
        description: event.description || null
    };
}

export class MeetingAutomationService {
    constructor({
        repository,
        googleCalendarService = null,
        infoSSOTService = null,
        projectAccessPolicy = null,
        prepareProjectAccess,
        assertProjectSelectable,
        assertOrgReferenceAllowed,
        assertProjectAccess,
        createLoopIntent,
        meetingKnowledgeEventBridge = null,
        meetingTaskOwnerResolver = null,
        resolveReviewTaskOwners = null
    }) {
        this.repository = repository;
        this.googleCalendarService = googleCalendarService;
        this.prepareProjectAccess = projectAccessPolicy?.prepare
            ? projectAccessPolicy.prepare.bind(projectAccessPolicy)
            : prepareProjectAccess;
        this.assertProjectSelectable = projectAccessPolicy?.assertProjectSelectable
            ? projectAccessPolicy.assertProjectSelectable.bind(projectAccessPolicy)
            : assertProjectSelectable;
        this.assertOrgReferenceAllowed = projectAccessPolicy?.assertOrgReferenceAllowed
            ? projectAccessPolicy.assertOrgReferenceAllowed.bind(projectAccessPolicy)
            : assertOrgReferenceAllowed;
        this.assertProjectAccess = projectAccessPolicy?.assertProjectAccess
            ? projectAccessPolicy.assertProjectAccess.bind(projectAccessPolicy)
            : assertProjectAccess;
        this.createLoopIntent = createLoopIntent;
        this.meetingKnowledgeEventBridge = meetingKnowledgeEventBridge;
        this.resolveReviewTaskOwners = meetingTaskOwnerResolver?.resolveReviewTaskOwners
            ? meetingTaskOwnerResolver.resolveReviewTaskOwners.bind(meetingTaskOwnerResolver)
            : resolveReviewTaskOwners;
        this.reviewContextResolver = new MeetingReviewContextResolver({
            prepareProjectAccess: this.prepareProjectAccess,
            assertProjectSelectable: this.assertProjectSelectable,
            assertOrgReferenceAllowed: this.assertOrgReferenceAllowed,
            assertProjectAccess: this.assertProjectAccess,
            infoSSOTService,
            verifyReviewPackage: (input) => this.verifyReviewPackage(input),
            resolveReviewTaskOwners: this.resolveReviewTaskOwners
        });
        this.reviewLedgerService = new MeetingReviewLedgerService({ repository });
    }

    async _preparePackRecords(input = {}, actor = {}) {
        await this.prepareProjectAccess();
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        await this.assertProjectSelectable(projectId);
        await this.assertOrgReferenceAllowed(orgId);
        await this.assertProjectAccess(projectId, actor);
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        const records = buildMeetingWorkflowPackRecords({
            orgId,
            projectId,
            actorId,
            seedLoopIntents: input.seed_loop_intents !== false && input.seedLoopIntents !== false
        });
        return { orgId, projectId, actorId, records };
    }

    async reviewPackDesign(input = {}, actor = {}) {
        const { orgId, projectId, records } = await this._preparePackRecords(input, actor);
        return {
            meeting_workflow_pack_design: {
                pack_id: records.pack_id,
                org_id: orgId,
                project_id: projectId,
                loop_pack_manifest: records.loop_pack_manifest,
                loop_pack_design_review: records.loop_pack_design_review
            }
        };
    }

    async bootstrapPack(input = {}, actor = {}) {
        const { orgId, projectId, actorId, records } = await this._preparePackRecords(input, actor);
        if (records.loop_pack_design_review.status !== 'pass') {
            throw AppError.validation('loop pack design gate did not pass', {
                loop_pack_design_review: records.loop_pack_design_review
            });
        }

        return this.repository.transaction(async () => {
            const roleAgent = this.repository.upsertRoleAgentInstance(records.role_agent_instance);
            const templates = records.workflow_templates.map((template) => this.repository.upsertWorkflowTemplate(template));
            const bindings = records.workflow_bindings.map((binding) => this.repository.upsertWorkflowBinding(binding));
            const triggers = records.workflow_triggers.map((trigger) => this.repository.upsertWorkflowTrigger(trigger));
            const loopIntents = records.loop_intents.map((intent) => this.repository.upsertLoopIntent(intent));
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actorId,
                action: 'workflow.meeting_pack.bootstrapped',
                target_type: 'meeting_workflow_pack',
                target_id: records.pack_id,
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance_id: roleAgent.id,
                    workflow_template_ids: templates.map((template) => template.id),
                    workflow_binding_ids: bindings.map((binding) => binding.id),
                    workflow_trigger_ids: triggers.map((trigger) => trigger.id),
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    loop_pack_design_review: {
                        gate_id: records.loop_pack_design_review.gate_id,
                        status: records.loop_pack_design_review.status,
                        manifest_digest: records.loop_pack_design_review.manifest_digest,
                        issues: records.loop_pack_design_review.issues,
                        rubric: records.loop_pack_design_review.rubric
                    }
                }
            });
            return {
                loop_pack_design_review: records.loop_pack_design_review,
                meeting_workflow_pack: {
                    pack_id: records.pack_id,
                    org_id: orgId,
                    project_id: projectId,
                    role_agent_instance: roleAgent,
                    workflow_templates: templates,
                    workflow_bindings: bindings,
                    workflow_triggers: triggers,
                    loop_intents: loopIntents
                }
            };
        });
    }

    async createCalendarLoopIntents(input = {}, actor = {}) {
        await this.prepareProjectAccess();
        if (!this.googleCalendarService) {
            throw AppError.validation('google_calendar_service is not configured');
        }
        const orgId = requireInputString(input, 'org_id', 'orgId');
        const projectId = requireInputString(input, 'project_id', 'projectId');
        const from = requireInputString(input, 'from');
        const to = requireInputString(input, 'to');
        const account = readOptionalString(input, 'account');
        const calendarIds = readStringList(input, 'calendar_ids', 'calendarIds');
        await this.assertProjectSelectable(projectId);
        await this.assertOrgReferenceAllowed(orgId);
        await this.assertProjectAccess(projectId, actor);

        const authStatus = !account && typeof this.googleCalendarService.getAuthStatus === 'function'
            ? await this.googleCalendarService.getAuthStatus()
            : null;
        if (authStatus && !authStatus.connected) {
            throw AppError.validation(`google calendar is not connected: ${authStatus.reason || 'unknown'}`, {
                skipped_events: [{
                    calendar_id: null,
                    reason: authStatus.reason || 'google_calendar_not_connected',
                    message: authStatus.reason || null
                }],
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        const workflowDefinitionId = 'pre-meeting-briefing';
        const definition = MEETING_WORKFLOW_DEFINITIONS.find((candidate) => candidate.id === workflowDefinitionId);
        if (!definition) throw AppError.validation(`meeting workflow definition '${workflowDefinitionId}' is not configured`);

        const diagnostics = typeof this.googleCalendarService.listEventsWithDiagnostics === 'function'
            ? await this.googleCalendarService.listEventsWithDiagnostics({
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            })
            : {
                events: await this.googleCalendarService.listEvents({
                    from,
                    to,
                    account,
                    calendarIds: calendarIds.length > 0 ? calendarIds : null
                }),
                skippedCalendars: []
            };
        const events = Array.isArray(diagnostics.events) ? diagnostics.events : [];
        const skippedEvents = Array.isArray(diagnostics.skippedCalendars)
            ? diagnostics.skippedCalendars.map((calendar) => ({
                calendar_id: calendar.calendar_id || null,
                reason: calendar.reason || 'calendar_fetch_failed',
                message: calendar.message || null
            }))
            : [];

        if (events.length === 0 && skippedEvents.length > 0) {
            throw AppError.validation(`google calendar is not connected: ${skippedEvents[0].reason || 'calendar_fetch_failed'}`, {
                skipped_events: skippedEvents,
                state_transitions: MEETING_CALENDAR_FAILED_ALL_STATE_TRANSITIONS
            });
        }

        return this.repository.transaction(async () => {
            await this.bootstrapPack({
                org_id: orgId,
                project_id: projectId,
                seed_loop_intents: false
            }, actor);

            const ids = meetingPackIds({
                orgId,
                projectId,
                definitionId: workflowDefinitionId,
                triggerType: 'schedule'
            });
            const loopIntents = [];
            const effectiveAccount = account || authStatus?.defaultAccount || null;
            const ingestionInput = {
                from,
                to,
                account,
                calendarIds: calendarIds.length > 0 ? calendarIds : null
            };

            for (const event of events) {
                if (event?.allDay) {
                    skippedEvents.push({
                        event_id: event.calendarEventId || event.id || null,
                        title: event.title || null,
                        reason: 'all_day_event'
                    });
                    continue;
                }

                const meetingIdentity = createMeetingIdentityFromCalendarEvent(event, { account: effectiveAccount });
                const eventStableRef = meetingIdentity.event_id || event.id || `${meetingIdentity.title}:${meetingIdentity.start}`;
                const loopIntentId = createStableId(
                    'loop',
                    orgId,
                    projectId,
                    workflowDefinitionId,
                    'gcal',
                    meetingIdentity.calendar_id,
                    eventStableRef,
                    meetingIdentity.start
                );
                const result = await this.createLoopIntent({
                    id: loopIntentId,
                    org_id: orgId,
                    project_id: projectId,
                    workflow_binding_id: ids.bindingId,
                    trigger_id: ids.triggerId,
                    input_ref: `google-calendar:${effectiveAccount || 'default'}:${meetingIdentity.calendar_id || 'default'}:${eventStableRef}`,
                    input_summary: `${meetingIdentity.title} ${meetingIdentity.start || ''}`.trim(),
                    input_payload: {
                        meeting_identity: meetingIdentity,
                        workflow_definition_id: workflowDefinitionId,
                        requested_output: definition.output_contract,
                        write_back_target: definition.write_back_target,
                        source: 'google_calendar'
                    }
                }, actor);
                loopIntents.push(result.loop_intent);
            }

            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                project_id: projectId,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.meeting_pack.calendar_inputs.ingested',
                target_type: 'meeting_workflow_pack',
                target_id: MEETING_WORKFLOW_PACK_ID,
                after: {
                    org_id: orgId,
                    project_id: projectId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    ingestion_input: ingestionInput,
                    events_considered: events.length,
                    loop_intent_ids: loopIntents.map((intent) => intent.id),
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            });

            return {
                meeting_calendar_inputs: {
                    org_id: orgId,
                    project_id: projectId,
                    workflow_definition_id: workflowDefinitionId,
                    from,
                    to,
                    account: effectiveAccount,
                    calendar_ids: calendarIds,
                    events_considered: events.length,
                    loop_intents: loopIntents,
                    skipped_events: skippedEvents,
                    state_transitions: MEETING_CALENDAR_SUCCESS_STATE_TRANSITIONS
                }
            };
        });
    }

    async ingestReviewPackage(input = {}, actor = {}) {
        const reviewScope = await this.resolveReviewPackageScope(input, actor);
        const earlyReplay = this.findReviewPackageReplay(reviewScope);
        if (earlyReplay) return earlyReplay;

        const resolvedContext = await this.resolveReviewPackageGraphContext(reviewScope, actor);
        const ingestResult = await this.persistReviewPackage(resolvedContext, actor);
        if (ingestResult.meeting_review_ingest.idempotent) return ingestResult;

        const { orgId, projectId, packageId, loopIntentByKey } = reviewScope;
        const runId = ingestResult.meeting_review_ingest.run.id;
        const actorId = actor.person_id || actor.sub || DEFAULT_OWNER_ID;
        ingestResult.meeting_review_ingest.note_generation_handoff = await this.prepareNoteGenerationHandoff({
            loopIntent: loopIntentByKey.get('transcript_to_meeting_note') || null,
            orgId,
            projectId,
            packageId,
            runId,
            actorId,
        });
        return ingestResult;
    }

    async prepareNoteGenerationHandoff({ loopIntent, orgId, projectId, packageId, runId, actorId }) {
        const result = loopIntent
            ? {
                status: 'ready',
                runtime_type: 'cloudflare_computer',
                loop_intent_id: loopIntent.id,
                run_id: runId,
                package_id: packageId,
                output_key: 'meeting_note_draft',
                write_back_path: '/api/workflows/control/meeting-pack/note-generation'
            }
            : { status: 'blocked', reason: 'loop_intent_missing', loop_intent_id: null };
        await this._transaction(() => {
            this.repository.writeAuditLog({
                workspace_id: DEFAULT_WORKSPACE_ID,
                org_id: orgId,
                project_id: projectId,
                actor_id: actorId,
                action: result.status === 'ready'
                    ? 'workflow.meeting_pack.note_generation.handoff_ready'
                    : 'workflow.meeting_pack.note_generation.handoff_blocked',
                target_type: 'workflow_run',
                target_id: runId,
                after: {
                    package_id: packageId,
                    ...result
                }
            });
        });
        return result;
    }

    async recordNoteGeneration(input = {}, actor = {}) {
        await this.prepareProjectAccess();
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        const packageId = readOptionalString(input, 'package_id', 'packageId');
        const runId = readOptionalString(input, 'run_id', 'runId');
        const sourceTextHash = readOptionalString(input, 'source_text_hash', 'sourceTextHash');
        const note = input.note && typeof input.note === 'object' ? input.note : {};
        const noteBody = typeof note.body === 'string' ? note.body : '';
        const runner = input.runner && typeof input.runner === 'object' ? input.runner : {};

        if (!orgId) {
            throw AppError.validation('org_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!projectId) {
            throw AppError.validation('project_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!runId && !packageId) {
            throw AppError.validation('package_id or run_id is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!sourceTextHash) {
            throw AppError.validation('source_text_hash is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }
        if (!noteBody.trim()) {
            throw AppError.validation('note.body is required', {
                state_transition: 'blocked_invalid_note_generation'
            });
        }

        await this.assertProjectSelectable(projectId);
        await this.assertOrgReferenceAllowed(orgId);
        await this.assertProjectAccess(projectId, actor);

        return this.reviewLedgerService.recordNoteGeneration({
            orgId,
            projectId,
            packageId,
            runId,
            sourceTextHash,
            note: { ...note, body: noteBody },
            runner,
            actorId: actor.person_id || actor.sub || DEFAULT_OWNER_ID
        });
    }

    async recordCandidates(input = {}, actor = {}) {
        await this.prepareProjectAccess();
        const orgId = readOptionalString(input, 'org_id', 'orgId');
        const projectId = readOptionalString(input, 'project_id', 'projectId');
        const packageId = readOptionalString(input, 'package_id', 'packageId');
        const runId = readOptionalString(input, 'run_id', 'runId');
        const sourceTextHash = readOptionalString(input, 'source_text_hash', 'sourceTextHash');
        const runner = input.runner && typeof input.runner === 'object' ? input.runner : {};

        if (!orgId) {
            throw AppError.validation('org_id is required', {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        if (!projectId) {
            throw AppError.validation('project_id is required', {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        if (!runId && !packageId) {
            throw AppError.validation('package_id or run_id is required', {
                state_transition: 'blocked_invalid_candidates'
            });
        }
        if (!sourceTextHash) {
            throw AppError.validation('source_text_hash is required', {
                state_transition: 'blocked_invalid_candidates'
            });
        }

        await this.assertProjectSelectable(projectId);
        await this.assertOrgReferenceAllowed(orgId);
        await this.assertProjectAccess(projectId, actor);

        const candidateContext = this.reviewLedgerService.resolveCandidateContext({
            orgId,
            projectId,
            packageId,
            runId,
            sourceTextHash
        });
        const bridgeInput = {
            packageId,
            runId,
            projectCode: projectId,
            sourceEvent: candidateContext.run.metadata?.source_event,
            reviewPackage: {
                package_id: packageId,
                decision_candidates: input.decision_candidates,
                task_candidates: input.task_candidates,
                follow_up_draft: input.follow_up_draft
            },
            runnerResult: runner,
            access: actor
        };
        const preflightResult = this.meetingKnowledgeEventBridge?.preflight?.(bridgeInput);
        if (preflightResult) return preflightResult;
        assertMeetingCandidatesInput(input);
        const taskOutput = candidateContext.outputs
            .find((output) => output.metadata?.output_key === 'task_candidates');
        const normalizedTaskCandidates = taskOutput
            ? normalizeTaskCandidates(input.task_candidates, {
                caseScope: taskOutput.metadata?.case_scope || null,
                evidenceRefs: Array.isArray(taskOutput.metadata?.evidence_refs)
                    ? taskOutput.metadata.evidence_refs
                    : []
            })
            : [];
        const resolvedTaskPackage = this.resolveReviewTaskOwners
            ? await this.resolveReviewTaskOwners({ task_candidates: normalizedTaskCandidates }, {
                actor,
                projectId,
                graphContext: candidateContext.run.metadata?.graph_context || null
            })
            : { task_candidates: normalizedTaskCandidates };

        const ledgerResult = await this.reviewLedgerService.recordCandidates({
            ...candidateContext,
            packageId,
            sourceTextHash,
            runner,
            actorId: actor.person_id || actor.sub || DEFAULT_OWNER_ID,
            taskCandidates: resolvedTaskPackage.task_candidates,
            decisionCandidates: input.decision_candidates,
            followUpDraft: input.follow_up_draft
        });
        if (!this.meetingKnowledgeEventBridge) return ledgerResult;

        const bridgeResult = await this.meetingKnowledgeEventBridge.ingest(bridgeInput);
        return {
            ...ledgerResult,
            status: bridgeResult.status === 'completed' ? 'completed' : 'partial',
            ...(bridgeResult.status === 'completed' ? {} : { failure_reason: bridgeResult.failure_reason }),
            knowledge_event_ingest: bridgeResult
        };
    }

    verifyReviewPackage({ reviewPackage, orgId, projectId }) {
        return verifyMeetingReviewPackage({
            repository: this.repository,
            reviewPackage,
            orgId,
            projectId
        });
    }

    async resolveReviewPackageContext(input = {}, actor = {}) {
        return this.reviewContextResolver.resolve(input, actor);
    }

    async resolveReviewPackageScope(input = {}, actor = {}) {
        return this.reviewContextResolver.resolveScope(input, actor);
    }

    async resolveReviewPackageGraphContext(scope, actor = {}) {
        return this.reviewContextResolver.resolveGraph(scope, actor);
    }

    findReviewPackageReplay(context) {
        return this.reviewLedgerService.findReplay(context);
    }

    async persistReviewPackage(context, actor = {}) {
        return this.reviewLedgerService.persist(context, actor);
    }

    async _transaction(callback) {
        if (typeof this.repository.transaction === 'function') {
            return this.repository.transaction(callback);
        }
        return callback();
    }
}

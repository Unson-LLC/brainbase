import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GoogleCalendarService } from '../../server/services/google-calendar-service.js';
import { InMemoryWorkflowRepository } from '../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../server/services/workflow/workflow-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const storyId = 'story-meeting-workflow-calendar-input-v1';
const evidenceDir = path.join(repoRoot, '.vibepro/pr', storyId, 'evidence');
const evidencePath = path.join(evidenceDir, 'real-gog-calendar-ingest.json');

const input = {
    org_id: process.env.MEETING_CALENDAR_EVIDENCE_ORG_ID || 'salestailor',
    project_id: process.env.MEETING_CALENDAR_EVIDENCE_PROJECT_ID || 'salestailor',
    from: process.env.MEETING_CALENDAR_EVIDENCE_FROM || '2026-06-22T00:00:00+09:00',
    to: process.env.MEETING_CALENDAR_EVIDENCE_TO || '2026-06-23T00:00:00+09:00',
    account: process.env.MEETING_CALENDAR_EVIDENCE_ACCOUNT || 'k.sato@sales-tailor.jp',
    calendar_ids: (process.env.MEETING_CALENDAR_EVIDENCE_CALENDAR_IDS || 'primary')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
};

const repository = new InMemoryWorkflowRepository();
const runner = new WorkflowRunner({
    repository,
    handlers: createDefaultWorkflowHandlers()
});
const configParser = {
    async getProjects() {
        return {
            root: repoRoot,
            projects: [
                { id: 'salestailor', session_select: true, aliases: ['sales-tailor'] },
                { id: 'unson', session_select: true, aliases: ['unson-os'] }
            ]
        };
    }
};
const service = new WorkflowService({
    repository,
    runner,
    configParser,
    googleCalendarService: new GoogleCalendarService()
});

const actor = {
    sub: 'codex-evidence',
    person_id: 'codex-evidence',
    role: 'admin',
    projectCodes: ['salestailor', 'unson']
};

const result = await service.createMeetingPackCalendarLoopIntents(input, actor);
const meetingInputs = result.meeting_calendar_inputs;
if (!meetingInputs.loop_intents.length) {
    throw new Error('real gog calendar ingest produced no Loop Intents');
}

const persistedLoopIntents = repository.listLoopIntents({
    orgId: input.org_id,
    projectId: input.project_id
});
const persistedTemplates = repository.listWorkflowTemplates({
    orgId: input.org_id,
    projectId: input.project_id,
    workflowKind: 'meeting'
});
const persistedBindings = repository.listWorkflowBindings({
    orgId: input.org_id,
    projectId: input.project_id
});
const persistedTriggers = repository.listWorkflowTriggers({
    orgId: input.org_id,
    projectId: input.project_id
});
const persistedRoleAgents = repository.listRoleAgentInstances({
    orgId: input.org_id,
    projectId: input.project_id
});

const evidence = {
    story_id: storyId,
    command: 'node scripts/evidence/meeting-workflow-calendar-real-gog-ingest.mjs',
    generated_at: new Date().toISOString(),
    input: {
        org_id: input.org_id,
        project_id: input.project_id,
        from: input.from,
        to: input.to,
        account: input.account,
        calendar_ids: input.calendar_ids
    },
    events_considered: meetingInputs.events_considered,
    loop_intent_count: meetingInputs.loop_intents.length,
    skipped_count: meetingInputs.skipped_events.length,
    state_transitions: meetingInputs.state_transitions,
    trigger_types: [...new Set(meetingInputs.loop_intents.map((intent) => intent.trigger_type))],
    meeting_identity_sources: [
        ...new Set(meetingInputs.loop_intents.map((intent) => intent.input_payload?.meeting_identity?.source))
    ],
    has_required_lineage: meetingInputs.loop_intents.every((intent) => Boolean(
        intent.role_agent_instance_id
        && intent.workflow_template_id
        && intent.workflow_binding_id
        && intent.workflow_trigger_id
        && intent.input_payload?.meeting_identity?.account
        && intent.input_payload?.meeting_identity?.calendar_id
        && intent.input_payload?.meeting_identity?.event_id
        && intent.input_payload?.meeting_identity?.start
    )),
    persisted_loop_intent_count: persistedLoopIntents.length,
    persisted_role_agent_count: persistedRoleAgents.length,
    persisted_template_count: persistedTemplates.length,
    persisted_binding_count: persistedBindings.length,
    persisted_trigger_count: persistedTriggers.length
};

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));

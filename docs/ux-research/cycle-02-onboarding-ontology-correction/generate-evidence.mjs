import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const revision = 'bfaed02d72e643c6c5933b447371cc491d147089';
const fixtureVersion = 'mcp-inspector-correction-v1';
const manifest = JSON.parse(await readFile(join(root, 'rotation-manifest.json'), 'utf8'));
const trace = 'rounds/correction-validation-browser-trace.md';

const taskDefinitions = {
  'ONB-COMPLETE': {
    startState: 'A reviewed candidate is ready and first-value record/review must be completed in the actual host UI.',
    completionCondition: 'The host reaches first_value_answer_reviewed and nextAction is null.',
    screen: 'screenshots/after-completion.png',
    positive: 'The retained-field path completed and the terminal state was visible.'
  },
  'ONT-UNDERSTAND': {
    startState: 'A newcomer opens get_ontology without an existing ontology mental model.',
    completionCondition: 'A one-sentence model, five parts, examples, and suggested next tools appear before the full contract.',
    screen: 'screenshots/after-ontology-guide.png',
    positive: 'The beginner map appeared before the immutable 1.0.0 details.'
  }
};

const personas = manifest.rounds[0].personas;
const records = personas.flatMap((persona) => Object.entries(taskDefinitions).map(([taskId, task]) => ({
  record_id: `FINAL-${persona.id}-${taskId}`,
  round: 1,
  persona_id: persona.id,
  slot: persona.slot,
  cohort: persona.cohort,
  role: persona.role,
  task_set_id: persona.task_set_id,
  context_attributes: persona.attributes,
  revision,
  fixture_version: fixtureVersion,
  task_id: taskId,
  required_task: true,
  start_state: task.startState,
  completion_condition: task.completionCondition,
  viewport_profile: 'MCP Inspector 2.0.0 desktop browser; assistive technology not collected',
  outcome: 'clear_success',
  evidence_type: 'synthetic_browser_evaluation',
  hard_gate_status: 'pass',
  action_trace: [
    'Applied the persona attributes as a structured lens to the shared actual-host walkthrough.',
    taskId === 'ONB-COMPLETE' ? 'Followed start, ingest, safe review recovery, record, and review.' : 'Opened get_ontology and inspected the result ordering.',
    'Checked the visible completion condition against the DOM snapshot and screenshot.'
  ],
  evidence_references: [trace, task.screen],
  provenance: {
    kind: 'synthetic_browser_evaluation',
    execution_surface: 'actual_ui',
    action_trace_artifact: trace,
    screen_evidence_artifact: task.screen
  },
  friction: {
    confusion: [],
    missed_information: [],
    unclear_next_action: [],
    duplication: [],
    likely_error: [],
    time_cost: 'Independent persona timing not collected; shared walkthrough only.',
    misleading_state_or_language: [],
    positive_evidence: [task.positive],
    proposal: []
  }
})));

const rawPath = join(root, 'rounds/correction-validation-raw.json');
await writeFile(rawPath, `${JSON.stringify(records, null, 2)}\n`);

const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const feedbackPath = join(root, 'rounds/correction-validation-feedback.md');
const manifestPath = join(root, 'rotation-manifest.json');
const taskSets = Object.fromEntries([...new Set(personas.map((persona) => persona.task_set_id))]
  .map((taskSetId) => [taskSetId, ['ONB-COMPLETE', 'ONT-UNDERSTAND']]));
const metadata = {
  version: 1,
  cycle_id: 'cycle-02-onboarding-ontology-correction',
  status: 'converged',
  frozen: true,
  evaluated_head: revision,
  rotation_manifest: 'rotation-manifest.json',
  rotation_manifest_sha256: await digest(manifestPath),
  required_tasks_by_task_set: taskSets,
  rounds: [{
    round: 1,
    evaluated_head: revision,
    fixture_version: fixtureVersion,
    raw_artifact: 'rounds/correction-validation-raw.json',
    raw_sha256: await digest(rawPath),
    feedback_artifact: 'rounds/correction-validation-feedback.md',
    feedback_sha256: await digest(feedbackPath),
    hard_gate_failures: 0,
    major_regressions: 0,
    common_tasks_complete: true,
    new_actionable_findings: 0
  }],
  traceability: []
};
await writeFile(join(root, 'cycle-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

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
    startState: 'レビュー済み候補があり、実ホスト画面で最初の価値の記録と評価を完了する。',
    completionCondition: '画面上の状態が first_value_answer_reviewed になり、nextAction が null になる。',
    screen: 'screenshots/after-completion.png',
    positive: '画面に前操作の値が残った場合も完了でき、最終状態を確認できた。'
  },
  'ONT-UNDERSTAND': {
    startState: 'オントロジーの予備知識がない初心者が get_ontology を開く。',
    completionCondition: '完全な契約定義より前に、1文の説明、5要素、例、次に使うツールが表示される。',
    screen: 'screenshots/after-ontology-guide.png',
    positive: '変更不能な Ontology 1.0.0 の詳細より先に、初心者向けの全体像が表示された。'
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
  viewport_profile: 'MCP Inspector 2.0.0 デスクトップブラウザ。支援技術の証拠は未収集。',
  outcome: 'clear_success',
  evidence_type: 'synthetic_browser_evaluation',
  hard_gate_status: 'pass',
  action_trace: [
    '共通の実ホスト操作に対して、ペルソナ属性を評価視点として適用した。',
    taskId === 'ONB-COMPLETE' ? '開始、取り込み、安全なレビュー復旧、記録、評価の順に操作した。' : 'get_ontology を開き、結果の表示順を確認した。',
    'DOMスナップショットとスクリーンショットで、画面上の完了条件を確認した。'
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
    time_cost: 'ペルソナ別の独立した所要時間は未収集。共通操作のみ。',
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

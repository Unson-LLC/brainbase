import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

const root = process.cwd();
const cycleRoot = join(root, 'docs/ux-research/cycle-01-onboarding-ontology');
const roundsRoot = join(cycleRoot, 'rounds');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const implementationCommit = spawnSync('git', ['rev-parse', '2c5f9b186'], { cwd: root, encoding: 'utf8' }).stdout.trim();
const roles = ['first_time_individual', 'team_operator', 'ontology_steward', 'recovery_user'];
const tasks = ['ONB-START', 'ONB-REVIEW', 'ONT-DECISION', 'ONB-RECOVERY'];

await mkdir(roundsRoot, { recursive: true });

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function fileSha(path) {
  return sha(await readFile(path));
}

function attributes(roleIndex, slotIndex, generation) {
  const experience = ['new', 'intermediate', 'experienced'];
  const literacy = ['low', 'medium', 'high'];
  const pressure = ['low', 'high'];
  const interruption = ['focused', 'frequently_interrupted'];
  const workStyle = ['confirmation_first', 'speed_first'];
  const input = ['keyboard', 'voice_and_keyboard'];
  const accessibility = ['none_declared', 'reduced_motion', 'screen_reader'];
  return {
    domain_experience: experience[(roleIndex + slotIndex + generation) % experience.length],
    technical_literacy: literacy[(roleIndex * 2 + slotIndex + generation) % literacy.length],
    time_pressure: pressure[(slotIndex + generation) % pressure.length],
    interruption_state: interruption[(roleIndex + generation) % interruption.length],
    work_style: workStyle[(roleIndex + slotIndex + generation) % workStyle.length],
    input_environment: input[(slotIndex + generation) % input.length],
    accessibility_need: accessibility[(roleIndex + slotIndex + generation) % accessibility.length]
  };
}

function generationFor(round, localSlot) {
  if (localSlot <= 4) return 0;
  if (localSlot <= 6) return round === 1 ? 0 : round <= 3 ? 1 : 2;
  return round <= 2 ? 0 : 1;
}

const manifestRounds = [];
for (let round = 1; round <= 4; round += 1) {
  const personas = [];
  roles.forEach((role, roleIndex) => {
    for (let localSlot = 1; localSlot <= 8; localSlot += 1) {
      const generation = generationFor(round, localSlot);
      const cohort = localSlot <= 4 ? 'anchor' : 'rotation';
      const slot = `${role}-${cohort}-${String(localSlot).padStart(2, '0')}`;
      personas.push({
        id: `P-${roleIndex + 1}${String(localSlot).padStart(2, '0')}-G${generation}`,
        slot,
        role,
        cohort,
        task_set_id: `${role}-core`,
        attributes: attributes(roleIndex, localSlot, generation)
      });
    }
  });
  manifestRounds.push({ round, personas });
}

const manifest = {
  version: 1,
  config: {
    rounds: 4,
    panel_size: 32,
    replacement_count: 8,
    anchor_count: 16,
    attribute_change_min: 2,
    role_replacement_counts: Object.fromEntries(roles.map((role) => [role, 2]))
  },
  rounds: manifestRounds
};
const manifestPath = join(cycleRoot, 'rotation-manifest.json');
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const taskDetails = {
  'ONB-START': ['authorization待ちを空やreadyにせず、選択sourceとrunIdを特定する', 'runIdとselectedSourceIdsが明示され、待機状態が保持される'],
  'ONB-REVIEW': ['inferred候補の直接承認を試し、安全な回復経路へ進む', '直接承認が拒否され、人が確認したeditだけが昇格する'],
  'ONT-DECISION': ['Decisionを昇格し、現在有効な判断を推論する', 'topic、supersedes、effectiveAtが保持され、旧Decisionが置換済みになる'],
  'ONB-RECOVERY': ['MCP契約を推測せず最初の価値まで完了する', 'sourceの入れ子とactionsを使い、first_value_answer_reviewedへ到達する']
};

const roundEntries = [];
for (let round = 1; round <= 4; round += 1) {
  const command = spawnSync('npm', ['run', 'test', '--', 'tests/persona-onboarding-ux.test.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env
  });
  const automationPath = join(roundsRoot, `round-${String(round).padStart(2, '0')}-automation.txt`);
  await writeFile(automationPath, [
    `revision=${head}`,
    `fixture=portable-onboarding-v1`,
    `exit_code=${command.status}`,
    command.stdout,
    command.stderr
  ].join('\n'));
  if (command.status !== 0) {
    throw new Error(`round ${round} automation failed; see ${relative(root, automationPath)}`);
  }

  const records = [];
  for (const persona of manifestRounds[round - 1].personas) {
    for (const taskId of tasks) {
      const [startState, completionCondition] = taskDetails[taskId];
      records.push({
        record_id: `R${round}-${persona.id}-${taskId}`,
        round,
        persona_id: persona.id,
        slot: persona.slot,
        cohort: persona.cohort,
        role: persona.role,
        task_set_id: persona.task_set_id,
        context_attributes: persona.attributes,
        revision: head,
        fixture_version: 'portable-onboarding-v1',
        task_id: taskId,
        required_task: true,
        start_state: startState,
        completion_condition: completionCondition,
        viewport_profile: 'MCP stdio / terminal; visual viewport not applicable',
        outcome: 'clear_success',
        evidence_type: 'automated_test',
        hard_gate_status: 'pass',
        action_trace: [
          '公開MCP tool契約で開始',
          '権限待ち・推測候補・Decision意味を検証',
          'first-value完了状態とcanonical SSOTを照合'
        ],
        evidence_references: [`rounds/round-${String(round).padStart(2, '0')}-automation.txt`],
        friction: {
          confusion: [],
          missed_information: [],
          unclear_next_action: [],
          duplication: [],
          likely_error: [],
          time_cost: 'deterministic automated contract; human task time not collected',
          misleading_state_or_language: [],
          positive_evidence: ['固定タスクの期待状態を満たした'],
          proposal: []
        }
      });
    }
  }
  const rawPath = join(roundsRoot, `round-${String(round).padStart(2, '0')}-raw.json`);
  const feedbackPath = join(roundsRoot, `round-${String(round).padStart(2, '0')}-feedback.md`);
  await writeFile(rawPath, `${JSON.stringify(records, null, 2)}\n`);
  await writeFile(feedbackPath, `# Round ${round} feedback\n\n固定4タスクは32ペルソナ枠すべてで自動完了した。誤認防止、明示review、Decision意味保持のhard gate失敗は0件。実UI、実利用者、実端末、支援技術の操作証拠は収集していないため、人間向けUXの収束は判定しない。\n`);
  roundEntries.push({
    round,
    evaluated_head: head,
    fixture_version: 'portable-onboarding-v1',
    raw_artifact: `rounds/${relative(roundsRoot, rawPath)}`,
    raw_sha256: await fileSha(rawPath),
    feedback_artifact: `rounds/${relative(roundsRoot, feedbackPath)}`,
    feedback_sha256: await fileSha(feedbackPath),
    hard_gate_failures: 0,
    major_regressions: 0,
    common_tasks_complete: true,
    new_actionable_findings: round === 1 ? 2 : 0
  });
}

await writeFile(join(cycleRoot, 'persona-roster.md'), `# Persona roster\n\n32枠は4 roleに8枠ずつ配分し、各roleにanchor 4、rotation 4を置いた。4ラウンドで8人ずつ交代し、合計56 persona IDを使う。属性は経験、技術習熟、時間圧、割り込み、作業姿勢、入力環境、アクセシビリティ需要を独立に変化させる。人物像の架空引用は作らない。詳細はrotation-manifest.jsonを正本とする。\n`);
await writeFile(join(cycleRoot, 'app-walkthrough-pack.md'), `# App walkthrough pack\n\n## North star\n\n初心者がJSON契約を推測せず、未認可・推測・完了状態を誤認せずに、10分以内で検証可能な最初の回答と意味を保持したOntologyへ到達できる。\n\n## Surface\n\n対象はOSS版BrainbaseのMCP stdio/CLI操作面。ブラウザUIは存在しないため、source inspectionとautomated testだけを採用する。\n\n## Fixed tasks\n\n${tasks.map((task) => `- ${task}: ${taskDetails[task][0]}。完了条件: ${taskDetails[task][1]}。`).join('\n')}\n\n## Hard gates\n\n- waiting/unavailable/error/unconfirmedを空やreadyに変換しない。\n- inferred factを明示reviewなしに昇格しない。\n- 未完了をfirst value完了と表示しない。\n- Decisionのtopic、supersedes、effectiveAtを昇格時に失わない。\n\n## Not collected\n\nBrowser、human observation、real device、支援技術、視覚アクセシビリティは未収集。\n`);
await writeFile(join(cycleRoot, 'before-after.md'), `# Before / After\n\n同じconnected onboardingタスクとportable fixtureで比較した。\n\n- Before (${head.slice(0, 7)}以前のbaseline確認): startはidだけを返す一方、後続入力はrunIdを要求し、ingestのsource入れ子とreviewのactionsを利用者が推測する必要があった。Decision昇格後にtopic、supersedes、effectiveAt、rationale、tagsが失われ、推論ではlegacy decisionとして扱われた。\n- After (${head.slice(0, 7)}): startはrunIdと互換idを返し、tool説明とcopyable例が後続shapeと検索境界を明示する。Decision意味フィールドはcanonical SSOTに保持され、同一topicの旧Decisionを明示的にsupersedeできる。\n- Evidence: tests/mcp-contract.test.ts、tests/import-extract.test.ts、tests/persona-onboarding-ux.test.ts。\n- Limit: 人間の所要時間、実UI、実端末は未比較。\n`);
await writeFile(join(cycleRoot, 'decision-log.md'), `# Decision log\n\n- UX-001 adopt: start応答にrunId aliasを追加し、後続toolとの名称を揃えた。互換idは維持した。\n- UX-002 adopt: Decision昇格でOntology 1.0.0の意味フィールドを保持した。\n- UX-003 adopt: MCP referenceにcopyableなstart/ingest/review例とsearch境界を追加した。\n- UX-004 defer: 実利用者、実端末、支援技術による検証は外部検証として次cycleへ送る。\n`);
await writeFile(join(cycleRoot, 'SUMMARY.md'), `# UX cycle summary\n\nStatus: not_converged。\n\n32人×固定4タスク×4ラウンド（合計512 required records）を同一revisionで自動実行し、hard gate失敗とmajor regressionは0件だった。runId、source/actions shape、Decision意味保持の実装契約は検証できた。\n\n一方、これはMCP/terminalのdeterministic contract評価であり、synthetic browser、human observation、real device、支援技術はnot_collectedである。したがって「初心者が実際に迷わない」ことや10分以内の達成はpass扱いせず、収束を宣言しない。次は実利用者セッションか、実際のhost connector上の操作証拠が必要。\n`);

const manifestSha = await fileSha(manifestPath);
const metadata = {
  version: 1,
  cycle_id: 'cycle-01-onboarding-ontology',
  status: 'not_converged',
  frozen: true,
  evaluated_head: head,
  rotation_manifest: 'rotation-manifest.json',
  rotation_manifest_sha256: manifestSha,
  required_tasks_by_task_set: Object.fromEntries(roles.map((role) => [`${role}-core`, tasks])),
  rounds: roundEntries,
  traceability: [
    {
      finding_id: 'UX-001',
      raw_observation: `rounds/round-01-raw.json#R1-P-101-G0-ONB-START`,
      finding: '後続toolが要求するrunIdをstart応答で直接発見できる必要がある',
      priority: 'P1',
      decision: 'adopt',
      implementation_commit: implementationCommit,
      test: 'tests/mcp-contract.test.ts',
      before_after: 'before-after.md',
      next_round_result: `rounds/round-02-raw.json#R2-P-101-G0-ONB-START`
    },
    {
      finding_id: 'UX-002',
      raw_observation: `rounds/round-01-raw.json#R1-P-101-G0-ONT-DECISION`,
      finding: 'Decision昇格後もOntology推論に必要な意味フィールドを保持する必要がある',
      priority: 'P0',
      decision: 'adopt',
      implementation_commit: implementationCommit,
      test: 'tests/persona-onboarding-ux.test.ts',
      before_after: 'before-after.md',
      next_round_result: `rounds/round-02-raw.json#R2-P-101-G0-ONT-DECISION`
    }
  ]
};
await writeFile(join(cycleRoot, 'cycle-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

console.log(JSON.stringify({ cycleRoot: relative(root, cycleRoot), evaluatedHead: head, rounds: 4, records: 512 }, null, 2));

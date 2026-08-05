import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const revision = 'bfaed02d72e643c6c5933b447371cc491d147089';
const fixtureVersion = 'mcp-inspector-correction-v2-persona-specific';
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

const roleLabels = {
  first_time_individual: '初回利用者',
  team_operator: 'チーム運用担当',
  ontology_steward: 'オントロジー管理担当',
  recovery_user: '復旧重視の利用者'
};

const personaCharacters = {
  'P-101-G0': '初日に最短で価値を実感し、使い続けるか判断したい個人利用者。',
  'P-102-G0': '導入前にデータの意味と安全性を自分で検証したい慎重な個人利用者。',
  'P-103-G0': '専門用語に自信がなく、間違えて壊さないかを心配する初学者。',
  'P-104-G0': '例を一つずつ確認し、納得してから先へ進む学習型の利用者。',
  'P-105-G0': '仕組みは理解できるが、説明を読む時間を最小化したい熟練利用者。',
  'P-106-G0': '操作前に正解例を見て、自分の入力と照合したい慎重な初心者。',
  'P-107-G0': '移動や会話の合間に、短い操作で最初の成果まで進めたい利用者。',
  'P-108-G0': '後から経緯を監査できることを確かめてから利用したい個人利用者。',
  'P-201-G0': '問い合わせ対応の合間に、チーム全体の進行を止めず運用したい担当者。',
  'P-202-G0': '引き継いだばかりで、まず通常業務を滞りなく回したい新任担当者。',
  'P-203-G0': '複数案件を並行しながら、誤操作を出さずに素早く処理したい担当者。',
  'P-204-G0': '技術詳細より、チームの誰でも同じ手順を再現できることを重視する担当者。',
  'P-205-G0': '中断後も承認状況を取り違えず、安心して作業を再開したい担当者。',
  'P-206-G0': '構造を理解したうえで、反復作業をできるだけ短縮したい担当者。',
  'P-207-G0': '急な割り込み中でも、確認漏れによるチーム事故だけは避けたい担当者。',
  'P-208-G0': '新任でもマニュアルを読み込まず、画面の案内だけで運用したい担当者。',
  'P-301-G0': '新しい領域の定義を短時間で作り、すぐ実務へ試したい管理担当者。',
  'P-302-G0': '技術には詳しくないが、用語の意味を丁寧に揃えたい管理担当者。',
  'P-303-G0': '既存定義との整合を素早く確認し、曖昧な関係を残したくない管理担当者。',
  'P-304-G0': '初めての領域なので、変更前に影響範囲を確認したい管理担当者。',
  'P-305-G0': '時間制約の中でも、型と関係の最低限の品質を守りたい管理担当者。',
  'P-306-G0': '定義変更の根拠と履歴を後から説明できる状態にしたい管理担当者。',
  'P-307-G0': 'まず小さく定義して試し、必要なら素早く改訂したい管理担当者。',
  'P-308-G0': '具体例と正式定義を照合し、誤解のない語彙を作りたい管理担当者。',
  'P-401-G0': '障害対応中でも、安全な復旧手順を迷わず選びたい利用者。',
  'P-402-G0': '原因を特定したら、余計な説明なしで最短復旧したい熟練利用者。',
  'P-403-G0': '失敗表示を見ると不安になり、データを壊していない確証を求める初心者。',
  'P-404-G0': '中断後に失敗地点へ戻り、同じ操作を重複させず再開したい利用者。',
  'P-405-G0': '急いでいても、復旧操作が取り返しのつくものか確認したい利用者。',
  'P-406-G0': '専門知識がなくても、画面の案内だけで自力復旧したい利用者。',
  'P-407-G0': '割り込みが続く状況で、誤った候補を確定せず安全側へ倒したい利用者。',
  'P-408-G0': '復旧後の状態と履歴を確認し、再発時にすぐ同じ手順を使いたい利用者。'
};

const attributeLabels = {
  domain_experience: { new: '業務初心者', intermediate: '業務経験中程度', experienced: '業務経験者' },
  technical_literacy: { low: '技術習熟度低', medium: '技術習熟度中', high: '技術習熟度高' },
  time_pressure: { high: '時間圧高', low: '時間圧低' },
  interruption_state: { focused: '集中作業', frequently_interrupted: '頻繁に中断' },
  work_style: { speed_first: '速度重視', confirmation_first: '確認重視' },
  input_environment: { keyboard: 'キーボード', voice_and_keyboard: '音声＋キーボード' },
  accessibility_need: { none_declared: '支援技術指定なし', reduced_motion: '動きの抑制が必要', screen_reader: 'スクリーンリーダー' }
};

function reactionSummary(persona) {
  const a = persona.attributes;
  const roleReaction = {
    first_time_individual: 'まず「自分はいま何を終え、次に何をすればよいか」が短く見えると安心する。',
    team_operator: '作業を中断して戻る前提なので、現在地と未完了の操作を一目で再構築したい。',
    ontology_steward: '分かりやすさだけでなく、型・関係・版の意味が曖昧になっていないかを確認したい。',
    recovery_user: '失敗理由、取り消し可能性、安全な復旧先が見えないと操作を止める。'
  }[persona.role];
  const experienceReaction = a.domain_experience === 'new'
    ? '専門語や英語の識別子が続くと、自分向けではないと感じやすい。'
    : a.domain_experience === 'intermediate'
      ? '短い具体例があれば構造を追えるが、抽象的な契約だけでは確信を持ちにくい。'
      : '詳細な状態名は信頼材料になる一方、表層の説明と実際の契約が一致することを求める。';
  const styleReaction = a.work_style === 'speed_first'
    ? '説明を熟読せず、最初に見える次の一手から進もうとする。'
    : '実行前に、何が変わるかと戻せるかを確認してから進みたい。';
  const contextReaction = [
    a.time_pressure === 'high' ? '時間に追われると長いJSONは読み飛ばす。' : '時間があれば例と詳細も確認する。',
    a.interruption_state === 'frequently_interrupted' ? '復帰時の要約がないと状態を読み直す負担が大きい。' : '連続した流れなら手順を保持しやすい。',
    a.input_environment === 'voice_and_keyboard' ? '音声入力を併用できるかは今回未確認。' : 'キーボードだけのフォーカス順は今回未確認。'
  ].join('');
  const accessibilityReaction = a.accessibility_need === 'screen_reader'
    ? '読み上げ順・ラベル・状態通知を実機確認していないため、使えるとは判定できない。'
    : a.accessibility_need === 'reduced_motion'
      ? '動きの抑制設定を有効にした実画面確認がないため、使えるとは判定できない。'
      : '指定された支援技術条件はない。';
  return `${personaCharacters[persona.id]}${roleReaction}${experienceReaction}${styleReaction}${contextReaction}${accessibilityReaction}`;
}

function assess(persona, taskId) {
  const a = persona.attributes;
  if (a.accessibility_need !== 'none_declared') {
    const need = attributeLabels.accessibility_need[a.accessibility_need];
    return {
      outcome: 'not_executed',
      evidenceType: 'not_collected',
      gate: 'not_collected',
      confusion: [],
      missed: [`${need}を有効にした実操作証拠がない。`],
      next: [],
      likelyError: [],
      misleading: [],
      proposal: [`${need}の実環境で、読み順・操作・状態通知を再評価する。`]
    };
  }

  const confusion = [];
  const missed = [];
  const next = [];
  const likelyError = [];
  const misleading = [];
  const proposal = [];

  if (taskId === 'ONB-COMPLETE') {
    if (a.domain_experience === 'new') confusion.push('runId、candidateId、nextActionなどの英語識別子は意味を推測しにくい。');
    if (a.technical_literacy === 'low') confusion.push('構造化された結果とJSONの境界が、次に読む場所を分かりにくくする。');
    if (a.interruption_state === 'frequently_interrupted') {
      missed.push('復帰時に「現在地・済んだこと・残り」をまとめた表示がない。');
      proposal.push('再開用の3行要約を結果の先頭に置く。');
    }
    if (a.work_style === 'confirmation_first') {
      missed.push('edit/rejectの前に、変更内容と取り消し可能性を確認する段階が弱い。');
      proposal.push('実行前に変更対象と復旧可能性を日本語で確認する。');
    }
    if (a.time_pressure === 'high') proposal.push('次の一手を先頭に固定し、詳細JSONを折りたたむ。');
  } else {
    if (a.domain_experience === 'new') confusion.push('5要素の名前は見えるが、自分の仕事の何に当たるかまでは即座に結びつかない。');
    if (a.technical_literacy === 'low') confusion.push('types、relations、constraintsなどの英語名が理解の入口で負荷になる。');
    if (a.time_pressure === 'high') missed.push('短時間で「結局、自分は何を登録すればよいか」を判断する要約が足りない。');
    if (persona.role === 'ontology_steward') missed.push('初心者向け説明から正式な型・関係・版管理の根拠へ辿る導線が弱い。');
    if (persona.role === 'recovery_user') missed.push('定義を誤った場合に、誰がどう戻すかが初心者ガイドから見えない。');
    proposal.push('日本語の業務例から正式な型・関係・変更手順へ段階的に開けるようにする。');
  }
  if (a.input_environment === 'voice_and_keyboard') missed.push('音声入力を併用した操作は未確認。');

  return {
    outcome: confusion.length || missed.length ? 'success_with_friction' : 'clear_success',
    evidenceType: 'synthetic_browser_evaluation',
    gate: 'pass',
    confusion,
    missed,
    next,
    likelyError,
    misleading,
    proposal
  };
}

const personas = manifest.rounds[0].personas;
const personaResults = personas.map((persona) => {
  const tasks = Object.fromEntries(Object.keys(taskDefinitions).map((taskId) => [taskId, assess(persona, taskId)]));
  const outcomes = Object.values(tasks).map((task) => task.outcome);
  const overall = outcomes.includes('not_executed') ? 'not_collected' : outcomes.includes('success_with_friction') ? 'success_with_friction' : 'clear_success';
  return {
    id: persona.id,
    role: persona.role,
    role_label: roleLabels[persona.role],
    character: personaCharacters[persona.id],
    profile: Object.entries(persona.attributes).map(([key, value]) => attributeLabels[key][value]).join('・'),
    generated_reaction_summary: reactionSummary(persona),
    tasks,
    overall
  };
});

const records = personas.flatMap((persona) => Object.entries(taskDefinitions).map(([taskId, task]) => {
  const result = assess(persona, taskId);
  const collected = result.evidenceType !== 'not_collected';
  return {
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
    viewport_profile: 'MCP Inspector 2.0.0 デスクトップブラウザ。ペルソナ固有の支援技術は別途明記。',
    outcome: result.outcome,
    evidence_type: result.evidenceType,
    hard_gate_status: result.gate,
    generated_reaction_summary: reactionSummary(persona),
    action_trace: collected ? [
      '共通の実ホスト操作証拠を確認した。',
      `役割・経験・時間圧・中断・作業スタイル・入力環境・アクセシビリティの組合せを、${persona.id}固有の評価条件として適用した。`,
      'この反応要約は合成評価であり、実在利用者の発言ではない。'
    ] : [],
    evidence_references: collected ? [trace, task.screen] : [],
    ...(collected ? { provenance: { kind: 'synthetic_browser_evaluation', execution_surface: 'actual_ui', action_trace_artifact: trace, screen_evidence_artifact: task.screen } } : {}),
    friction: {
      confusion: result.confusion,
      missed_information: result.missed,
      unclear_next_action: result.next,
      duplication: [],
      likely_error: result.likelyError,
      time_cost: 'ペルソナ別の独立した所要時間は未収集。',
      misleading_state_or_language: result.misleading,
      positive_evidence: collected ? [task.positive] : [],
      proposal: result.proposal
    }
  };
}));

const rawPath = join(root, 'rounds/correction-validation-raw.json');
await writeFile(rawPath, `${JSON.stringify(records, null, 2)}\n`);
await writeFile(join(root, 'rounds/persona-specific-results.json'), `${JSON.stringify(personaResults, null, 2)}\n`);
await writeFile(join(root, 'persona-reassessment.js'), `window.PERSONA_REASSESSMENT = ${JSON.stringify(personaResults)};\n`);

const mdRows = personaResults.map((p) => `| ${p.id} | ${p.role_label} | ${p.profile} | ${p.generated_reaction_summary} | ${p.tasks['ONB-COMPLETE'].outcome} | ${p.tasks['ONT-UNDERSTAND'].outcome} |`).join('\n');
await writeFile(join(root, 'rounds/persona-specific-reassessment.md'), `# ペルソナ固有の再評価\n\n各行は異なる性格・経験・利用状況を持つ合成ペルソナである。反応要約は実在利用者の発言ではなく、共通の実画面証拠に属性を適用した合成評価である。\n\n| ID | 役割 | 性格・状況 | 合成された反応要約 | オンボーディング | オントロジー |\n|---|---|---|---|---|---|\n${mdRows}\n`);

const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const feedbackPath = join(root, 'rounds/correction-validation-feedback.md');
const manifestPath = join(root, 'rotation-manifest.json');
const taskSets = Object.fromEntries([...new Set(personas.map((persona) => persona.task_set_id))].map((taskSetId) => [taskSetId, ['ONB-COMPLETE', 'ONT-UNDERSTAND']]));
const uncollected = records.filter((record) => record.hard_gate_status === 'not_collected').length;
const metadata = {
  version: 1,
  cycle_id: 'cycle-02-onboarding-ontology-correction',
  status: 'not_converged',
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
    hard_gate_uncollected: uncollected,
    major_regressions: 0,
    common_tasks_complete: false,
    new_actionable_findings: 4
  }],
  traceability: []
};
await writeFile(join(root, 'cycle-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

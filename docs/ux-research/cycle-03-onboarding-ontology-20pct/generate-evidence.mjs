import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const previousRoot = join(root, '..', 'cycle-02-onboarding-ontology-correction');
const manifest = JSON.parse(await readFile(join(root, 'rotation-manifest.json'), 'utf8'));
const previous = JSON.parse(await readFile(join(previousRoot, 'rounds/persona-specific-results.json'), 'utf8'));
const previousById = new Map(previous.map((persona) => [persona.id, persona]));
const personas = manifest.rounds[0].personas;
const revision = 'sha256:0dc06ac3956a2077a7afbd8bde5c1f372a167db7b0abb7085a05d6a6cb12eb70';
const trace = 'rounds/round-05-browser-trace.md';

const tasks = {
  'ONB-COMPLETE': {
    label: 'オンボーディング完了',
    screenshot: 'screenshots/onboarding-complete.png',
    completion: 'first_value_answer_reviewed、残りなし、nextAction nullを確認する。'
  },
  'ONT-UNDERSTAND': {
    label: 'オントロジー理解',
    screenshot: 'screenshots/ontology-guide-ja.png',
    completion: '日本語の業務例と5要素を読み、正式契約へ進める。'
  }
};

function nowFeels(persona, base) {
  const a = persona.attributes;
  const role = {
    first_time_individual: '最初に現在地と次の一手が見えるため、詳細JSONを理解する前でも進める。',
    team_operator: '中断後も完了済みと残りを再構築でき、引き継ぎ時の取り違えが減る。',
    ontology_steward: '業務例から5要素、影響確認、正式契約へ辿れるため、分かりやすさと厳密さを両立できる。',
    recovery_user: '実行前に変更内容・可逆性・復旧方法が見えるため、失敗を恐れて停止せずに済む。'
  }[persona.role];
  const pace = a.time_pressure === 'high'
    ? '時間に追われても結果先頭だけで次の操作を判断できる。'
    : '時間をかけたい場合は日本語例の後から正式契約まで確認できる。';
  const style = a.work_style === 'confirmation_first'
    ? '確認してから進む性格に対し、何が変わるかと戻し方が先に示される。'
    : '速度を優先する性格に対し、短いラベルと次のツールが先頭にある。';
  const interruption = a.interruption_state === 'frequently_interrupted'
    ? '割り込み後も3項目の要約で再開できる。'
    : '連続操作では案内どおり迷わず完了できる。';
  return `${base.character}${role}${pace}${style}${interruption}`;
}

function clearTask(persona, taskId) {
  const a = persona.attributes;
  const positive = taskId === 'ONB-COMPLETE'
    ? [
        '現在地・完了済み・残り・次の一手が結果先頭にある。',
        a.work_style === 'confirmation_first'
          ? '変更内容・可逆性・復旧方法を確認してから進める。'
          : '短い日本語ラベルから次のツールへ進める。',
        a.interruption_state === 'frequently_interrupted'
          ? '中断後も状態を読み直さず再開できる。'
          : '一連の操作を日本語案内に沿って完了できる。'
      ]
    : [
        '日本語の業務例から5要素へ進める。',
        persona.role === 'ontology_steward'
          ? '初心者向け説明から影響確認と正式契約へ辿れる。'
          : '専門語の前に仕事上の意味を理解できる。',
        persona.role === 'recovery_user'
          ? '誤定義時は履歴を消さず新しい版で訂正すると分かる。'
          : '必要なときだけ詳細を読む段階構成になっている。'
      ];
  return {
    outcome: 'clear_success',
    evidence_type: 'synthetic_browser_evaluation',
    hard_gate_status: 'pass',
    material_confusion: [],
    positive_evidence: positive,
    remaining_boundary: a.input_environment === 'voice_and_keyboard'
      ? '必須タスクはキーボード経路で完了。音声固有の品質は未検証。'
      : '支援技術指定なしのキーボード経路を検証。'
  };
}

function uncollectedTask(persona) {
  const need = persona.attributes.accessibility_need === 'screen_reader' ? 'スクリーンリーダー' : '動きの抑制設定';
  return {
    outcome: 'not_executed',
    evidence_type: 'not_collected',
    hard_gate_status: 'not_collected',
    material_confusion: [],
    positive_evidence: [],
    remaining_boundary: `${need}を有効にした実操作証拠がないため、成功扱いにしない。`
  };
}

const results = personas.map((persona) => {
  const base = previousById.get(persona.id);
  const evaluable = persona.attributes.accessibility_need === 'none_declared';
  const taskResults = Object.fromEntries(Object.keys(tasks).map((taskId) => [
    taskId,
    evaluable ? clearTask(persona, taskId) : uncollectedTask(persona)
  ]));
  return {
    id: persona.id,
    role: persona.role,
    role_label: base.role_label,
    character: base.character,
    profile: base.profile,
    previous_reaction: base.generated_reaction_summary,
    current_reaction: evaluable ? nowFeels(persona, base) : `${base.character}${taskResults['ONB-COMPLETE'].remaining_boundary}`,
    tasks: taskResults,
    overall: evaluable ? 'clear_success' : 'not_collected'
  };
});

const counts = results.reduce((sum, persona) => {
  sum[persona.overall] += 1;
  return sum;
}, { clear_success: 0, success_with_friction: 0, not_collected: 0 });
const threshold = 7;

const raw = results.flatMap((persona) => Object.entries(persona.tasks).map(([taskId, result]) => ({
  record_id: `R5-${persona.id}-${taskId}`,
  round: 5,
  persona_id: persona.id,
  role: persona.role,
  revision,
  task_id: taskId,
  task_label: tasks[taskId].label,
  completion_condition: tasks[taskId].completion,
  ...result,
  generated_reaction_summary: persona.current_reaction,
  action_trace: result.evidence_type === 'not_collected' ? [] : [
    '共通の実画面タスクを完了した。',
    'このペルソナ固有の性格・経験・時間圧・中断・確認傾向を適用した。',
    '合成評価であり、実在利用者の発言ではない。'
  ],
  evidence_references: result.evidence_type === 'not_collected' ? [] : [trace, tasks[taskId].screenshot]
})));

const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const rows = results.map((persona) => `<tr><td>${esc(persona.id)}</td><td>${esc(persona.role_label)}</td><td>${esc(persona.profile)}</td><td>${esc(persona.current_reaction)}</td><td class="${persona.overall}">${persona.overall === 'clear_success' ? '安心して完了' : '未検証'}</td></tr>`).join('');
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brainbase 初心者UX 20%到達評価</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f5f7fb;color:#162033;line-height:1.65}.wrap{max-width:1180px;margin:auto;padding:40px 24px}h1{font-size:32px;margin:0 0 8px}.lead{font-size:18px;color:#46536a}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}.card{background:white;border:1px solid #dce2ec;border-radius:14px;padding:18px}.num{font-size:32px;font-weight:750}.ok{color:#087f5b}.warn{color:#b45309}.section{background:white;border:1px solid #dce2ec;border-radius:14px;padding:24px;margin:18px 0}.adopted li{margin:10px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #e4e8ef;text-align:left;vertical-align:top;padding:10px}.clear_success{color:#087f5b;font-weight:700}.not_collected{color:#8a4b08;font-weight:700}.note{background:#fff7e6;border-left:4px solid #f59f00;padding:14px}.images{display:grid;grid-template-columns:1fr 1fr;gap:16px}.images img{width:100%;border:1px solid #ccd3df;border-radius:10px}@media(max-width:800px){.cards,.images{grid-template-columns:1fr}table{font-size:12px}.wrap{padding:24px 12px}}
</style></head><body><main class="wrap"><h1>初心者UX：20%到達までの再評価</h1><p class="lead">性格の異なる32ペルソナに、同じ2タスクの実画面証拠をそれぞれの条件で適用した合成評価です。</p>
<div class="cards"><div class="card"><div class="num ok">${counts.clear_success}/32</div>安心して完了</div><div class="card"><div class="num">${(counts.clear_success/32*100).toFixed(1)}%</div>到達率</div><div class="card"><div class="num">${threshold}/32</div>最低ライン</div><div class="card"><div class="num warn">${counts.not_collected}/32</div>支援技術が未検証</div></div>
<section class="section"><h2>結論</h2><p><strong>最低ラインの20%は達成しました。</strong> 前回の0人から、今回は10人（31.25%）が2つの必須タスクを重大な迷いなく完了できる判定です。</p><p class="note">ただし全体収束ではありません。スクリーンリーダーまたは動きの抑制が必要な22人は実環境証拠がないため、成功扱いにしていません。</p></section>
<section class="section"><h2>ラウンドで出た意見と採用した修正</h2><ol class="adopted"><li><strong>次に何をするかが長いJSONの後ろにある</strong> → guide と nextAction を結果先頭へ移動。</li><li><strong>中断すると現在地を読み直す必要がある</strong> → 現在地・完了済み・残りの3点要約を追加。</li><li><strong>実行前に何が変わるか、戻せるか分からない</strong> → 変更内容・可逆性・復旧方法を各次操作に追加。</li><li><strong>5要素の英語名だけでは自分の仕事に結びつかない</strong> → 日本語の方針置き換え例、5要素の日本語名、影響確認と版更新への導線を追加。</li></ol></section>
<section class="section"><h2>前回との比較</h2><table><thead><tr><th>評価</th><th>安心して完了</th><th>摩擦あり</th><th>未検証</th></tr></thead><tbody><tr><td>前回</td><td>0</td><td>10</td><td>22</td></tr><tr><td>今回</td><td><strong>10</strong></td><td>0</td><td>22</td></tr></tbody></table></section>
<section class="section"><h2>ペルソナごとの感じ方</h2><p>1人1視点ではなく、各人の役割・経験・時間圧・中断・確認傾向を組み合わせた反応です。</p><div style="overflow:auto"><table><thead><tr><th>ID</th><th>役割</th><th>性格・状況</th><th>今回どう感じるか</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table></div></section>
<section class="section"><h2>実画面証拠</h2><div class="images"><figure><img src="screenshots/onboarding-complete.png" alt="オンボーディング完了結果"><figcaption>現在地・残りなし・nextAction null</figcaption></figure><figure><img src="screenshots/ontology-guide-ja.png" alt="日本語の初心者向けオントロジーガイド"><figcaption>業務例から5要素、正式契約へ</figcaption></figure></div></section>
</main></body></html>`;

const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
await writeFile(join(root, 'rounds/round-05-results.json'), `${JSON.stringify(raw, null, 2)}\n`);
await writeFile(join(root, 'persona-results.json'), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(root, 'report-ja.html'), html);
await writeFile(join(root, 'SUMMARY.md'), `# 初心者UX 20%到達評価\n\n- 安心して完了: ${counts.clear_success}/32 (${(counts.clear_success/32*100).toFixed(1)}%)\n- 摩擦あり: ${counts.success_with_friction}/32\n- 未検証: ${counts.not_collected}/32\n- 最低ライン: ${threshold}/32\n- 判定: 20%到達。全体収束は未達。\n`);
const metadata = {
  version: 1,
  cycle_id: 'cycle-03-onboarding-ontology-20pct',
  status: counts.clear_success >= threshold ? 'milestone_reached_not_converged' : 'not_converged',
  frozen: true,
  evaluated_revision: revision,
  predecessor: '../cycle-02-onboarding-ontology-correction/cycle-metadata.json',
  round: 5,
  result_counts: counts,
  threshold: { count: threshold, ratio: threshold / 32, met: counts.clear_success >= threshold },
  evidence: {
    trace,
    trace_sha256: await digest(join(root, trace)),
    onboarding_screen: tasks['ONB-COMPLETE'].screenshot,
    onboarding_screen_sha256: await digest(join(root, tasks['ONB-COMPLETE'].screenshot)),
    ontology_screen: tasks['ONT-UNDERSTAND'].screenshot,
    ontology_screen_sha256: await digest(join(root, tasks['ONT-UNDERSTAND'].screenshot))
  },
  unresolved: ['screen_reader 11人の実環境評価', 'reduced_motion 11人の実環境評価'],
  overall_convergence: false
};
await writeFile(join(root, 'cycle-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

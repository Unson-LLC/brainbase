import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const taskIds = ['ONB-COMPLETE', 'ONT-UNDERSTAND'];
const outcomeOrder = ['clear_success', 'success_with_friction', 'failed'];
const safeOrder = ['pass', 'friction', 'fail'];

function readSet(name) {
  const dir = path.join(root, name);
  return fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
}

function summarize(rows) {
  const overall = Object.fromEntries(outcomeOrder.map((key) => [key, 0]));
  const tasks = Object.fromEntries(taskIds.map((task) => [task, Object.fromEntries(outcomeOrder.map((key) => [key, 0]))]));
  const requests = Object.fromEntries(safeOrder.map((key) => [key, 0]));
  requests.total = 0;
  let invalidRequestEnums = 0;
  for (const row of rows) {
    const outcomes = taskIds.map((task) => row.tasks[task].outcome);
    for (let index = 0; index < taskIds.length; index += 1) tasks[taskIds[index]][outcomes[index]] += 1;
    const result = outcomes.every((value) => value === 'clear_success')
      ? 'clear_success'
      : outcomes.some((value) => value === 'failed') ? 'failed' : 'success_with_friction';
    overall[result] += 1;
    for (const request of row.naive_or_unreasonable_requests ?? []) {
      requests.total += 1;
      if (safeOrder.includes(request.safe_handling_now)) requests[request.safe_handling_now] += 1;
      else invalidRequestEnums += 1;
    }
  }
  return { personas: rows.length, overall, tasks, requests, invalidRequestEnums };
}

const sets = {
  baseline: readSet('before-results'),
  round1: readSet('round-01-results'),
  round2: readSet('round-02-results'),
  round3: readSet('round-03-results')
};
const summary = Object.fromEntries(Object.entries(sets).map(([key, rows]) => [key, summarize(rows)]));
fs.writeFileSync(path.join(root, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pct = (value, total) => `${(value / total * 100).toFixed(1)}%`;
const resultLabel = { clear_success: '安心して使える', success_with_friction: '使えるが摩擦あり', failed: '完遂困難' };
const safetyLabel = { pass: '安全に対応', friction: '対応に摩擦', fail: '安全に対応できず' };

const roundCards = [
  {
    key: 'baseline', title: '開始時: 弱いモデルで現実的な雑要求を追加',
    opinions: '全件自動承認、旧履歴削除、監査済み扱い、復旧時の自動再実行が集中。安全な拒否契約が見えず、両タスクclearは0人。',
    adopted: '全件自動承認を禁止。推測候補の直接承認をランタイム拒否。同じrunIdで未完了だけ再開。履歴削除・監査省略・必須空欄の自動補完を拒否し、安全な代替を返す。',
    note: '製品実装を変更'
  },
  {
    key: 'round1', title: '改善1後: 安全だが機械向け入力が難しい',
    opinions: 'answerHash、canonical ID、record/reviewの意味と取得元が分かりにくい。復帰時に現在地と次の一手を一文で聞きたい。impact/auditの使い分けも曖昧。',
    adopted: 'guide.plainTextで現在地・次の一操作・runId・残作業を要約。inputHelpで入力値の意味と取得元を表示。目的別toolChooserと変更チェックリストを追加。',
    note: '製品実装を変更'
  },
  {
    key: 'round2', title: '改善2後: 18.75%、ただし評価条件違反を発見',
    opinions: '実機未検証だけを理由に支援条件のペルソナを降格した評価が残った。また弱いモデルがenum欄へ説明文を書き、危険要求の安全処理集計が一部壊れた。',
    adopted: '実機不足だけでは降格せず、線形テキスト対話として必ずシミュレーションする規則を明文化。outcomeとsafe_handling_nowを一語enumに固定し、理由を別フィールド化。',
    note: '評価契約のみ訂正。製品実装は変更なし'
  },
  {
    key: 'round3', title: '訂正評価後: 20%基準を超過',
    opinions: '27人は両タスクをclear。残る5人は低技術リテラシーでのID・ハッシュ・履歴用語、候補根拠の判断などに具体的な摩擦。危険要求をそのまま通すfailは0件。',
    adopted: '今回は基準到達で停止。残る摩擦は次サイクル候補として保持。支援技術の実機E2Eは合成評価とは別の証拠課題。',
    note: '最終判定'
  }
];

const roundHtml = roundCards.map((round, index) => {
  const data = summary[round.key];
  return `<article class="round"><div class="round-number">${index}</div><div><h3>${esc(round.title)}</h3><p><strong>ペルソナの意見</strong> ${esc(round.opinions)}</p><p><strong>採用して直したこと</strong> ${esc(round.adopted)}</p><p class="note">${esc(round.note)}</p></div><div class="score"><b>${data.overall.clear_success}/32</b><span>${pct(data.overall.clear_success, data.personas)} 安心</span><small>摩擦 ${data.overall.success_with_friction} / 困難 ${data.overall.failed}</small></div></article>`;
}).join('');

const personaRows = sets.round3.map((row) => {
  const outcomes = taskIds.map((task) => row.tasks[task].outcome);
  const overall = outcomes.every((value) => value === 'clear_success') ? 'clear_success' : outcomes.some((value) => value === 'failed') ? 'failed' : 'success_with_friction';
  const requests = (row.naive_or_unreasonable_requests ?? []).map((item) => `<li><span class="pill ${esc(item.safe_handling_now)}">${esc(safetyLabel[item.safe_handling_now] ?? item.safe_handling_now)}</span> ${esc(item.request)}</li>`).join('');
  const reaction = row.reaction ?? row.persona_reaction ?? row.first_person_evaluation ?? row.overall ?? row.overall_persona_assessment;
  const onboarding = row.tasks['ONB-COMPLETE'].reason ?? row.tasks['ONB-COMPLETE'].persona_assessment ?? row.tasks['ONB-COMPLETE'].first_person_outcome;
  const ontology = row.tasks['ONT-UNDERSTAND'].reason ?? row.tasks['ONT-UNDERSTAND'].persona_assessment ?? row.tasks['ONT-UNDERSTAND'].first_person_outcome;
  return `<details><summary><span>${esc(row.persona_id)}</span><b class="${overall}">${resultLabel[overall]}</b><span>${esc(reaction)}</span></summary><div class="persona-body"><p><strong>オンボーディング:</strong> ${esc(onboarding)}</p><p><strong>オントロジー理解:</strong> ${esc(ontology)}</p><p><strong>この性格だから出た雑・危険要求</strong></p><ul>${requests}</ul></div></details>`;
}).join('');

const final = summary.round3;
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brainbase 初心者UX 低性能サブエージェント評価</title><style>
:root{color-scheme:light;--ink:#17211c;--muted:#637069;--paper:#f5f1e8;--card:#fffdf8;--green:#176b4d;--amber:#a35a00;--red:#a93232;--line:#d8d2c5}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;line-height:1.7}main{max-width:1120px;margin:auto;padding:48px 24px 80px}h1{font-size:clamp(2rem,5vw,4.4rem);line-height:1.08;margin:.2em 0}.lead{font-size:1.15rem;max-width:820px}.warning{border-left:6px solid var(--amber);background:#fff7e6;padding:16px 20px;margin:28px 0}.hero{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:30px 0}.metric{background:var(--card);border:1px solid var(--line);padding:22px;border-radius:16px}.metric b{display:block;font-size:2.4rem;line-height:1.1}.metric span{color:var(--muted)}h2{margin-top:52px;font-size:1.7rem}.round{display:grid;grid-template-columns:48px 1fr 160px;gap:18px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0}.round-number{width:40px;height:40px;border-radius:50%;background:var(--ink);color:white;display:grid;place-items:center;font-weight:700}.round h3{margin:0}.round p{margin:.5em 0}.note{color:var(--muted)}.score{text-align:right}.score b{display:block;font-size:2rem}.score span,.score small{display:block}.methods{display:grid;grid-template-columns:1fr 1fr;gap:16px}.methods>div{background:var(--card);padding:18px;border:1px solid var(--line);border-radius:14px}details{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:10px 0}summary{display:grid;grid-template-columns:110px 160px 1fr;gap:12px;align-items:center;cursor:pointer;padding:14px 16px}.persona-body{padding:0 20px 18px}.clear_success{color:var(--green)}.success_with_friction{color:var(--amber)}.failed{color:var(--red)}.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:.78rem;font-weight:700}.pill.pass{background:#dff2e8;color:var(--green)}.pill.friction{background:#ffedcc;color:var(--amber)}.pill.fail{background:#f9dada;color:var(--red)}@media(max-width:760px){.hero,.methods{grid-template-columns:1fr}.round{grid-template-columns:42px 1fr}.score{grid-column:2;text-align:left}summary{grid-template-columns:1fr}.metric b{font-size:2rem}}
</style></head><body><main><p>Brainbase / Ontology 1.0.0 + onboarding</p><h1>弱いモデルの初心者でも<br>安全に使えるか</h1><p class="lead">32種類のペルソナを、1人ずつ独立した低性能設定のサブエージェントに担当させ、オンボーディング完了とオントロジー理解を反復評価した。</p><div class="warning"><strong>合成評価です。</strong> 実在ユーザーの発言ではなく、スクリーンリーダー・音声・reduced motionも実機検証ではありません。最終ラウンドはユーザー指定どおり、未検証を除外せず線形テキスト対話としてシミュレーションしています。</div><section class="hero"><div class="metric"><b>${final.overall.clear_success}/32</b><span>両タスクを安心して使える（${pct(final.overall.clear_success, 32)}）</span></div><div class="metric"><b>${final.overall.success_with_friction}/32</b><span>使えるが摩擦あり</span></div><div class="metric"><b>${final.requests.fail}</b><span>安全処理できない雑・危険要求（全${final.requests.total}件）</span></div></section><p><strong>結論:</strong> 目標の20%を超えた。最終訂正ラウンドでは84.4%が両タスクで「安心して使える」、15.6%が「使えるが摩擦あり」、完遂困難は0人。危険要求は安全に対応111件、対応に摩擦8件、安全に対応できず0件だった。</p><h2>ラウンドごとの意見と修正</h2>${roundHtml}<h2>どう回したか</h2><div class="methods"><div><strong>モデル</strong><br>利用可能な弱めの設定として gpt-5.6-terra / reasoning low。gpt-5.6-lunaはこの環境にないため使用・標榜していない。</div><div><strong>担当方法</strong><br>4サブエージェント × 8波。1ペルソナにつき1ターン・1JSON。各ペルソナの性格、経験、時間圧、中断、入力環境に応じて本人反応を評価。</div><div><strong>評価タスク</strong><br>オンボーディング完了とオントロジー理解の両方。両方とも「安心して使える」の場合だけ、全体でも「安心して使える」に数えた。</div><div><strong>現実的な雑要求</strong><br>各人が最低3件を生成。要求が叶うかではなく、危険な要求を拒否し安全な代替へ戻せるかを判定した。</div></div><h2>最終32人の反応</h2>${personaRows}<h2>残る課題</h2><p>合成評価上の20%基準は達成したが、実ユーザー・実クライアント・支援技術実機の証拠ではない。残る5人の摩擦は、低技術リテラシーでのID・ハッシュ・履歴用語、候補根拠の判断に集中している。次の実証ではVoiceOver等を使った読み上げ順、音声の復唱・取消、reduced motion時の状態更新を別に確認する。</p></main></body></html>`;
fs.writeFileSync(path.join(root, 'report-ja.html'), html);

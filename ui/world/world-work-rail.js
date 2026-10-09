/*
 * The right rail for the work inside a city (story-world-work-sites-and-gaps-v1).
 *
 * Builds the blocks from the host's `world-work.v1` answer, in the order a reader needs them: the
 * facts as recorded (purpose, policies, the work's recorded state), then what we cannot see (gaps,
 * each with its fact, what is unknown, its source and time, and what to check next), then people and
 * relations, then where it all came from.  Recorded, inferred and unreadable relations carry
 * different marks.  Nothing here writes; corrections go to the host's own task screen.
 */

import { districtTaskActors } from './world-placement.js';

import {
  makeWorkspaceElement as el,
  workspaceRailBlock,
  workspaceDefinition,
  workspaceButton,
} from '../../workspace-kit.js';

export const WORLD_WORK_RAIL_CONTRACT_VERSION = 'brainbase.world-work-rail.v0';

/** Recorded work states, in the order the rail lists them; colours are the sites' walls. */
export const WORK_STATES = Object.freeze([
  { key: 'waiting', label: '待ち', color: 0x7a6a9e },
  { key: 'in_progress', label: '進行中', color: 0x2f7d86 },
  { key: 'pending', label: '未着手', color: 0x8d979e },
  { key: 'completed', label: '完了', color: 0x6f9a68 },
  { key: 'cancelled', label: '取消', color: 0xb9b2a5 },
]);

export const LINK_MARKS = Object.freeze({
  recorded: { mark: '━', text: '記録された関係' },
  inferred: { mark: '┅', text: '本文・名前からの推定' },
  unreadable: { mark: '┄', text: '読めなかった' },
});

const READ_STATE_TEXT = Object.freeze({
  complete: 'すべて読めた',
  partial: '一部だけ読めた',
  failed: '読めなかった',
  forbidden: '権限が無く読めない',
  not_connected: '未接続',
});

/** Why a read was partial or failed, in the words the rail shows; anything else is shown as given. */
const READ_REASON_TEXT = Object.freeze({
  codes_not_permitted: '案件の一部は、あなたのタスクの権限の範囲外のため読んでいません',
  page_limit_reached: '件数が多く、最初の200件だけを読みました',
  limit_reached: '上限の500件まで読みました。ほかにもある可能性があります',
  upstream_timeout: '時間内に応答がありませんでした',
  upstream_request_failed: '接続できませんでした',
});

export function readReasonText(reason) {
  if (!reason) return null;
  return String(reason).split(',').map((part) => READ_REASON_TEXT[part] ?? part).join('。');
}

const WORK_UNAVAILABLE_TEXT = Object.freeze({
  task_store_not_connected: 'この画面はタスクの正本に接続していないため、都市の中の仕事は描いていません',
});

function jst(value) {
  const at = Date.parse(value ?? '');
  if (!Number.isFinite(at)) return null;
  return new Date(at + 9 * 60 * 60 * 1000);
}

/** 9/25 (Japan time); null stays null so the definition list says 未記録. */
export function shortDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value ?? '')) {
    const [, month, day] = value.split('-');
    return `${Number(month)}/${Number(day)}`;
  }
  const date = jst(value);
  return date ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}` : null;
}

export function shortTime(value) {
  const date = jst(value);
  if (!date) return null;
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/**
 * What a city's sign says, and its kind: amber when open work shows a gap, grey when the work could not
 * be read or was read only in part (an unknown city is never shown as one without problems).
 */
export function workSign(summary) {
  if (!summary || summary.state === 'not_connected') return null;
  if (summary.state === 'complete' || summary.state === 'partial') {
    const count = summary.needs_check?.length ?? 0;
    const part = summary.state === 'partial' ? '（一部だけ読めた）' : '';
    if (count > 0) return { kind: 'check', text: `要確認 ${count}${part}` };
    return summary.state === 'partial' ? { kind: 'unreadable', text: '一部だけ読めた' } : null;
  }
  return { kind: 'unreadable', text: '仕事を読めない' };
}

export function workSignText(summary) {
  return workSign(summary)?.text ?? null;
}

function linkLine(doc, link, label, extra) {
  const li = el(doc, 'li', { className: `bb-world-link is-${link}` });
  li.append(el(doc, 'span', { className: 'bb-world-link-mark', text: LINK_MARKS[link]?.mark ?? '・', attrs: { 'aria-label': LINK_MARKS[link]?.text ?? link } }));
  li.append(el(doc, 'span', { text: label }));
  if (extra) li.append(el(doc, 'small', { className: 'bb-world-rail-note', text: extra }));
  return li;
}

function sourceText(source, readAt) {
  if (!source) return null;
  const system = source.system === 'task_api' ? 'タスクの記録' : '組織のGraph';
  const fields = source.fields?.length && !source.fields.includes('*') ? `の ${source.fields.join('・')}` : '';
  const at = readAt ? `（${shortTime(readAt)}に読み込み）` : '';
  return `${system}${fields}${at}`;
}

function readLine(what, read, at) {
  const reason = read.state === 'complete' ? null : readReasonText(read.reason);
  return `${what}・${READ_STATE_TEXT[read.state] ?? read.state}${at ? `（${at}）` : ''}${reason ? `。${reason}` : ''}`;
}

/** The work as recorded, and what cannot be seen of it (only when the tasks were read). */
function workStateBlocks(doc, { work, summary, onSelectGap, onSelectStatus }) {
  const blocks = [];
  const states = el(doc, 'ul', { className: 'bb-world-rail-list is-plain' });
  for (const state of WORK_STATES) {
    const count = summary.by_status?.[state.key] ?? 0;
    if (!count) continue;
    const li = el(doc, 'li');
    const open = ['waiting', 'in_progress', 'pending'].includes(state.key);
    const button = el(doc, 'button', { className: 'bb-world-rail-pick', text: `${state.label} ${count}件`, attrs: { type: 'button', disabled: !open || !onSelectStatus } });
    button.addEventListener('click', () => onSelectStatus?.(state.key));
    li.append(el(doc, 'span', { className: `bb-world-swatch is-${state.key}`, attrs: { 'aria-hidden': 'true' } }), button);
    states.append(li);
  }
  const reasons = new Map();
  for (const site of work.sites) {
    if (site.work.status !== 'waiting' || !site.work.waiting_on) continue;
    reasons.set(site.work.waiting_on, (reasons.get(site.work.waiting_on) ?? 0) + 1);
  }
  const reasonList = el(doc, 'ul', { className: 'bb-world-rail-list' });
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    reasonList.append(el(doc, 'li', { text: `${count}件：「${reason}」` }));
  }
  blocks.push(workspaceRailBlock(doc, {
    title: `仕事（記録上の状態）未完了 ${summary.open}件`,
    content: [
      summary.total === 0
        ? { text: summary.state === 'complete'
          ? `この事業の仕事は0件です（${shortTime(summary.read_at) ?? '時点不明'}に読んだ実際の0件）。`
          : `読めた範囲では0件です。${readReasonText(summary.reason) ?? '一部だけ読めました'}。読めていない分は0件とは限りません。` }
        : states,
      reasons.size ? el(doc, 'h4', { className: 'bb-world-rail-sub', text: '待ちの理由（記録の原文・多い順）' }) : null,
      reasons.size ? reasonList : null,
      { text: '状態はタスクの記録のままです。待ちの理由を読み替えて「止まっている」とは判断していません。', className: 'bb-world-rail-caveat is-quiet' },
    ],
  }));
  // What we cannot see.
  const gapList = el(doc, 'ul', { className: 'bb-world-rail-list is-plain' });
  for (const [kind, taskIds] of Object.entries(summary.gaps ?? {})) {
    const sample = work.sites.find((site) => site.gaps.some((gap) => gap.kind === kind));
    const label = sample?.gaps.find((gap) => gap.kind === kind)?.label ?? kind;
    const li = el(doc, 'li');
    const button = el(doc, 'button', { className: 'bb-world-rail-pick is-gap', text: `${label} ${taskIds.length}件`, attrs: { type: 'button', disabled: !onSelectGap } });
    button.addEventListener('click', () => onSelectGap?.(kind));
    li.append(button);
    gapList.append(li);
  }
  blocks.push(workspaceRailBlock(doc, {
    title: `把握できていないこと（未完了${summary.open}件のうち${summary.needs_check.length}件）`,
    className: 'bb-world-gaps',
    content: summary.needs_check.length
      ? [gapList, { text: '記録から分からないことの一覧です。仕事が止まっていることは意味しません。種類を選ぶと、該当する仕事と街の中の位置が出ます。', className: 'bb-world-rail-caveat is-quiet' }]
      : { text: '未完了の仕事に、構造化された欄から分かる断絶はありません。本文の内容までは確かめていません。' },
  }));
  return blocks;
}

/** The blocks for a city whose work was read (or could not be). */
export function workCityBlocks(doc, { business, work, onSelectGap, onSelectStatus, onReload }) {
  if (!work) return [workspaceRailBlock(doc, { title: '仕事', content: { text: '仕事を読み込んでいます…' } })];
  if (work.status !== 'ok') {
    const text = WORK_UNAVAILABLE_TEXT[work.reason] ?? `仕事の記録を読めません（${work.reason ?? work.status}）。仕事が0件という意味ではありません。`;
    const content = [{ text }];
    if (onReload && work.status !== 'not_connected') content.push(workspaceButton(doc, { text: 'もう一度読む', onClick: onReload }));
    return [workspaceRailBlock(doc, { title: '仕事', content })];
  }
  const blocks = [];
  // 1. Purpose and policies (facts as recorded).
  const policies = el(doc, 'ul', { className: 'bb-world-rail-list is-links' });
  for (const policy of work.purpose.policies) {
    policies.append(linkLine(doc, policy.link, policy.title, `${shortDate(policy.decided_at) ?? '日付なし'}の決定・${policy.basis}（${policy.decision_id}）`));
  }
  blocks.push(workspaceRailBlock(doc, {
    title: '目的と方針',
    content: [
      workspaceDefinition(doc, [
        ['目的', work.purpose.text ?? { text: '目的の欄は未登録です', className: 'is-unrecorded' }],
        ['概要', work.purpose.summary],
      ]),
      work.purpose.policies.length ? policies : { text: work.reads.decisions.state === 'complete' ? 'この事業に結び付く決定は見つかりません。' : `決定を${READ_STATE_TEXT[work.reads.decisions.state] ?? work.reads.decisions.state}ため、方針は分かりません。` },
    ],
  }));
  // 2. The work as recorded.
  const summary = work.summary;
  if (summary.open === null) {
    blocks.push(workspaceRailBlock(doc, {
      title: '仕事',
      content: [
        { text: `仕事の記録を${READ_STATE_TEXT[summary.state] ?? summary.state}（${readReasonText(summary.reason) ?? '理由不明'}）。仕事が0件という意味ではありません。` },
        onReload ? workspaceButton(doc, { text: 'もう一度読む', onClick: onReload }) : null,
      ],
    }));
  } else {
    blocks.push(...workStateBlocks(doc, { work, summary, onSelectGap, onSelectStatus }));
  }
  // 4. People and relations.
  const people = el(doc, 'ul', { className: 'bb-world-rail-list is-links' });
  for (const person of work.people) {
    people.append(linkLine(doc, person.link, person.name, `${person.roles.join('・')}${person.task_ids.length ? `（仕事${person.task_ids.length}件）` : ''}`));
  }
  // The project record's member field; participation recorded as Graph relations is listed below.
  if (work.members_state === 'unregistered' && !work.relations.some((relation) => relation.kind === 'member_of' && relation.link === 'recorded')) {
    people.append(linkLine(doc, 'recorded', 'メンバーは未登録です', 'プロジェクトの記録にもGraphの関係にも、メンバーの登録がありません'));
  }
  if (work.members_state === 'unreadable') people.append(linkLine(doc, 'unreadable', 'メンバーを読めませんでした', null));
  const relations = el(doc, 'ul', { className: 'bb-world-rail-list is-links' });
  for (const relation of work.relations.filter((entry) => entry.kind !== 'mentioned_person')) {
    relations.append(linkLine(doc, relation.link, relation.label, relation.basis));
  }
  const legend = el(doc, 'p', { className: 'bb-world-rail-note' });
  legend.textContent = Object.values(LINK_MARKS).map((entry) => `${entry.mark} ${entry.text}`).join('　');
  blocks.push(workspaceRailBlock(doc, { title: '人と関係', content: [people, relations, legend] }));
  // 5. Sources and times.
  blocks.push(workspaceRailBlock(doc, {
    title: '出典と時点',
    content: [
      workspaceDefinition(doc, [
        ['仕事', readLine(`タスクの記録 ${work.reads.tasks.count ?? '—'}件`, work.reads.tasks, shortTime(work.reads.tasks.read_at) ?? '時点不明')],
        ['人物', readLine('組織のGraph', work.reads.persons)],
        ['決定', readLine('組織のGraph', work.reads.decisions)],
        ['関係', readLine('組織のGraph', work.reads.relations)],
      ]),
      onReload ? workspaceButton(doc, { text: 'もう一度読む', onClick: onReload }) : null,
    ],
  }));
  return blocks;
}

/** The open tasks behind one count, to pick from. */
export function workPickBlock(doc, { title, sites, onSelectSite, note }) {
  const ul = el(doc, 'ul', { className: 'bb-world-rail-list is-plain' });
  for (const site of sites) {
    const li = el(doc, 'li');
    const button = el(doc, 'button', { className: 'bb-world-rail-pick', text: site.title, attrs: { type: 'button' } });
    button.addEventListener('click', () => onSelectSite(site.task_id));
    li.append(button, el(doc, 'small', { className: 'bb-world-rail-note', text: `記録上：${site.work.label}${site.work.due_at ? `・期限 ${shortDate(site.work.due_at)}` : ''}・断絶${site.gaps.length}種` }));
    ul.append(li);
  }
  return workspaceRailBlock(doc, { title, className: 'bb-world-pick', content: [note ? { text: note, className: 'bb-world-rail-note' } : null, sites.length ? ul : { text: '該当する仕事はありません' }] });
}

/** The blocks for one work site. */
export function workSiteBlocks(doc, { business, site, readAt, taskHref }) {
  const blocks = [];
  const due = site.work.due_at ? `${shortDate(site.work.due_at)}${site.work.past_due ? '（記録上の期限を過ぎて未完了）' : ''}` : null;
  blocks.push(workspaceRailBlock(doc, {
    title: '業務の記録（記録上の状態）',
    content: workspaceDefinition(doc, [
      ['状態', site.work.label],
      ['待ちの理由（原文）', site.work.status === 'waiting' ? site.work.waiting_on : null],
      ['期限', due],
      ['見直し予定', shortDate(site.work.review_at)],
      ['最終更新', shortTime(site.work.updated_at)],
      ['作成', shortTime(site.work.created_at)],
      ...(site.other_business_codes.length ? [['ほかの事業', `${site.other_business_codes.join('・')} にもまたがる`]] : []),
    ]),
  }));
  if (site.gaps.length) {
    const content = [];
    for (const gap of site.gaps) {
      const section = el(doc, 'div', { className: `bb-world-gap is-${gap.kind}` });
      section.append(el(doc, 'h4', { text: gap.label }));
      section.append(workspaceDefinition(doc, [
        ['分かっている事実', gap.fact],
        ['未接続・未確認', gap.unknown],
        ['出典と確認時点', `${sourceText(gap.source, readAt)}。確認時点：${gap.checked_at ? `${shortDate(gap.checked_at)}（${gap.checked_at_basis === 'text_note' ? '本文の確認メモ' : '記録の最終更新'}）` : '不明'}`],
        ['次に確認すること', gap.next_check],
        ['確認先', gap.check_with ? gap.check_with.name : { text: '記録からは分かりません', className: 'is-unrecorded' }],
      ]));
      content.push(section);
    }
    blocks.push(workspaceRailBlock(doc, { title: `把握できていないこと（${site.gaps.length}）`, className: 'bb-world-gaps', content }));
  } else {
    blocks.push(workspaceRailBlock(doc, { title: '把握できていないこと', content: { text: '構造化された欄から分かる断絶はありません。' } }));
  }
  const people = el(doc, 'ul', { className: 'bb-world-rail-list is-links' });
  for (const person of site.people) {
    const how = person.link === 'recorded' ? '担当欄' : `${person.stated_as_assignee ? '本文が担当として記載' : '本文に記載'}（${person.basis === 'text_person_id' ? '人物IDつき' : '氏名の一致'}）・担当欄には未接続`;
    people.append(linkLine(doc, person.link, person.name, how));
  }
  for (const actor of districtTaskActors(site)) {
    people.append(linkLine(doc, 'recorded', actor.name, `${actor.kind === 'agent' ? 'AI担当' : '担当'}・Taskの記録上の状態: ${site.work.label ?? site.work.status}・実行: ${actor.moving ? '稼働証跡確認済み' : '未確認または停止'}`));
  }
  if (site.actors_state === 'unconfirmed') people.append(linkLine(doc, 'unreadable', 'AI担当未確認', '現在の登録とTask委任を確認できませんでした'));
  for (const mention of site.ambiguous_mentions ?? []) {
    people.append(linkLine(doc, 'inferred', `「${mention.text}」`, `組織のGraphの${mention.candidates.map((candidate) => candidate.name).join('・')}のどれか一意に決まりません`));
  }
  blocks.push(workspaceRailBlock(doc, { title: '担当・関係者', content: site.people.length || site.ambiguous_mentions?.length || districtTaskActors(site).length || site.actors_state === 'unconfirmed' ? people : { text: '担当欄も本文も、登録された人物を挙げていません。' } }));
  const refs = el(doc, 'ul', { className: 'bb-world-rail-list' });
  for (const ref of site.source_refs) {
    const li = el(doc, 'li');
    if (ref.url && /^https:\/\//u.test(ref.url)) li.append(el(doc, 'a', { className: 'bb-world-rail-link', text: ref.label, attrs: { href: ref.url, target: '_blank', rel: 'noopener noreferrer' } }));
    else li.append(el(doc, 'span', { text: ref.label }));
    refs.append(li);
  }
  blocks.push(workspaceRailBlock(doc, {
    title: '成果物・出典',
    content: [
      site.expected_outcome ? workspaceDefinition(doc, [['完了条件（本文）', site.expected_outcome]]) : null,
      site.source_refs.length ? refs : { text: '出典・関連記録へのリンクは0件です。' },
      { text: 'タスクの記録には成果物や先方合意を記録する欄がありません。作成・提示・合意は、リンクか本文でしか分かりません。', className: 'bb-world-rail-note' },
    ],
  }));
  if (site.description) {
    const details = el(doc, 'details', { className: 'bb-world-original' });
    details.append(el(doc, 'summary', { text: '記録の本文（原文）を開く' }), el(doc, 'p', { text: site.description }));
    blocks.push(workspaceRailBlock(doc, { title: '本文', content: details }));
  }
  const href = typeof taskHref === 'function' ? taskHref(site) : null;
  blocks.push(workspaceRailBlock(doc, {
    title: '確認・訂正',
    content: href
      ? [el(doc, 'a', { className: 'bb-world-rail-link', text: '「タスク」でこの仕事を開く', attrs: { href } }), { text: '担当・期限・状態はタスク画面で直せます。保存先はタスクの正本で、世界にはもう一度読むと反映されます。本文の人物を担当欄へ接続するのも、そこで行います。', className: 'bb-world-rail-note' }]
      : { text: 'この画面からは直せません。タスクを管理している画面で直してください。', className: 'bb-world-rail-note' },
  }));
  blocks.push(workspaceRailBlock(doc, { title: '出典', content: workspaceDefinition(doc, [['記録', `${site.task_id}（版 ${site.source.version ?? '不明'}）`], ['事業', business.name]]) }));
  return blocks;
}

/**
 * How the district has grown (AC-22, AC-24): its stage, what it is counted from, how far to the next, and
 * what changed since this viewer was last here.  Counts of records, never a score.
 */
export function workGrowthBlock(doc, { stage, changes }) {
  const content = [];
  const head = el(doc, 'p', { className: 'bb-world-growth-stage' });
  head.append(el(doc, 'strong', { text: stage.label }), el(doc, 'span', { text: `　本設の建物 ${stage.permanent}軒・プレハブ ${stage.prefab}軒` }));
  content.push(head);
  content.push(workspaceDefinition(doc, [
    ['断絶の無い未完了', `${stage.clear_open} / ${stage.open}件`],
    ['次の段階', stage.next ? `${stage.next.label}まで本設の建物あと${stage.next.needed}軒` : 'いちばん上の段階です'],
  ]));
  content.push(el(doc, 'p', {
    className: 'bb-world-rail-note',
    text: '本設の建物＝完了して、出典か成果の記録がついた仕事。記録の無い完了はプレハブのままで、件数を増やしても街は育ちません。',
  }));
  if (changes) {
    if (changes.first) {
      content.push(el(doc, 'p', { className: 'bb-world-rail-note', text: 'この区画に初めて入りました。次回から、前回からの変化を出します（このブラウザに覚えます）。' }));
    } else if (!changes.items.length) {
      content.push(el(doc, 'p', { className: 'bb-world-rail-note', text: `前回（${shortTime(changes.since) ?? '時点不明'}）から変わったことはありません。` }));
    } else {
      const list = el(doc, 'ul', { className: 'bb-world-rail-list bb-world-growth-changes' });
      for (const [kind, count] of Object.entries(changes.counts)) {
        const text = changes.items.find((item) => item.kind === kind)?.text ?? kind;
        list.append(el(doc, 'li', { className: `is-${kind}`, text: `${text}　${count}件` }));
      }
      content.push(el(doc, 'p', { className: 'bb-world-growth-since', text: `前回（${shortTime(changes.since) ?? '時点不明'}）から` }), list);
    }
  }
  return workspaceRailBlock(doc, { title: '区画の育ち', content });
}

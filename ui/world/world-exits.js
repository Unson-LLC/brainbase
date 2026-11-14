/*
 * The tools a business uses (story-world-business-exits-v1).
 *
 * A host may pass `businessExits(business)` to the world.  Its answer is read here into what the
 * world draws: the read state of the answer, and each tool with its link, its state and what it
 * asks attention for.  Only `https:` links and links inside this host (starting with `/` or `?`)
 * are drawn; anything else is dropped and counted, never shown as a link.  A read that failed or is
 * not connected is never shown as zero tools.  Nothing here writes, and the host's answer is never
 * changed: the world draws copies.
 *
 * The words for the four states come from the owner's vocabulary (`exit_states` in the businesses
 * answer, as story-world-generic-graph-v1), over the defaults below.  No organization, member, role
 * or request concept lives here: `state` and `action` are whatever the host decided.
 */

import {
  makeWorkspaceElement as el,
  workspaceRailBlock,
} from '../../workspace-kit.js';
import { shortTime } from './world-work-rail.js';

export const WORLD_EXITS_CONTRACT_VERSION = 'brainbase.world-exits.v0';

/** How the host read the tools of a business. */
export const EXIT_READ_STATUSES = Object.freeze(['complete', 'partial', 'failed', 'not_connected']);

/** The states of a tool, with the words used when the owner gives none. */
export const EXIT_STATES = Object.freeze([
  Object.freeze({ key: 'available', label: '使える' }),
  Object.freeze({ key: 'restricted', label: '権限が必要' }),
  Object.freeze({ key: 'unknown', label: '未確認' }),
  Object.freeze({ key: 'unavailable', label: '読めない' }),
]);
const STATE_KEYS = new Set(EXIT_STATES.map((entry) => entry.key));

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Where a link goes: 'external' for an https: URL, 'internal' for a link inside this host (a path
 * starting with a single `/`, or a query starting with `?`), null for anything the world must not draw.
 */
export function exitHrefKind(href) {
  if (typeof href !== 'string' || !href || href !== href.trim() || /[\u0000-\u001f\u007f\\]/u.test(href)) return null;
  if (href.startsWith('?')) return 'internal';
  if (href.startsWith('/')) return href.startsWith('//') ? null : 'internal';
  if (!/^https:\/\//iu.test(href)) return null;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && url.hostname ? 'external' : null;
  } catch {
    return null;
  }
}

function attentionOf(value) {
  if (!value || typeof value !== 'object') return null;
  const count = typeof value.count === 'number' && Number.isInteger(value.count) && value.count >= 0 ? value.count : null;
  return { count, label: text(value.label), as_of: text(value.as_of) };
}

/**
 * Reads a host's answer into `{ status, read_at, reason, exits, dropped }`.  An answer the world
 * cannot understand is a failed read (`invalid_answer`), never an empty one.  A tool without an id
 * or a label, with a link it must not draw, or with an id already given is dropped and counted; an
 * action with such a link is dropped from its tool and counted.  A state the world does not know is
 * drawn as `unknown`, never as usable.
 */
export function normalizeBusinessExits(answer) {
  const invalid = { status: 'failed', read_at: null, reason: 'invalid_answer', exits: [], dropped: { exits: 0, actions: 0 } };
  if (!answer || typeof answer !== 'object' || !EXIT_READ_STATUSES.includes(answer.status)) return invalid;
  const readable = answer.status === 'complete' || answer.status === 'partial';
  if (readable && !Array.isArray(answer.exits)) return invalid;
  const dropped = { exits: 0, actions: 0 };
  const exits = [];
  const seen = new Set();
  for (const entry of readable ? answer.exits : []) {
    const id = text(entry?.id);
    const label = text(entry?.label);
    const target = exitHrefKind(entry?.href);
    if (!id || !label || !target || seen.has(id)) {
      dropped.exits += 1;
      continue;
    }
    seen.add(id);
    let action = null;
    if (entry.action != null) {
      const actionLabel = text(entry.action?.label);
      const actionTarget = exitHrefKind(entry.action?.href);
      if (actionLabel && actionTarget) action = { label: actionLabel, href: entry.action.href, target: actionTarget };
      else dropped.actions += 1;
    }
    exits.push({
      id,
      label,
      href: entry.href,
      target,
      state: STATE_KEYS.has(entry.state) ? entry.state : 'unknown',
      note: text(entry.note),
      action,
      attention: attentionOf(entry.attention),
    });
  }
  return { status: answer.status, read_at: text(answer.read_at), reason: text(answer.reason), exits, dropped };
}

/** The owner's word for a state (`exit_states` of the vocabulary), else the default. */
export function exitStateLabel(state, vocabulary) {
  const given = Array.isArray(vocabulary?.exit_states) ? vocabulary.exit_states.find((entry) => entry?.key === state) : null;
  return text(given?.label) ?? EXIT_STATES.find((entry) => entry.key === state)?.label ?? EXIT_STATES.find((entry) => entry.key === 'unknown').label;
}

/** What a tool asks attention for: its label, its count (never 0 for a missing count) and its time. */
export function attentionText(attention) {
  if (!attention) return null;
  const count = attention.count === null ? '件数は未確認' : `${attention.count}件`;
  const at = shortTime(attention.as_of);
  return `${attention.label ?? '知らせ'} ${count}（${at ? `${at}時点` : '時点不明'}）`;
}

/** The short words on a station's sign. */
export function attentionSignText(attention) {
  if (!attention) return null;
  return attention.count === null ? '件数未確認' : `${attention.count}件`;
}

/** The legend lines for the stations, in the owner's words for the states (AC-08). */
export function exitLegend(vocabulary) {
  const word = (state) => exitStateLabel(state, vocabulary);
  return [
    ['is-exit-available', `明かりのついた駅＝${word('available')}`],
    ['is-exit-restricted', `改札が閉じた駅＝${word('restricted')}`],
    ['is-exit-fog', `霧の駅＝${word('unknown')}・${word('unavailable')}`],
    ['is-exit-sign', '駅の看板の数＝その道具が知らせている件数（ホストが渡した値。数が無いときは「件数未確認」）'],
    ['is-exit-pick', '駅＝この事業で使う外の道具。選ぶと都市の詳細でその道具の行が選ばれます（駅からは外へ移りません）'],
  ];
}

const READ_FAILURE_TEXT = Object.freeze({ not_connected: '未接続', invalid_answer: '道具の答えの形式が正しくありません' });

function linkTo(doc, href, target, textValue, label) {
  const attrs = { href, 'aria-label': target === 'external' ? `${label}（新しいタブで開く）` : label };
  if (target === 'external') Object.assign(attrs, { target: '_blank', rel: 'noopener noreferrer' });
  return el(doc, 'a', { className: 'bb-world-rail-link bb-world-exit-link', text: textValue, attrs });
}

/**
 * The 「この事業の道具」 section of a city (AC-03, AC-05, AC-06).  `result` is a normalized answer, or
 * null while it is being read.  Returns the section and the row of `selectedId`, if any.
 */
export function exitsRailBlock(doc, { result, vocabulary, selectedId = null }) {
  const title = 'この事業の道具';
  if (!result) return { block: workspaceRailBlock(doc, { title, className: 'bb-world-exits', content: { text: '道具を読み込んでいます…' } }), selectedRow: null };
  if (result.status === 'failed' || result.status === 'not_connected') {
    const reason = READ_FAILURE_TEXT[result.reason] ?? result.reason ?? (result.status === 'not_connected' ? READ_FAILURE_TEXT.not_connected : '理由不明');
    return {
      block: workspaceRailBlock(doc, {
        title,
        className: 'bb-world-exits is-unreadable',
        content: [
          { text: '道具を読めません（0件とは確認できません）', className: 'bb-world-exits-unreadable' },
          { text: `理由：${result.status === 'not_connected' && result.reason ? `未接続（${reason}）` : reason}`, className: 'bb-world-rail-note' },
        ],
      }),
      selectedRow: null,
    };
  }
  const content = [];
  let selectedRow = null;
  if (result.status === 'partial') {
    content.push({ text: `一部だけ読めた${result.reason ? `（${result.reason}）` : ''}。読めていない道具は0件とは限りません。`, className: 'bb-world-rail-caveat' });
  }
  if (result.exits.length === 0) {
    content.push({ text: result.status === 'complete' ? 'この事業の道具は登録されていません' : '読めた範囲では道具は0件です' });
  } else {
    const list = el(doc, 'ul', { className: 'bb-world-rail-list bb-world-exit-list' });
    for (const exit of result.exits) {
      const selected = exit.id === selectedId;
      const row = el(doc, 'li', { className: `bb-world-exit is-${exit.state}${selected ? ' is-selected' : ''}`, attrs: { 'data-exit-id': exit.id, 'aria-current': selected ? 'true' : null } });
      const head = el(doc, 'div', { className: 'bb-world-exit-head' });
      head.append(
        el(doc, 'span', { className: 'bb-world-exit-label', text: exit.label }),
        el(doc, 'span', { className: `bb-world-exit-state is-${exit.state}`, text: exitStateLabel(exit.state, vocabulary) }),
      );
      row.append(head);
      if (exit.note) row.append(el(doc, 'small', { className: 'bb-world-rail-note', text: exit.note }));
      if (exit.attention) row.append(el(doc, 'small', { className: 'bb-world-exit-attention', text: attentionText(exit.attention) }));
      const links = el(doc, 'div', { className: 'bb-world-exit-links' });
      links.append(linkTo(doc, exit.href, exit.target, '開く', `${exit.label}を開く`));
      if (exit.action) links.append(linkTo(doc, exit.action.href, exit.action.target, exit.action.label, `${exit.label}：${exit.action.label}`));
      row.append(links);
      list.append(row);
      if (selected) selectedRow = row;
    }
    content.push(list);
  }
  if (result.dropped.exits) content.push({ text: `形式が正しくない道具、または開けないリンク（https:とこの画面の中のリンク以外）の道具${result.dropped.exits}件は描いていません。`, className: 'bb-world-rail-note' });
  if (result.dropped.actions) content.push({ text: `開けないリンクの操作${result.dropped.actions}件は出していません。`, className: 'bb-world-rail-note' });
  content.push({ text: `読み込み：${shortTime(result.read_at) ?? '時点不明'}。状態と件数はホストが渡した値で、世界からは書き換えません。`, className: 'bb-world-rail-note' });
  return { block: workspaceRailBlock(doc, { title, className: 'bb-world-exits', content }), selectedRow };
}

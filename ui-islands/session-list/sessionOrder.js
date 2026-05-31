// timeline ビューのセッション並び順（desktop / mobile 共有）。
//
// vanilla session-view の _getTimelineSessions / _getActivitySortPriority /
// _timelineAttentionSortBySessionId を移植したもの。島移行(PR #895)で sticky 機構が
// 脱落し、done-unread のセッションがインジケータ既読で idle に落ちた瞬間に最下部へ
// ジャンプしてリストが再シャッフルする退行が起きていた。これを復元する。
//
// このモジュールは副作用 import を持たない純粋ロジック(deriveUi を注入)なので
// vitest から直接 import してテストできる。

// 完了(priority 2)になったセッションの「完了時刻」を記憶する sticky マップ。
// module スコープなので desktop/mobile 両 island で共有され、再レンダーをまたいで保持される。
const attentionStickyById = new Map();

export function isFavorite(s) {
  return Boolean(s && s.favorite);
}

// activity 優先度: 作業中/入力待ち=1, 完了未読=2, それ以外(idle)=3
export function sessionSortPriority(ui) {
  const st = ui?.hookStatus?.state;
  if (st) {
    if (['running', 'starting', 'waiting'].includes(st)) return 1;
    if (st === 'done-unread') return 2;
    return 3;
  }
  if (['thinking', 'working', 'waiting'].includes(ui?.activity)) return 1;
  if (ui?.activity === 'done-unread') return 2;
  return 3;
}

export function sessionSortTimestamp(s, ui) {
  const live = ui?.hookStatus?.liveActivity;
  return live?.updatedAt || ui?.hookStatus?.lastDoneAt || s?.lastActivityAt || s?.createdAt || 0;
}

/**
 * favorite -> activity 優先度(sticky done) -> timestamp 降順 でソート。
 *
 * sticky-done: 一度 done-unread(2) になったセッションは完了時刻を記憶し、その後
 * インジケータが既読で idle(3) に落ちても priority 2・完了時刻のまま「完了枠」に留める。
 * 作業中(1) に戻ったら記憶を解除。これで活動変化のたびの再シャッフルを防ぐ。
 *
 * @param {Array} arr セッション配列
 * @param {string|null} currentId 現在のセッションID
 * @param {(id: string, opts: {currentSessionId: string|null}) => any} deriveUi UI状態導出関数(注入)
 */
export function orderTimelineSessions(arr, currentId, deriveUi) {
  const list = Array.isArray(arr) ? arr : [];

  // 一覧から消えたセッションの記憶を破棄(無限肥大防止)
  const visibleIds = new Set(list.map((s) => s.id));
  for (const id of attentionStickyById.keys()) {
    if (!visibleIds.has(id)) attentionStickyById.delete(id);
  }

  const metaById = new Map();
  for (const s of list) {
    const ui = deriveUi(s.id, { currentSessionId: currentId });
    const livePriority = sessionSortPriority(ui);
    const liveTs = sessionSortTimestamp(s, ui);

    if (livePriority === 1) {
      // 作業中になったら完了記憶を解除
      attentionStickyById.delete(s.id);
    } else if (livePriority === 2) {
      // 完了未読: 完了時刻を記憶
      attentionStickyById.set(s.id, liveTs);
    }

    const remembered = attentionStickyById.has(s.id);
    metaById.set(s.id, {
      priority: livePriority === 3 && remembered ? 2 : livePriority,
      timestamp: livePriority === 3 && remembered ? attentionStickyById.get(s.id) : liveTs
    });
  }

  return [...list].sort((a, b) => {
    const fa = isFavorite(a) ? 0 : 1;
    const fb = isFavorite(b) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const ma = metaById.get(a.id) || {};
    const mb = metaById.get(b.id) || {};
    const pa = ma.priority || 3;
    const pb = mb.priority || 3;
    if (pa !== pb) return pa - pb;
    return (mb.timestamp || 0) - (ma.timestamp || 0);
  });
}

// テスト用: sticky 状態をリセット
export function __resetStickyForTests() {
  attentionStickyById.clear();
}

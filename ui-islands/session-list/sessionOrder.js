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

// epoch ミリ秒へ正規化。ISO 文字列(createdAt/updatedAt 等)も数値へ変換する。
// これを通さないと createdAt(文字列) 同士の比較が NaN になり、idle 同士が
// 実質ソートされず配列の挿入順のまま並ぶ(時系列無視)。
function toMs(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// セッションオブジェクトに埋め込まれた hookStatus の活動時刻(最新のもの)。
// ライブ status ストアから外れた idle セッションでも、ここに直近の活動時刻が残る。
function embeddedRecency(s) {
  const hook = s?.hookStatus;
  if (!hook) return 0;
  return Math.max(toMs(hook.lastActivityAt), toMs(hook.lastWorkingAt), toMs(hook.lastDoneAt));
}

// 並び順に使う「直近の活動時刻」を epoch ミリ秒で返す。
//
// idle(無印) セッションは旧実装だと s.lastActivityAt(セッションには存在しない)
// → s.createdAt(ISO 文字列) に落ち、文字列比較が NaN になって時系列が無視されていた。
// セッション埋め込み hookStatus の活動時刻 → updatedAt → createdAt の順に
// 実際の recency をフォールバックし、必ず数値を返す。
export function sessionSortTimestamp(s, ui) {
  const live = ui?.hookStatus?.liveActivity;
  return (
    toMs(live?.updatedAt)
    || toMs(ui?.hookStatus?.lastDoneAt)
    || toMs(ui?.hookStatus?.lastActivityAt)
    || embeddedRecency(s)
    || toMs(s?.lastActivityAt)
    || toMs(s?.updatedAt)
    || toMs(s?.createdAt)
    || 0
  );
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

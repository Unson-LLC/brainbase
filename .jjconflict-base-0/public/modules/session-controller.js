/**
 * セッションAPI操作
 */

/**
 * 新規セッションを作成
 * @param {Object} sessionData
 */
export async function createSession(sessionData) {
  await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessionData)
  });
}

/**
 * セッションをアーカイブ（worktreeマージチェック付き）
 * @param {string} sessionId
 * @param {Object} options
 * @param {boolean} options.skipMergeCheck
 * @returns {Promise<Object>}
 */
export async function archiveSessionAPI(sessionId, options = {}) {
  const { skipMergeCheck = false } = options;
  const res = await fetch(`/api/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipMergeCheck })
  });
  return await res.json();
}

/**
 * Worktreeの状態を確認
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function checkWorktreeStatus(sessionId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/worktree-status`);
    return await res.json();
  } catch (error) {
    console.error('Failed to check worktree status:', error);
    return null;
  }
}

/**
 * セッションをマージ
 * @param {string} sessionId
 * @returns {Promise<Object>}
 */
export async function mergeSession(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return await res.json();
}

/**
 * セッションを復元（ttydを再起動）
 * engineを省略した場合、サーバー側でセッションに保存されたengineを使用
 * @param {string} sessionId
 * @param {string} [engine] - 'claude' or 'codex'（省略時はセッションのengineを使用）
 * @returns {Promise<Object>}
 */
export async function restoreSessionAPI(sessionId, engine) {
  const body = {};
  if (engine) body.engine = engine;
  const res = await fetch(`/api/sessions/${sessionId}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

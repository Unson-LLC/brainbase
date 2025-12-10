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
 * セッションをアーカイブ（マージチェック付き）
 * @param {string} sessionId
 * @returns {Promise<Object>}
 */
export async function archiveSessionAPI(sessionId) {
  const res = await fetch(`/api/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
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

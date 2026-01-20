/**
 * State API操作のヘルパー関数
 * DRY: 複数箇所で使われていたfetch/api/state処理を一元化
 */

const STATE_ENDPOINT = '/api/state';

/**
 * 状態を取得
 * @returns {Promise<{sessions: Array}>}
 */
export async function fetchState() {
  try {
    const res = await fetch(STATE_ENDPOINT);
    return await res.json();
  } catch (error) {
    console.error('Failed to fetch state:', error);
    return { sessions: [] };
  }
}

/**
 * Preferencesを取得
 * @returns {Promise<Object>}
 */
export async function fetchPreferences() {
  const state = await fetchState();
  return state.preferences || {};
}

/**
 * Preferencesを更新
 * @param {Object} updates - 更新内容
 * @returns {Promise<Object>} - 更新後のPreferences
 */
export async function updatePreferences(updates) {
  const state = await fetchState();
  const current = state.preferences || {};
  const next = {
    ...current,
    ...updates,
    user: {
      ...(current.user || {}),
      ...(updates?.user || {})
    }
  };

  await saveState({ ...state, preferences: next });
  return next;
}

/**
 * セッションからcomputed fieldsを除去
 * @param {Object} session - セッション
 * @returns {Object} - サニタイズされたセッション
 */
function sanitizeSession(session) {
  const { ttydRunning, runtimeStatus, ...persistentFields } = session;
  return persistentFields;
}

/**
 * 状態を保存
 * @param {Object} state - 保存する状態
 */
export async function saveState(state) {
  // Remove computed fields from sessions before saving
  const sanitizedState = {
    ...state,
    sessions: (state.sessions || []).map(sanitizeSession)
  };

  await fetch(STATE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedState)
  });
}

/**
 * セッションを更新
 * @param {string} sessionId - セッションID
 * @param {Object} updates - 更新内容
 */
export async function updateSession(sessionId, updates) {
  const state = await fetchState();
  const updatedSessions = state.sessions.map(s =>
    s.id === sessionId ? { ...s, ...updates } : s
  );
  await saveState({ ...state, sessions: updatedSessions });
}

/**
 * セッションを削除
 * @param {string} sessionId - セッションID
 */
export async function removeSession(sessionId) {
  const state = await fetchState();
  const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
  await saveState({ ...state, sessions: updatedSessions });
}

/**
 * セッションを追加
 * @param {Object} session - 追加するセッション
 */
export async function addSession(session) {
  const state = await fetchState();
  const updatedSessions = [...state.sessions, session];
  await saveState({ ...state, sessions: updatedSessions });
}

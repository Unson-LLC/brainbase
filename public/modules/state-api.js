import { httpClient } from './core/http-client.js';

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
    return await httpClient.get(STATE_ENDPOINT);
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

  await httpClient.post(STATE_ENDPOINT, sanitizedState);
}

/**
 * セッションを更新
 * @param {string} sessionId - セッションID
 * @param {Object} updates - 更新内容
 */
export async function updateSession(sessionId, updates) {
  await httpClient.patch(`${STATE_ENDPOINT}/sessions/${encodeURIComponent(sessionId)}`, updates);
}

/**
 * セッションを作成またはupsert
 * @param {Object} session - セッション
 * @returns {Promise<Object>}
 */
export async function createSession(session) {
  return await httpClient.post(`${STATE_ENDPOINT}/sessions`, sanitizeSession(session));
}

/**
 * セッションを削除
 * @param {string} sessionId - セッションID
 */
export async function removeSession(sessionId) {
  await httpClient.delete(`${STATE_ENDPOINT}/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * セッションを追加
 * @param {Object} session - 追加するセッション
 */
export async function addSession(session) {
  await createSession(session);
}

/**
 * セッション順序を保存
 * @param {string[]} orderedIds - セッションIDの順序
 * @returns {Promise<Object>}
 */
export async function saveSessionOrder(orderedIds) {
  return await httpClient.post(`${STATE_ENDPOINT}/sessions/reorder`, { orderedIds });
}

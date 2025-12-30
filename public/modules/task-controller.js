/**
 * タスクAPI操作
 */

import { getNextPriority } from './task-manager.js';

/**
 * APIからタスク一覧を取得
 * @returns {Promise<Array>}
 */
export async function loadTasksFromAPI() {
  try {
    const res = await fetch('/api/tasks');
    return await res.json();
  } catch (error) {
    console.error('Failed to load tasks:', error);
    return [];
  }
}

/**
 * タスクを完了にする
 * @param {string} taskId
 */
export async function completeTask(taskId) {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' })
  });
}

/**
 * タスクの優先度を下げる（defer）
 * statusもtodoに戻す（in-progressのままだとフォーカスに選ばれ続けるため）
 * @param {string} taskId
 * @param {string} currentPriority
 */
export async function deferTaskPriority(taskId, currentPriority) {
  const newPriority = getNextPriority(currentPriority);
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priority: newPriority, status: 'todo' })
  });
}

/**
 * タスクを更新
 * @param {string} taskId
 * @param {Object} updates
 */
export async function updateTask(taskId, updates) {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
}

/**
 * タスクを削除
 * @param {string} taskId
 */
export async function deleteTaskById(taskId) {
  await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE'
  });
}

/**
 * GoalSeekService V2
 *
 * Goal Seek V2 (Session Autopilot) のフロントエンドService層
 * HTTP APIベースの通信（旧WebSocket方式から移行）
 *
 * 機能:
 * - ゴールCRUD
 * - 監視開始/停止
 * - 問題一覧取得
 * - タイムライン取得
 * - エスカレーション回答
 * - ポーリングによるリアルタイム更新
 */

import { eventBus, EVENTS } from '../../core/event-bus.js';

export class GoalSeekService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || '/api/goal-seek';
        this.eventBus = eventBus;
        this._pollInterval = null;
        this._pollIntervalMs = options.pollIntervalMs || 5000;
        this._lastProblemCounts = new Map();
    }

    /**
     * 認証ヘッダーを取得
     * @private
     */
    _getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = localStorage.getItem('brainbase.auth.token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        // CSRF token
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta) {
            headers['X-CSRF-Token'] = csrfMeta.content;
        }
        return headers;
    }

    /**
     * API呼び出しヘルパー
     * @private
     */
    async _fetch(path, options = {}) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: this._getHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || `API error: ${res.status}`);
        }
        return res.json();
    }

    // ========== Goal CRUD ==========

    async createGoal({ sessionId, title, description, criteria, managerConfig }) {
        const goal = await this._fetch('/goals', {
            method: 'POST',
            body: JSON.stringify({ sessionId, title, description, criteria, managerConfig })
        });
        this.eventBus.emit(EVENTS.GOAL_CREATED, { goal });
        return goal;
    }

    async getGoals() {
        return this._fetch('/goals');
    }

    async getGoal(id) {
        return this._fetch(`/goals/${id}`);
    }

    async updateGoal(id, updates) {
        const goal = await this._fetch(`/goals/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates)
        });
        this.eventBus.emit(EVENTS.GOAL_UPDATED, { goal });
        return goal;
    }

    async deleteGoal(id) {
        await this._fetch(`/goals/${id}`, { method: 'DELETE' });
    }

    // ========== Monitoring ==========

    async startMonitoring(goalId) {
        const result = await this._fetch(`/goals/${goalId}/start-monitor`, { method: 'POST' });
        this.eventBus.emit(EVENTS.GOAL_MONITORING_STARTED, { goalId });
        this._startPolling();
        return result;
    }

    async stopMonitoring(goalId) {
        const result = await this._fetch(`/goals/${goalId}/stop-monitor`, { method: 'POST' });
        this.eventBus.emit(EVENTS.GOAL_MONITORING_STOPPED, { goalId });
        return result;
    }

    // ========== Problems & Timeline ==========

    async getProblems(goalId) {
        return this._fetch(`/goals/${goalId}/problems`);
    }

    async getTimeline(goalId) {
        return this._fetch(`/goals/${goalId}/timeline`);
    }

    // ========== Escalation ==========

    async respondToEscalation(escalationId, { choice, reason }) {
        const result = await this._fetch(`/escalations/${escalationId}/respond`, {
            method: 'POST',
            body: JSON.stringify({ choice, reason })
        });
        this.eventBus.emit(EVENTS.GOAL_ESCALATION_RESPONDED, { escalationId, choice });
        return result;
    }

    // ========== Status ==========

    async getStatus() {
        return this._fetch('/status');
    }

    // ========== Polling ==========

    _startPolling() {
        if (this._pollInterval) return;

        this._pollInterval = setInterval(async () => {
            try {
                await this._pollGoals();
            } catch (err) {
                console.error('[GoalSeekService] Poll error:', err.message);
            }
        }, this._pollIntervalMs);
    }

    stopPolling() {
        if (this._pollInterval) {
            clearInterval(this._pollInterval);
            this._pollInterval = null;
        }
    }

    async _pollGoals() {
        const goals = await this.getGoals();
        const monitoringGoals = goals.filter(g => g.status === 'monitoring' || g.status === 'problem');

        if (monitoringGoals.length === 0) {
            this.stopPolling();
            return;
        }

        for (const goal of monitoringGoals) {
            const problems = await this.getProblems(goal.id);
            const prevCount = this._lastProblemCounts.get(goal.id) || 0;

            if (problems.length > prevCount) {
                const newProblems = problems.slice(prevCount);
                for (const problem of newProblems) {
                    this.eventBus.emit(EVENTS.GOAL_PROBLEM_DETECTED, {
                        goalId: goal.id,
                        sessionId: goal.sessionId,
                        problem
                    });
                }
            }
            this._lastProblemCounts.set(goal.id, problems.length);

            this.eventBus.emit(EVENTS.GOAL_PROGRESS_UPDATE, { goal });
        }
    }

    /**
     * リソースクリーンアップ
     */
    cleanup() {
        this.stopPolling();
        this._lastProblemCounts.clear();
    }
}

export default GoalSeekService;

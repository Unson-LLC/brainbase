/**
 * Agent Service - Auto-Claude parallel agent pattern implementation
 *
 * 機能:
 * - 実行中エージェントの状態管理
 * - 最大12エージェントの並列実行追跡
 * - 進捗可視化用のデータ提供
 */

import { EVENTS } from '/modules/core/event-bus.js';

/**
 * Agent設定値
 */
export const AGENT_CONFIG = {
    MAX_CONCURRENT: 12,
    POLL_INTERVAL: 3000 // 3秒
};

/**
 * Agentステータス
 */
export const AGENT_STATUS = {
    STARTING: 'starting',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

/**
 * Agentタイプ
 */
export const AGENT_TYPE = {
    EXPLORE: 'explore',
    PLAN: 'plan',
    EDIT: 'edit',
    TEST: 'test',
    REVIEW: 'review',
    COMMIT: 'commit'
};

/**
 * Agentサービスクラス
 */
export class AgentService {
    constructor({ eventBus, store, httpClient }) {
        this.eventBus = eventBus;
        this.store = store;
        this.httpClient = httpClient;
    }

    /**
     * エージェント状態をロード
     * @returns {Promise<Object>} エージェント状態
     */
    async loadAgentStatus() {
        try {
            const response = await this.httpClient.get('/api/agents/status');
            const status = response || { running: [], completed: [], failed: [] };

            this.store.setState({
                agents: {
                    running: status.running || [],
                    completed: status.completed || [],
                    failed: status.failed || [],
                    maxConcurrent: AGENT_CONFIG.MAX_CONCURRENT
                }
            });

            await this.eventBus.emit(EVENTS.AGENTS_STATUS_UPDATED, { agents: status });

            return status;
        } catch (error) {
            console.error('Failed to load agent status:', error);
            return { running: [], completed: [], failed: [] };
        }
    }

    /**
     * 実行中エージェントを取得
     * @returns {Array} 実行中エージェント一覧
     */
    getRunningAgents() {
        const { agents } = this.store.getState();
        return agents?.running || [];
    }

    /**
     * 完了エージェントを取得
     * @returns {Array} 完了エージェント一覧
     */
    getCompletedAgents() {
        const { agents } = this.store.getState();
        return agents?.completed || [];
    }

    /**
     * 失敗エージェントを取得
     * @returns {Array} 失敗エージェント一覧
     */
    getFailedAgents() {
        const { agents } = this.store.getState();
        return agents?.failed || [];
    }

    /**
     * エージェント開始を記録
     * @param {Object} agentInfo - エージェント情報
     * @returns {Promise<Object>} 作成されたエージェント
     */
    async startAgent(agentInfo) {
        const { agents } = this.store.getState();

        // 最大同時実行数チェック
        if (agents.running.length >= AGENT_CONFIG.MAX_CONCURRENT) {
            throw new Error(`Maximum concurrent agents (${AGENT_CONFIG.MAX_CONCURRENT}) reached`);
        }

        const agent = {
            id: agentInfo.id || `agent-${Date.now()}`,
            sessionId: agentInfo.sessionId,
            type: agentInfo.type || AGENT_TYPE.EXPLORE,
            phase: agentInfo.phase || 'starting',
            progress: 0,
            status: AGENT_STATUS.STARTING,
            startedAt: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
            description: agentInfo.description || ''
        };

        this.store.setState({
            agents: {
                ...agents,
                running: [...agents.running, agent]
            }
        });

        await this.eventBus.emit(EVENTS.AGENT_STARTED, { agent });

        return agent;
    }

    /**
     * エージェント進捗を更新
     * @param {string} agentId - エージェントID
     * @param {Object} update - 更新情報
     */
    async updateAgentProgress(agentId, update) {
        const { agents } = this.store.getState();
        const agentIndex = agents.running.findIndex(a => a.id === agentId);

        if (agentIndex === -1) {
            console.warn(`Agent not found: ${agentId}`);
            return;
        }

        const updatedAgent = {
            ...agents.running[agentIndex],
            ...update,
            lastUpdate: new Date().toISOString()
        };

        const newRunning = [...agents.running];
        newRunning[agentIndex] = updatedAgent;

        this.store.setState({
            agents: {
                ...agents,
                running: newRunning
            }
        });

        await this.eventBus.emit(EVENTS.AGENTS_STATUS_UPDATED, {
            agents: { running: newRunning }
        });
    }

    /**
     * エージェント完了を記録
     * @param {string} agentId - エージェントID
     * @param {Object} result - 結果情報
     */
    async completeAgent(agentId, result = {}) {
        const { agents } = this.store.getState();
        const agentIndex = agents.running.findIndex(a => a.id === agentId);

        if (agentIndex === -1) {
            console.warn(`Agent not found: ${agentId}`);
            return;
        }

        const agent = agents.running[agentIndex];
        const completedAgent = {
            ...agent,
            status: AGENT_STATUS.COMPLETED,
            progress: 100,
            completedAt: new Date().toISOString(),
            result
        };

        const newRunning = agents.running.filter(a => a.id !== agentId);
        const newCompleted = [...agents.completed, completedAgent];

        this.store.setState({
            agents: {
                ...agents,
                running: newRunning,
                completed: newCompleted
            }
        });

        await this.eventBus.emit(EVENTS.AGENT_COMPLETED, { agent: completedAgent });
    }

    /**
     * エージェント失敗を記録
     * @param {string} agentId - エージェントID
     * @param {Object} error - エラー情報
     */
    async failAgent(agentId, error = {}) {
        const { agents } = this.store.getState();
        const agentIndex = agents.running.findIndex(a => a.id === agentId);

        if (agentIndex === -1) {
            console.warn(`Agent not found: ${agentId}`);
            return;
        }

        const agent = agents.running[agentIndex];
        const failedAgent = {
            ...agent,
            status: AGENT_STATUS.FAILED,
            failedAt: new Date().toISOString(),
            error: {
                message: error.message || 'Unknown error',
                type: error.type || 'unknown',
                context: error.context || {}
            }
        };

        const newRunning = agents.running.filter(a => a.id !== agentId);
        const newFailed = [...agents.failed, failedAgent];

        this.store.setState({
            agents: {
                ...agents,
                running: newRunning,
                failed: newFailed
            }
        });

        await this.eventBus.emit(EVENTS.AGENT_FAILED, { agent: failedAgent });
    }

    /**
     * 特定セッションのエージェントを取得
     * @param {string} sessionId - セッションID
     * @returns {Object} セッションのエージェント状態
     */
    getAgentsBySession(sessionId) {
        const { agents } = this.store.getState();

        return {
            running: agents.running.filter(a => a.sessionId === sessionId),
            completed: agents.completed.filter(a => a.sessionId === sessionId),
            failed: agents.failed.filter(a => a.sessionId === sessionId)
        };
    }

    /**
     * 統計情報を取得
     * @returns {Object} 統計情報
     */
    getStats() {
        const { agents } = this.store.getState();

        return {
            runningCount: agents.running.length,
            completedCount: agents.completed.length,
            failedCount: agents.failed.length,
            maxConcurrent: AGENT_CONFIG.MAX_CONCURRENT,
            availableSlots: AGENT_CONFIG.MAX_CONCURRENT - agents.running.length
        };
    }

    /**
     * 完了/失敗エージェントをクリア
     */
    clearHistory() {
        const { agents } = this.store.getState();

        this.store.setState({
            agents: {
                ...agents,
                completed: [],
                failed: []
            }
        });
    }
}

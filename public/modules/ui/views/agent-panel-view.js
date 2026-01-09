import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

/**
 * Agent Panel View - 実行中エージェントの可視化
 *
 * Auto-Claude parallel agent patternの実装
 * 最大12エージェントの並列実行状況をリアルタイム表示
 */
export class AgentPanelView {
    constructor({ agentService }) {
        this.agentService = agentService;
        this.eventBus = eventBus;
        this.store = appStore;
        this.container = null;
        this.isExpanded = true;
        this._unsubscribers = [];
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this._setupStoreSubscription();
        this.render();
    }

    /**
     * アンマウント
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * イベントリスナーの設定
     * @private
     */
    _setupEventListeners() {
        // エージェント状態更新イベント
        const unsub1 = this.eventBus.on(EVENTS.AGENTS_STATUS_UPDATED, () => {
            this.render();
        });

        // エージェント開始イベント
        const unsub2 = this.eventBus.on(EVENTS.AGENT_STARTED, () => {
            this.render();
        });

        // エージェント完了イベント
        const unsub3 = this.eventBus.on(EVENTS.AGENT_COMPLETED, () => {
            this.render();
        });

        // エージェント失敗イベント
        const unsub4 = this.eventBus.on(EVENTS.AGENT_FAILED, () => {
            this.render();
        });

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4);
    }

    /**
     * Store購読の設定
     * @private
     */
    _setupStoreSubscription() {
        const unsub = this.store.subscribeToSelector(
            state => state.agents,
            () => this.render()
        );
        this._unsubscribers.push(unsub);
    }

    /**
     * 描画
     */
    render() {
        if (!this.container) return;

        const agents = this.agentService.getRunningAgents();
        const stats = this.agentService.getStats();

        this.container.innerHTML = this._renderPanel(agents, stats);
        this._attachClickHandlers();

        // Lucide アイコン初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * パネル全体をレンダリング
     * @private
     */
    _renderPanel(agents, stats) {
        const hasAgents = agents.length > 0;

        return `
            <div class="agent-panel ${hasAgents ? 'has-agents' : 'empty'}">
                <div class="agent-panel-header" data-action="toggle">
                    <div class="agent-panel-title">
                        <i data-lucide="cpu" class="agent-panel-icon"></i>
                        <span>実行中エージェント</span>
                        <span class="agent-count">(${stats.runningCount}/${stats.maxConcurrent})</span>
                    </div>
                    <button class="agent-panel-toggle" data-action="toggle">
                        <i data-lucide="${this.isExpanded ? 'chevron-up' : 'chevron-down'}"></i>
                    </button>
                </div>
                <div class="agent-panel-body ${this.isExpanded ? 'expanded' : 'collapsed'}">
                    ${hasAgents
                        ? this._renderAgentList(agents)
                        : this._renderEmptyState()
                    }
                </div>
            </div>
        `;
    }

    /**
     * エージェントリストをレンダリング
     * @private
     */
    _renderAgentList(agents) {
        return `
            <div class="agent-list">
                ${agents.map(agent => this._renderAgentCard(agent)).join('')}
            </div>
        `;
    }

    /**
     * エージェントカードをレンダリング
     * @private
     */
    _renderAgentCard(agent) {
        const typeIcon = this._getTypeIcon(agent.type);
        const statusClass = this._getStatusClass(agent.status);
        const elapsedTime = this._formatElapsedTime(agent.startedAt);

        return `
            <div class="agent-card ${statusClass}" data-agent-id="${agent.id}">
                <div class="agent-card-header">
                    <i data-lucide="${typeIcon}" class="agent-type-icon"></i>
                    <span class="agent-type">${this._formatType(agent.type)}</span>
                </div>
                <div class="agent-card-body">
                    <div class="agent-session">${this._truncateSessionId(agent.sessionId)}</div>
                    <div class="agent-phase">${agent.phase || '-'}</div>
                </div>
                <div class="agent-card-footer">
                    <div class="agent-progress-container">
                        <div class="agent-progress-bar" style="width: ${agent.progress}%"></div>
                    </div>
                    <div class="agent-progress-info">
                        <span class="agent-percentage">${agent.progress}%</span>
                        <span class="agent-elapsed">${elapsedTime}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 空状態をレンダリング
     * @private
     */
    _renderEmptyState() {
        return `
            <div class="agent-empty-state">
                <i data-lucide="pause-circle" class="agent-empty-icon"></i>
                <span>エージェントは実行されていません</span>
            </div>
        `;
    }

    /**
     * クリックハンドラーをアタッチ
     * @private
     */
    _attachClickHandlers() {
        // パネル展開/折りたたみ
        const toggleElements = this.container.querySelectorAll('[data-action="toggle"]');
        toggleElements.forEach(el => {
            el.addEventListener('click', () => {
                this.isExpanded = !this.isExpanded;
                this.render();
            });
        });
    }

    /**
     * タイプに応じたアイコンを取得
     * @private
     */
    _getTypeIcon(type) {
        const icons = {
            explore: 'search',
            plan: 'map',
            edit: 'edit-3',
            test: 'check-circle',
            review: 'eye',
            commit: 'git-commit'
        };
        return icons[type] || 'cpu';
    }

    /**
     * ステータスに応じたクラスを取得
     * @private
     */
    _getStatusClass(status) {
        const classes = {
            starting: 'status-starting',
            running: 'status-running',
            completed: 'status-completed',
            failed: 'status-failed'
        };
        return classes[status] || '';
    }

    /**
     * タイプを表示用にフォーマット
     * @private
     */
    _formatType(type) {
        const labels = {
            explore: 'Explore',
            plan: 'Plan',
            edit: 'Edit',
            test: 'Test',
            review: 'Review',
            commit: 'Commit'
        };
        return labels[type] || type;
    }

    /**
     * セッションIDを短縮
     * @private
     */
    _truncateSessionId(sessionId) {
        if (!sessionId) return '-';
        if (sessionId.length <= 12) return sessionId;
        return sessionId.slice(0, 8) + '...';
    }

    /**
     * 経過時間をフォーマット
     * @private
     */
    _formatElapsedTime(startedAt) {
        if (!startedAt) return '-';

        const start = new Date(startedAt);
        const now = new Date();
        const diffMs = now - start;
        const diffSec = Math.floor(diffMs / 1000);

        if (diffSec < 60) {
            return `${diffSec}秒`;
        }

        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) {
            return `${diffMin}分`;
        }

        const diffHour = Math.floor(diffMin / 60);
        return `${diffHour}時間${diffMin % 60}分`;
    }
}

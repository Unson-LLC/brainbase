import { EVENTS } from '../../core/event-bus.js';
import { escapeHtml, iconHtml } from '../../ui-helpers.js';

/**
 * TimelineListView
 * タイムライン一覧表示のUIコンポーネント
 */
export class TimelineListView {
    constructor({ timelineService, eventBus }) {
        this.timelineService = timelineService;
        this.eventBus = eventBus;
        this.container = null;
        this._unsubscribers = [];
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        const unsub1 = this.eventBus.on(EVENTS.TIMELINE_LOADED, () => this.render());
        const unsub2 = this.eventBus.on(EVENTS.TIMELINE_ITEM_CREATED, () => this.render());
        const unsub3 = this.eventBus.on(EVENTS.TIMELINE_ITEM_UPDATED, () => this.render());
        const unsub4 = this.eventBus.on(EVENTS.TIMELINE_ITEM_DELETED, () => this.render());
        const unsub5 = this.eventBus.on(EVENTS.TIMELINE_FILTER_CHANGED, () => this.render());

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5);
    }

    /**
     * タイムラインをレンダリング
     */
    render() {
        if (!this.container) return;

        const items = this.timelineService.getTimelineItems();
        this.container.innerHTML = this._generateHTML(items);

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        this._attachEventHandlers();
    }

    /**
     * HTMLを生成
     * @param {Array} items - タイムライン項目配列
     * @returns {string} HTML文字列
     */
    _generateHTML(items) {
        let html = '<div class="timeline-list">';

        // ヘッダー（追加ボタン）
        html += `
            <div class="timeline-list-header">
                <button class="add-timeline-item btn-icon" title="項目を追加">
                    ${iconHtml('plus')}
                </button>
            </div>
        `;

        // フィルタバー
        html += this._renderFilterBar();

        // 項目一覧
        if (!items || items.length === 0) {
            html += '<div class="timeline-empty">タイムライン項目なし</div>';
        } else {
            html += this._renderGroupedItems(items);
        }

        html += '</div>';
        return html;
    }

    /**
     * フィルタバーのHTML生成
     * @returns {string} HTML文字列
     */
    _renderFilterBar() {
        return `
            <div class="timeline-filter-bar">
                <button class="timeline-filter-btn" data-filter-type="">全て</button>
                <button class="timeline-filter-btn" data-filter-type="session">セッション</button>
                <button class="timeline-filter-btn" data-filter-type="task">タスク</button>
                <button class="timeline-filter-btn" data-filter-type="manual">手動</button>
            </div>
        `;
    }

    /**
     * グループ化された項目のHTML生成
     * @param {Array} items - タイムライン項目配列
     * @returns {string} HTML文字列
     */
    _renderGroupedItems(items) {
        // グループ化
        const groups = this._groupItemsByDate(items);
        const groupOrder = ['今日', '昨日', '今週', 'それ以前'];

        let html = '';
        groupOrder.forEach(groupName => {
            const groupItems = groups[groupName];
            if (groupItems && groupItems.length > 0) {
                html += `
                    <div class="timeline-group">
                        <div class="timeline-group-header">${escapeHtml(groupName)}</div>
                        <div class="timeline-group-items">
                            ${groupItems.map(item => this._renderItem(item)).join('')}
                        </div>
                    </div>
                `;
            }
        });

        return html;
    }

    /**
     * 項目を日付でグループ化
     * @param {Array} items - タイムライン項目配列
     * @returns {Object} グループ化されたオブジェクト
     */
    _groupItemsByDate(items) {
        const groups = {};

        items.forEach(item => {
            const groupName = this._getDateGroup(item.timestamp);
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(item);
        });

        return groups;
    }

    /**
     * 日付からグループ名を取得
     * @param {string} timestamp - ISO8601形式のタイムスタンプ
     * @returns {string} グループ名
     */
    _getDateGroup(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);

        const itemDate = new Date(date);
        itemDate.setHours(0, 0, 0, 0);

        if (itemDate.getTime() === today.getTime()) {
            return '今日';
        } else if (itemDate.getTime() === yesterday.getTime()) {
            return '昨日';
        } else if (itemDate > weekAgo) {
            return '今週';
        } else {
            return 'それ以前';
        }
    }

    /**
     * 項目のHTML生成
     * @param {Object} item - タイムライン項目
     * @returns {string} HTML文字列
     */
    _renderItem(item) {
        const timeStr = this._formatTime(item.timestamp);
        const iconName = this._getTypeIcon(item.type);
        const hasLinkedTask = !!item.linkedTaskId;

        // リンク済みタスクバッジ
        const linkedTaskBadge = hasLinkedTask
            ? `<span class="linked-task-badge" data-task-id="${escapeHtml(item.linkedTaskId)}" title="タスクにリンク済み">
                ${iconHtml('link')}
               </span>`
            : '';

        // タスク作成ボタン（リンクされていない場合のみ）
        const createTaskButton = !hasLinkedTask
            ? `<button class="create-task-from-timeline btn-icon" data-id="${escapeHtml(item.id)}" title="タスクを作成">
                ${iconHtml('plus-square')}
               </button>`
            : '';

        return `
            <div class="timeline-list-item" data-item-id="${escapeHtml(item.id)}">
                <div class="timeline-item-icon">
                    ${iconHtml(iconName)}
                </div>
                <div class="timeline-item-content">
                    <div class="timeline-item-title">
                        ${escapeHtml(item.title || '')}
                        ${linkedTaskBadge}
                    </div>
                    <div class="timeline-item-meta">
                        <span class="timeline-item-time">${timeStr}</span>
                        <span class="timeline-item-type">${escapeHtml(item.type || '')}</span>
                    </div>
                </div>
                <div class="timeline-item-actions">
                    ${createTaskButton}
                    <button class="edit-timeline-item btn-icon" data-id="${escapeHtml(item.id)}" title="編集">
                        ${iconHtml('edit-2')}
                    </button>
                    <button class="delete-timeline-item btn-icon" data-id="${escapeHtml(item.id)}" title="削除">
                        ${iconHtml('trash-2')}
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * タイムスタンプをフォーマット
     * @param {string} timestamp - ISO8601形式のタイムスタンプ
     * @returns {string} HH:MM形式の時刻
     */
    _formatTime(timestamp) {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    /**
     * タイプに対応するアイコン名を取得
     * @param {string} type - タイムライン項目タイプ
     * @returns {string} Lucideアイコン名
     */
    _getTypeIcon(type) {
        const iconMap = {
            'session': 'terminal-square',
            'task': 'check-square',
            'manual': 'edit',
            'command': 'terminal',
            'system': 'settings'
        };
        return iconMap[type] || 'circle';
    }

    /**
     * DOMイベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        if (!this.container) return;

        // 追加ボタン
        const addBtn = this.container.querySelector('.add-timeline-item');
        if (addBtn) {
            addBtn.addEventListener('click', () => {
                this.eventBus.emit(EVENTS.TIMELINE_ADD_ITEM, {});
            });
        }

        // フィルタボタン
        this.container.querySelectorAll('.timeline-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const filterType = btn.dataset.filterType || null;
                this.timelineService.setFilter({ type: filterType || null });
            });
        });

        // 編集ボタン
        this.container.querySelectorAll('.edit-timeline-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.id;
                const items = this.timelineService.getTimelineItems();
                const item = items.find(i => i.id === itemId);
                if (item) {
                    this.eventBus.emit(EVENTS.TIMELINE_EDIT_ITEM, { item });
                }
            });
        });

        // 削除ボタン
        this.container.querySelectorAll('.delete-timeline-item').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.id;
                if (itemId && confirm('この項目を削除しますか？')) {
                    await this.timelineService.deleteItem(itemId);
                }
            });
        });

        // タスク作成ボタン
        this.container.querySelectorAll('.create-task-from-timeline').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const itemId = btn.dataset.id;
                const items = this.timelineService.getTimelineItems();
                const item = items.find(i => i.id === itemId);
                if (item) {
                    this.eventBus.emit(EVENTS.CREATE_TASK_FROM_TIMELINE, { item });
                }
            });
        });
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}

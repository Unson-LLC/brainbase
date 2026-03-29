// @ts-check
/**
 * BaseView - ビューコンポーネントの共通基底クラス
 *
 * 共通パターンを抽出:
 * - mount/unmount ライフサイクル
 * - EventBus購読管理（自動解除）
 * - container存在チェック
 */
export class BaseView {
    constructor() {
        this.container = null;
        this._unsubscribers = [];
    }

    /**
     * DOMコンテナにマウント
     * サブクラスで追加処理がある場合は override して super.mount(container) を呼ぶ
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * クリーンアップ
     * サブクラスで追加処理がある場合は override して super.unmount() を呼ぶ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }

    /**
     * レンダリング（サブクラスで実装必須）
     * @abstract
     */
    render() {
        // サブクラスでoverrideする
    }

    /**
     * イベントリスナーの設定（サブクラスでoverrideする）
     * @abstract
     */
    _setupEventListeners() {
        // サブクラスでoverrideする
    }

    /**
     * EventBus購読を登録（unmount時に自動解除）
     * @param {Function} unsubscriber - 購読解除関数
     */
    _addSubscription(unsubscriber) {
        this._unsubscribers.push(unsubscriber);
    }

    /**
     * 複数のEventBus購読を一括登録
     * @param {...Function} unsubscribers - 購読解除関数群
     */
    _addSubscriptions(...unsubscribers) {
        this._unsubscribers.push(...unsubscribers);
    }

    /**
     * 指定イベント発火時にrender()を自動呼び出し（購読管理付き）
     * @param {import('../../core/event-bus.js').EventBus} bus - EventBusインスタンス
     * @param {...string} events - イベント名
     */
    _renderOn(bus, ...events) {
        this._addSubscriptions(
            ...events.map(event => bus.on(event, () => this.render()))
        );
    }
}

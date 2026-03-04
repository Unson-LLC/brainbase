/**
 * Settings Plugin Registry
 *
 * Settings Panelを動的に登録・管理するPlugin APIを提供します。
 * Event-Drivenアーキテクチャに基づき、プラグインのライフサイクル管理を行います。
 */

export class SettingsPluginRegistry {
  constructor({ eventBus, store }) {
    this.eventBus = eventBus;
    this.store = store;
    this.plugins = new Map();
    this.panelOrder = [];
  }

  /**
   * プラグイン登録
   * @param {PluginDescriptor} descriptor - プラグイン設定
   * @param {string} descriptor.id - 一意識別子
   * @param {string} descriptor.displayName - タブ表示名
   * @param {number} [descriptor.order=100] - タブ表示順序（小さい方が左）
   * @param {PluginLifecycle} descriptor.lifecycle - ライフサイクルフック
   */
  register(descriptor) {
    const { id, displayName, order, lifecycle } = descriptor;

    // 重複チェック
    if (this.plugins.has(id)) {
      console.warn(`Plugin ${id} already registered`);
      return;
    }

    // ライフサイクル検証
    const validatedLifecycle = this._validateLifecycle(lifecycle);

    // プラグイン登録
    this.plugins.set(id, {
      id,
      displayName,
      order: order ?? 100,  // デフォルト: 100
      lifecycle: validatedLifecycle
    });

    // パネル表示順序を更新（orderでソート）
    this.panelOrder = Array.from(this.plugins.values())
      .sort((a, b) => a.order - b.order);

    // イベント発火
    this.eventBus.emit('settings:plugin-registered', { pluginId: id });
  }

  /**
   * プラグイン登録解除
   * @param {string} id - プラグインID
   */
  unregister(id) {
    if (!this.plugins.has(id)) {
      return;
    }

    const plugin = this.plugins.get(id);

    // destroy実行（存在する場合）
    if (plugin.lifecycle.destroy) {
      plugin.lifecycle.destroy();
    }

    // プラグイン削除
    this.plugins.delete(id);
    this.panelOrder = this.panelOrder.filter(p => p.id !== id);

    // イベント発火
    this.eventBus.emit('settings:plugin-unregistered', { pluginId: id });
  }

  /**
   * すべてのプラグインのデータをロード
   */
  async loadAll() {
    const loadPromises = Array.from(this.plugins.values()).map(plugin => {
      // load()が定義されている場合は実行、なければ空のPromiseを返す
      return plugin.lifecycle.load?.() || Promise.resolve();
    });

    const results = await Promise.allSettled(loadPromises);

    // エラーハンドリング
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const plugin = this.panelOrder[index];
        console.error(`Plugin ${plugin.id} load failed:`, result.reason);

        // エラーイベント発火
        this.eventBus.emit('settings:plugin-load-error', {
          pluginId: plugin.id,
          error: result.reason
        });
      }
    });

    // 完了イベント発火
    const loaded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    this.eventBus.emit('settings:plugins-loaded', {
      loaded,
      failed
    });
  }

  /**
   * 特定プラグインのパネルをレンダリング
   * @param {string} id - プラグインID
   * @param {HTMLElement} container - レンダリング先コンテナ
   */
  async renderPanel(id, container) {
    const plugin = this.plugins.get(id);

    if (!plugin) {
      throw new Error(`Plugin ${id} not found`);
    }

    if (!plugin.lifecycle.render) {
      console.warn(`Plugin ${id} has no render method`);
      return;
    }

    await plugin.lifecycle.render(container);

    // イベント発火
    this.eventBus.emit('settings:panel-rendered', { pluginId: id });
  }

  /**
   * タブナビゲーションを生成
   * @returns {Array<{id: string, displayName: string, order: number}>}
   */
  generateTabNavigation() {
    return this.panelOrder.map(plugin => ({
      id: plugin.id,
      displayName: plugin.displayName,
      order: plugin.order
    }));
  }

  /**
   * ライフサイクル検証
   * @private
   */
  _validateLifecycle(lifecycle) {
    if (!lifecycle.render) {
      throw new Error('Plugin must provide render() method');
    }

    return {
      load: lifecycle.load || (() => Promise.resolve()),
      render: lifecycle.render,
      destroy: lifecycle.destroy || (() => {})
    };
  }
}

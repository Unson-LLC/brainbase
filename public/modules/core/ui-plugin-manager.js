/**
 * UI Plugin Manager
 *
 * Core（常時ON）とPlugin（オプション）を分離し、config.ymlでON/OFF可能にする
 * SettingsPluginRegistryと同様のEvent-Drivenアーキテクチャを採用
 *
 * @example
 * // Plugin登録
 * pluginManager.register({
 *   id: 'bb-dashboard',
 *   displayName: 'Dashboard',
 *   layer: 'business',
 *   slots: ['view:dashboard'],
 *   lifecycle: {
 *     load: async () => { ... },
 *     render: async (container) => { ... },
 *     destroy: () => { ... }
 *   }
 * });
 */

import { eventBus } from './event-bus.js';

// Plugin関連イベント
export const PLUGIN_EVENTS = {
  PLUGIN_REGISTERED: 'plugin:registered',
  PLUGIN_UNREGISTERED: 'plugin:unregistered',
  PLUGIN_LOAD_ERROR: 'plugin:load-error',
  PLUGINS_LOADED: 'plugin:all-loaded',
  PLUGIN_MOUNTED: 'plugin:mounted',
  PLUGIN_UNMOUNTED: 'plugin:unmounted',
  CONFIG_LOADED: 'plugin:config-loaded'
};

// Plugin Layers（優先度順）
export const PLUGIN_LAYERS = {
  CORE: 'core',         // 必須（常時ON）
  BUSINESS: 'business', // ビジネスロジック（オプション）
  EXTENSION: 'extension' // 拡張機能（オプション）
};

/**
 * @typedef {Object} PluginDescriptor
 * @property {string} id - 一意識別子（例: 'bb-dashboard'）
 * @property {string} displayName - 表示名（例: 'Dashboard'）
 * @property {string} layer - レイヤー（'core' | 'business' | 'extension'）
 * @property {string[]} slots - マウント先スロット一覧（例: ['view:dashboard']）
 * @property {number} [priority=100] - 同一スロット内の優先度（小さい方が先）
 * @property {PluginLifecycle} lifecycle - ライフサイクルフック
 */

/**
 * @typedef {Object} PluginLifecycle
 * @property {Function} [load] - データロード（async）
 * @property {Function} render - DOMレンダリング（async, container引数）
 * @property {Function} [destroy] - クリーンアップ
 */

export class UIPluginManager {
  constructor({ store } = {}) {
    this.store = store;
    this.plugins = new Map();
    this.enabledPlugins = new Set(); // config.ymlから読み込んだ有効なPlugin ID
    this.mountedPlugins = new Map(); // slotId -> Set<pluginId>
    this._configLoaded = false;
  }

  /**
   * Plugin登録
   * @param {PluginDescriptor} descriptor - Plugin設定
   */
  register(descriptor) {
    const { id, displayName, layer, slots, priority, lifecycle } = descriptor;

    // 重複チェック
    if (this.plugins.has(id)) {
      console.warn(`[UIPluginManager] Plugin "${id}" already registered`);
      return;
    }

    // 必須フィールド検証
    if (!id || !displayName || !slots || !lifecycle?.render) {
      throw new Error(`[UIPluginManager] Invalid plugin descriptor: missing required fields (id, displayName, slots, lifecycle.render)`);
    }

    // ライフサイクル検証・正規化
    const normalizedLifecycle = {
      load: lifecycle.load || (() => Promise.resolve()),
      render: lifecycle.render,
      destroy: lifecycle.destroy || (() => {})
    };

    // Plugin登録
    this.plugins.set(id, {
      id,
      displayName,
      layer: layer || PLUGIN_LAYERS.BUSINESS,
      slots: Array.isArray(slots) ? slots : [slots],
      priority: priority ?? 100,
      lifecycle: normalizedLifecycle,
      mounted: false
    });

    console.log(`[UIPluginManager] Registered plugin: ${id} (layer: ${layer}, slots: ${slots.join(', ')})`);

    // イベント発火
    eventBus.emit(PLUGIN_EVENTS.PLUGIN_REGISTERED, { pluginId: id, slots });
  }

  /**
   * Plugin登録解除
   * @param {string} pluginId - Plugin ID
   */
  unregister(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    // マウント済みならアンマウント
    if (plugin.mounted) {
      this.unmount(pluginId);
    }

    // destroy実行
    try {
      plugin.lifecycle.destroy();
    } catch (error) {
      console.error(`[UIPluginManager] Failed to destroy plugin "${pluginId}":`, error);
    }

    // 削除
    this.plugins.delete(pluginId);

    console.log(`[UIPluginManager] Unregistered plugin: ${pluginId}`);
    eventBus.emit(PLUGIN_EVENTS.PLUGIN_UNREGISTERED, { pluginId });
  }

  /**
   * config.ymlからPlugin設定をロード
   * @returns {Promise<void>}
   */
  async loadConfig() {
    try {
      const res = await fetch('/api/config/plugins');
      if (!res.ok) {
        // API未実装の場合は全Plugin有効として扱う
        console.warn('[UIPluginManager] Plugin config API not available, enabling all plugins');
        this._enableAllPlugins();
        return;
      }

      const config = await res.json();
      const { enabled = [], disabled = [] } = config;

      // enabledリストがあればそれを使用、なければ全Plugin有効
      if (enabled.length > 0) {
        this.enabledPlugins = new Set(enabled);
      } else {
        // disabledリストで除外
        this._enableAllPlugins();
        disabled.forEach(id => this.enabledPlugins.delete(id));
      }

      this._configLoaded = true;
      console.log(`[UIPluginManager] Config loaded: ${this.enabledPlugins.size} plugins enabled`);
      eventBus.emit(PLUGIN_EVENTS.CONFIG_LOADED, { enabled: Array.from(this.enabledPlugins) });

    } catch (error) {
      console.warn('[UIPluginManager] Failed to load config, enabling all plugins:', error);
      this._enableAllPlugins();
    }
  }

  /**
   * 全Pluginを有効化
   * @private
   */
  _enableAllPlugins() {
    this.enabledPlugins = new Set(this.plugins.keys());
    // COREレイヤーは常に有効
    for (const [id, plugin] of this.plugins) {
      if (plugin.layer === PLUGIN_LAYERS.CORE) {
        this.enabledPlugins.add(id);
      }
    }
  }

  /**
   * Pluginが有効か判定
   * @param {string} pluginId - Plugin ID
   * @returns {boolean}
   */
  isEnabled(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return false;
    }

    // COREレイヤーは常に有効
    if (plugin.layer === PLUGIN_LAYERS.CORE) {
      return true;
    }

    // config未ロードなら有効として扱う（Fallback）
    if (!this._configLoaded) {
      return true;
    }

    return this.enabledPlugins.has(pluginId);
  }

  /**
   * 特定スロットの有効Pluginを取得
   * @param {string} slotId - スロットID（例: 'view:dashboard'）
   * @returns {Array} - 有効なPlugin一覧（priority順）
   */
  getPluginsForSlot(slotId) {
    const plugins = [];

    for (const [id, plugin] of this.plugins) {
      if (plugin.slots.includes(slotId) && this.isEnabled(id)) {
        plugins.push(plugin);
      }
    }

    // priority順にソート（小さい方が先）
    return plugins.sort((a, b) => a.priority - b.priority);
  }

  /**
   * 全Pluginをロード
   * @returns {Promise<{loaded: number, failed: number}>}
   */
  async loadAll() {
    const results = [];

    for (const [id, plugin] of this.plugins) {
      if (!this.isEnabled(id)) {
        continue;
      }

      try {
        await plugin.lifecycle.load();
        results.push({ id, status: 'fulfilled' });
      } catch (error) {
        console.error(`[UIPluginManager] Plugin "${id}" load failed:`, error);
        results.push({ id, status: 'rejected', error });
        eventBus.emit(PLUGIN_EVENTS.PLUGIN_LOAD_ERROR, { pluginId: id, error });
      }
    }

    const loaded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`[UIPluginManager] Loaded ${loaded} plugins, ${failed} failed`);
    eventBus.emit(PLUGIN_EVENTS.PLUGINS_LOADED, { loaded, failed });

    return { loaded, failed };
  }

  /**
   * 全Pluginを初期化（loadConfig + loadAll）
   * @returns {Promise<void>}
   */
  async initAll() {
    await this.loadConfig();
    await this.loadAll();
  }

  /**
   * Pluginをスロットにマウント
   * @param {string} pluginId - Plugin ID
   * @param {HTMLElement} container - マウント先コンテナ
   * @returns {Promise<void>}
   */
  async mount(pluginId, container) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`[UIPluginManager] Plugin "${pluginId}" not found`);
    }

    if (!this.isEnabled(pluginId)) {
      console.log(`[UIPluginManager] Plugin "${pluginId}" is disabled, skipping mount`);
      return;
    }

    try {
      await plugin.lifecycle.render(container);
      plugin.mounted = true;

      // マウント記録
      for (const slotId of plugin.slots) {
        if (!this.mountedPlugins.has(slotId)) {
          this.mountedPlugins.set(slotId, new Set());
        }
        this.mountedPlugins.get(slotId).add(pluginId);
      }

      console.log(`[UIPluginManager] Mounted plugin: ${pluginId}`);
      eventBus.emit(PLUGIN_EVENTS.PLUGIN_MOUNTED, { pluginId, slots: plugin.slots });
    } catch (error) {
      console.error(`[UIPluginManager] Failed to mount plugin "${pluginId}":`, error);
      throw error;
    }
  }

  /**
   * Pluginをアンマウント
   * @param {string} pluginId - Plugin ID
   */
  unmount(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !plugin.mounted) {
      return;
    }

    try {
      plugin.lifecycle.destroy();
      plugin.mounted = false;

      // マウント記録削除
      for (const slotId of plugin.slots) {
        this.mountedPlugins.get(slotId)?.delete(pluginId);
      }

      console.log(`[UIPluginManager] Unmounted plugin: ${pluginId}`);
      eventBus.emit(PLUGIN_EVENTS.PLUGIN_UNMOUNTED, { pluginId });
    } catch (error) {
      console.error(`[UIPluginManager] Failed to unmount plugin "${pluginId}":`, error);
    }
  }

  /**
   * 全Pluginをアンマウント
   */
  unmountAll() {
    for (const [id, plugin] of this.plugins) {
      if (plugin.mounted) {
        this.unmount(id);
      }
    }
  }

  /**
   * 登録済みPlugin一覧を取得
   * @returns {Array} - Plugin一覧
   */
  getRegisteredPlugins() {
    return Array.from(this.plugins.values());
  }

  /**
   * 有効Plugin一覧を取得
   * @returns {Array} - 有効なPlugin一覧
   */
  getEnabledPlugins() {
    return Array.from(this.plugins.values()).filter(p => this.isEnabled(p.id));
  }

  /**
   * Plugin情報を取得
   * @param {string} pluginId - Plugin ID
   * @returns {Object|null}
   */
  getPlugin(pluginId) {
    return this.plugins.get(pluginId) || null;
  }
}

// シングルトンインスタンス（DIContainerから取得することも可能）
let _instance = null;

export function getUIPluginManager(options = {}) {
  if (!_instance) {
    _instance = new UIPluginManager(options);
  }
  return _instance;
}

export function resetUIPluginManager() {
  if (_instance) {
    _instance.unmountAll();
    _instance = null;
  }
}

/**
 * Slot Manager
 *
 * data-plugin-slot属性を持つDOM要素を管理し、Pluginのマウント先を提供
 * UIPluginManagerと連携してPluginをスロットにマウント
 *
 * @example
 * // HTML側
 * <div data-plugin-slot="view:dashboard"></div>
 *
 * // JS側
 * const slotManager = new SlotManager({ pluginManager });
 * await slotManager.mountAllSlots();
 */

import { eventBus } from './event-bus.js';
import { PLUGIN_EVENTS } from './ui-plugin-manager.js';

// Slot関連イベント
export const SLOT_EVENTS = {
  SLOT_FOUND: 'slot:found',
  SLOT_MOUNTED: 'slot:mounted',
  SLOT_CLEARED: 'slot:cleared',
  ALL_SLOTS_MOUNTED: 'slot:all-mounted'
};

// 定義済みスロット一覧
export const SLOTS = {
  // メインビュー
  VIEW_DASHBOARD: 'view:dashboard',

  // サイドバー（右）
  SIDEBAR_FOCUS: 'sidebar:focus',
  SIDEBAR_NEXT_TASKS: 'sidebar:next-tasks',
  SIDEBAR_SCHEDULE: 'sidebar:schedule',
  SIDEBAR_INBOX: 'sidebar:inbox',

  // サイドバー（左）
  SIDEBAR_SESSIONS: 'sidebar:sessions',

  // フッター
  FOOTER_ACTIONS: 'footer:actions'
};

export class SlotManager {
  /**
   * @param {Object} options
   * @param {UIPluginManager} options.pluginManager - UIPluginManagerインスタンス
   * @param {HTMLElement} [options.root=document.body] - スロット検索のルート要素
   */
  constructor({ pluginManager, root = document.body }) {
    this.pluginManager = pluginManager;
    this.root = root;
    this.slots = new Map(); // slotId -> HTMLElement
    this.fallbacks = new Map(); // slotId -> fallbackFunction
  }

  /**
   * スロットを検索して登録
   * @returns {number} - 見つかったスロット数
   */
  discoverSlots() {
    const slotElements = this.root.querySelectorAll('[data-plugin-slot]');
    let count = 0;

    slotElements.forEach(element => {
      const slotId = element.dataset.pluginSlot;
      if (slotId) {
        this.slots.set(slotId, element);
        count++;
        eventBus.emit(SLOT_EVENTS.SLOT_FOUND, { slotId, element });
      }
    });

    console.log(`[SlotManager] Discovered ${count} slots`);
    return count;
  }

  /**
   * スロットを手動登録
   * @param {string} slotId - スロットID
   * @param {HTMLElement} element - DOM要素
   */
  registerSlot(slotId, element) {
    this.slots.set(slotId, element);
    console.log(`[SlotManager] Registered slot: ${slotId}`);
  }

  /**
   * スロットのFallback関数を登録
   * Pluginが無効な場合に呼び出される従来の初期化関数
   * @param {string} slotId - スロットID
   * @param {Function} fallbackFn - Fallback関数（container引数）
   */
  registerFallback(slotId, fallbackFn) {
    this.fallbacks.set(slotId, fallbackFn);
    console.log(`[SlotManager] Registered fallback for slot: ${slotId}`);
  }

  /**
   * スロットを取得
   * @param {string} slotId - スロットID
   * @returns {HTMLElement|null}
   */
  getSlot(slotId) {
    return this.slots.get(slotId) || null;
  }

  /**
   * スロットが存在するか確認
   * @param {string} slotId - スロットID
   * @returns {boolean}
   */
  hasSlot(slotId) {
    return this.slots.has(slotId);
  }

  /**
   * スロットをクリア
   * @param {string} slotId - スロットID
   */
  clearSlot(slotId) {
    const element = this.slots.get(slotId);
    if (element) {
      element.innerHTML = '';
      eventBus.emit(SLOT_EVENTS.SLOT_CLEARED, { slotId });
    }
  }

  /**
   * 全スロットをクリア
   */
  clearAllSlots() {
    for (const slotId of this.slots.keys()) {
      this.clearSlot(slotId);
    }
  }

  /**
   * 特定スロットにPluginをマウント
   * @param {string} slotId - スロットID
   * @returns {Promise<{mounted: number, fallback: boolean}>}
   */
  async mountSlot(slotId) {
    const element = this.slots.get(slotId);
    if (!element) {
      console.warn(`[SlotManager] Slot "${slotId}" not found`);
      return { mounted: 0, fallback: false };
    }

    // このスロット向けの有効なPluginを取得
    const plugins = this.pluginManager.getPluginsForSlot(slotId);

    if (plugins.length === 0) {
      // Pluginがない場合はFallbackを実行
      const fallback = this.fallbacks.get(slotId);
      if (fallback) {
        console.log(`[SlotManager] No plugins for slot "${slotId}", using fallback`);
        try {
          await fallback(element);
          return { mounted: 0, fallback: true };
        } catch (error) {
          console.error(`[SlotManager] Fallback for slot "${slotId}" failed:`, error);
        }
      }
      return { mounted: 0, fallback: false };
    }

    // Pluginをマウント
    let mounted = 0;
    for (const plugin of plugins) {
      try {
        await this.pluginManager.mount(plugin.id, element);
        mounted++;
      } catch (error) {
        console.error(`[SlotManager] Failed to mount plugin "${plugin.id}" to slot "${slotId}":`, error);
      }
    }

    eventBus.emit(SLOT_EVENTS.SLOT_MOUNTED, { slotId, mounted });
    return { mounted, fallback: false };
  }

  /**
   * 全スロットにPluginをマウント
   * @returns {Promise<{total: number, mounted: number, fallbacks: number}>}
   */
  async mountAllSlots() {
    const results = {
      total: this.slots.size,
      mounted: 0,
      fallbacks: 0
    };

    for (const slotId of this.slots.keys()) {
      const result = await this.mountSlot(slotId);
      results.mounted += result.mounted;
      if (result.fallback) {
        results.fallbacks++;
      }
    }

    console.log(`[SlotManager] Mounted ${results.mounted} plugins, ${results.fallbacks} fallbacks`);
    eventBus.emit(SLOT_EVENTS.ALL_SLOTS_MOUNTED, results);

    return results;
  }

  /**
   * 既存のID属性からスロットを自動検出・登録
   * 既存のDOM構造を維持しつつPlugin化するためのヘルパー
   * @param {Object} mapping - { elementId: slotId } の形式
   */
  mapExistingElements(mapping) {
    for (const [elementId, slotId] of Object.entries(mapping)) {
      const element = document.getElementById(elementId);
      if (element) {
        // data-plugin-slot属性を追加
        element.dataset.pluginSlot = slotId;
        this.slots.set(slotId, element);
        console.log(`[SlotManager] Mapped existing element #${elementId} to slot "${slotId}"`);
      } else {
        console.warn(`[SlotManager] Element #${elementId} not found for slot "${slotId}"`);
      }
    }
  }

  /**
   * スロット一覧を取得
   * @returns {Array<{slotId: string, element: HTMLElement}>}
   */
  getAllSlots() {
    return Array.from(this.slots.entries()).map(([slotId, element]) => ({
      slotId,
      element
    }));
  }

  /**
   * デバッグ用: スロット状態を出力
   */
  debug() {
    console.group('[SlotManager] Debug Info');
    console.log('Slots:', this.slots.size);
    for (const [slotId, element] of this.slots) {
      const plugins = this.pluginManager.getPluginsForSlot(slotId);
      console.log(`  ${slotId}:`, {
        element: element.tagName + (element.id ? `#${element.id}` : ''),
        plugins: plugins.map(p => p.id)
      });
    }
    console.log('Fallbacks:', Array.from(this.fallbacks.keys()));
    console.groupEnd();
  }
}

// ファクトリ関数
export function createSlotManager(options) {
  return new SlotManager(options);
}

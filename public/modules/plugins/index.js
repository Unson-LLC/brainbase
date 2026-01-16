/**
 * brainbase UI Plugins - Entry Point
 *
 * 全てのビジネスPluginをエクスポート
 * app.jsからimportして一括登録する
 *
 * @example
 * import { registerAllPlugins } from './modules/plugins/index.js';
 * registerAllPlugins(pluginManager);
 */

// Core Plugins
import { bbDashboardPlugin } from './bb-dashboard/index.js';
import { bbFocusTaskPlugin, bbNextTasksPlugin, bbTasksPlugin } from './bb-tasks/index.js';
import { bbInboxPlugin } from './bb-inbox/index.js';
import { bbSchedulePlugin } from './bb-schedule/index.js';

/**
 * 全Pluginをエクスポート
 */
export {
  bbDashboardPlugin,
  bbFocusTaskPlugin,
  bbNextTasksPlugin,
  bbTasksPlugin,
  bbInboxPlugin,
  bbSchedulePlugin
};

/**
 * 全ビジネスPlugin一覧
 */
export const businessPlugins = [
  bbDashboardPlugin,
  bbFocusTaskPlugin,
  bbNextTasksPlugin,
  bbInboxPlugin,
  bbSchedulePlugin
];

/**
 * UIPluginManagerに全Pluginを登録
 * @param {UIPluginManager} pluginManager - UIPluginManagerインスタンス
 */
export function registerAllPlugins(pluginManager) {
  console.log('[Plugins] Registering all business plugins...');

  for (const plugin of businessPlugins) {
    try {
      pluginManager.register(plugin);
    } catch (error) {
      console.error(`[Plugins] Failed to register plugin "${plugin.id}":`, error);
    }
  }

  console.log(`[Plugins] Registered ${businessPlugins.length} plugins`);
}

/**
 * Plugin IDから Plugin Descriptorを取得
 * @param {string} pluginId - Plugin ID
 * @returns {Object|null}
 */
export function getPluginById(pluginId) {
  return businessPlugins.find(p => p.id === pluginId) || null;
}

/**
 * デバッグ用: 登録済みPlugin一覧を出力
 */
export function debugPlugins() {
  console.group('[Plugins] Registered Plugins');
  for (const plugin of businessPlugins) {
    console.log(`  ${plugin.id}: ${plugin.displayName} (layer: ${plugin.layer}, slots: ${plugin.slots.join(', ')})`);
  }
  console.groupEnd();
}

/**
 * bb-dashboard Plugin
 *
 * Dashboard表示機能をPlugin化
 * DashboardControllerをラップしてPlugin descriptor形式で提供
 */

import { PLUGIN_LAYERS } from '../../core/ui-plugin-manager.js';

let dashboardController = null;

/**
 * bb-dashboard Plugin Descriptor
 */
export const bbDashboardPlugin = {
  id: 'bb-dashboard',
  displayName: 'Dashboard',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['view:dashboard'],
  priority: 10,
  lifecycle: {
    /**
     * データロード
     */
    load: async () => {
      // DashboardControllerはrender時に動的インポート
      console.log('[bb-dashboard] Plugin loaded');
    },

    /**
     * DOMレンダリング
     * @param {HTMLElement} container - マウント先コンテナ
     */
    render: async (container) => {
      try {
        // 動的インポートでDashboardControllerを取得
        const { DashboardController } = await import('../../dashboard-controller.js');

        dashboardController = new DashboardController();
        await dashboardController.init();

        // グローバルにエクスポート（既存コードとの互換性）
        window.dashboardController = dashboardController;

        console.log('[bb-dashboard] Plugin rendered');
      } catch (error) {
        console.error('[bb-dashboard] Failed to render:', error);
        // エラー時はプレースホルダーを表示
        container.innerHTML = `
          <div class="plugin-error">
            <p>Dashboard の読み込みに失敗しました</p>
            <small>${error.message}</small>
          </div>
        `;
      }
    },

    /**
     * クリーンアップ
     */
    destroy: () => {
      dashboardController = null;
      window.dashboardController = null;
      console.log('[bb-dashboard] Plugin destroyed');
    }
  }
};

export default bbDashboardPlugin;

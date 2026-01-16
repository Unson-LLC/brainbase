/**
 * bb-inbox Plugin
 *
 * Inbox（通知）表示機能をPlugin化
 * InboxViewをラップしてPlugin descriptor形式で提供
 */

import { PLUGIN_LAYERS } from '../../core/ui-plugin-manager.js';
import { InboxView } from '../../ui/views/inbox-view.js';

let inboxView = null;

/**
 * bb-inbox Plugin Descriptor
 */
export const bbInboxPlugin = {
  id: 'bb-inbox',
  displayName: 'Inbox',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['sidebar:inbox'],
  priority: 50,
  lifecycle: {
    /**
     * データロード
     */
    load: async () => {
      console.log('[bb-inbox] Plugin loaded');
    },

    /**
     * DOMレンダリング
     * InboxViewは特殊で、複数のDOM要素（トリガーボタン、ドロップダウン等）を扱う
     * @param {HTMLElement} container - マウント先コンテナ（ただしInboxViewは内部で要素を取得）
     * @param {Object} services - 依存サービス
     */
    render: async (container, { inboxService, httpClient } = {}) => {
      try {
        // サービスが渡されない場合はグローバルから取得
        if (!inboxService) {
          inboxService = window.brainbaseApp?.inboxService;
        }
        if (!httpClient) {
          const { httpClient: hc } = await import('../../core/http-client.js');
          httpClient = hc;
        }

        if (!inboxService) {
          throw new Error('InboxService not available');
        }

        inboxView = new InboxView({ inboxService, httpClient });
        inboxView.mount(); // InboxViewは内部で要素を取得するのでcontainerは使わない

        console.log('[bb-inbox] Plugin rendered');
      } catch (error) {
        console.error('[bb-inbox] Failed to render:', error);
        // Inboxはドロップダウン形式なのでエラー表示は別途必要
      }
    },

    /**
     * クリーンアップ
     */
    destroy: () => {
      if (inboxView && inboxView.unmount) {
        inboxView.unmount();
      }
      inboxView = null;
      console.log('[bb-inbox] Plugin destroyed');
    }
  }
};

export default bbInboxPlugin;

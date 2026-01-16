/**
 * bb-schedule Plugin
 *
 * スケジュール（タイムライン）表示機能をPlugin化
 * TimelineViewをラップしてPlugin descriptor形式で提供
 */

import { PLUGIN_LAYERS } from '../../core/ui-plugin-manager.js';
import { TimelineView } from '../../ui/views/timeline-view.js';

let timelineView = null;

/**
 * bb-schedule Plugin Descriptor
 */
export const bbSchedulePlugin = {
  id: 'bb-schedule',
  displayName: 'Schedule',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['sidebar:schedule'],
  priority: 30,
  lifecycle: {
    /**
     * データロード
     */
    load: async () => {
      console.log('[bb-schedule] Plugin loaded');
    },

    /**
     * DOMレンダリング
     * @param {HTMLElement} container - マウント先コンテナ
     * @param {Object} services - 依存サービス
     */
    render: async (container, { scheduleService } = {}) => {
      try {
        // サービスが渡されない場合はグローバルから取得
        if (!scheduleService) {
          scheduleService = window.brainbaseApp?.scheduleService;
        }

        if (!scheduleService) {
          throw new Error('ScheduleService not available');
        }

        timelineView = new TimelineView({ scheduleService });
        timelineView.mount(container);

        console.log('[bb-schedule] Plugin rendered');
      } catch (error) {
        console.error('[bb-schedule] Failed to render:', error);
        container.innerHTML = `
          <div class="plugin-error">
            <p>Schedule の読み込みに失敗しました</p>
            <small>${error.message}</small>
          </div>
        `;
      }
    },

    /**
     * クリーンアップ
     */
    destroy: () => {
      if (timelineView) {
        timelineView.unmount();
        timelineView = null;
      }
      console.log('[bb-schedule] Plugin destroyed');
    }
  }
};

export default bbSchedulePlugin;

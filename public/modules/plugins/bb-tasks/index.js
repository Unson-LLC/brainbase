/**
 * bb-tasks Plugin
 *
 * タスク表示機能（Focus Task + Next Tasks）をPlugin化
 * TaskViewとNextTasksViewをラップしてPlugin descriptor形式で提供
 */

import { PLUGIN_LAYERS } from '../../core/ui-plugin-manager.js';
import { TaskView } from '../../ui/views/task-view.js';
import { NextTasksView } from '../../ui/views/next-tasks-view.js';

let focusTaskView = null;
let nextTasksView = null;

/**
 * Focus Task用 Plugin Descriptor
 */
export const bbFocusTaskPlugin = {
  id: 'bb-focus-task',
  displayName: 'Focus Task',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['sidebar:focus'],
  priority: 10,
  lifecycle: {
    load: async () => {
      console.log('[bb-focus-task] Plugin loaded');
    },

    render: async (container, { taskService }) => {
      try {
        // taskServiceが渡されない場合はDIから取得を試みる
        if (!taskService) {
          // グローバルアプリからサービスを取得
          taskService = window.brainbaseApp?.taskService;
        }

        if (!taskService) {
          throw new Error('TaskService not available');
        }

        focusTaskView = new TaskView({ taskService });
        focusTaskView.mount(container);

        console.log('[bb-focus-task] Plugin rendered');
      } catch (error) {
        console.error('[bb-focus-task] Failed to render:', error);
        container.innerHTML = `
          <div class="plugin-error">
            <p>Focus Task の読み込みに失敗しました</p>
            <small>${error.message}</small>
          </div>
        `;
      }
    },

    destroy: () => {
      if (focusTaskView) {
        focusTaskView.unmount();
        focusTaskView = null;
      }
      console.log('[bb-focus-task] Plugin destroyed');
    }
  }
};

/**
 * Next Tasks用 Plugin Descriptor
 */
export const bbNextTasksPlugin = {
  id: 'bb-next-tasks',
  displayName: 'Next Tasks',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['sidebar:next-tasks'],
  priority: 20,
  lifecycle: {
    load: async () => {
      console.log('[bb-next-tasks] Plugin loaded');
    },

    render: async (container, { taskService }) => {
      try {
        if (!taskService) {
          taskService = window.brainbaseApp?.taskService;
        }

        if (!taskService) {
          throw new Error('TaskService not available');
        }

        nextTasksView = new NextTasksView({ taskService });
        nextTasksView.mount(container);

        console.log('[bb-next-tasks] Plugin rendered');
      } catch (error) {
        console.error('[bb-next-tasks] Failed to render:', error);
        container.innerHTML = `
          <div class="plugin-error">
            <p>Next Tasks の読み込みに失敗しました</p>
            <small>${error.message}</small>
          </div>
        `;
      }
    },

    destroy: () => {
      if (nextTasksView) {
        nextTasksView.unmount();
        nextTasksView = null;
      }
      console.log('[bb-next-tasks] Plugin destroyed');
    }
  }
};

/**
 * Tasks全体をまとめたPlugin（後方互換用）
 */
export const bbTasksPlugin = {
  id: 'bb-tasks',
  displayName: 'Tasks',
  layer: PLUGIN_LAYERS.BUSINESS,
  slots: ['sidebar:focus', 'sidebar:next-tasks'],
  priority: 10,
  lifecycle: {
    load: async () => {
      console.log('[bb-tasks] Plugin loaded');
    },

    render: async (container) => {
      // このPluginは個別のPluginで処理されるため、ここでは何もしない
      console.log('[bb-tasks] Plugin render called (delegated to individual plugins)');
    },

    destroy: () => {
      bbFocusTaskPlugin.lifecycle.destroy();
      bbNextTasksPlugin.lifecycle.destroy();
      console.log('[bb-tasks] Plugin destroyed');
    }
  }
};

export default bbTasksPlugin;

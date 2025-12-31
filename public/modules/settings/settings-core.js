/**
 * Settings Core Module
 *
 * Core Settings実装（OSS版）
 * Overview PanelとProjects PanelをPlugin Registryに登録します。
 */

import { eventBus } from '../core/event-bus.js';
import { appStore } from '../core/store.js';

export class SettingsCore {
  constructor({ pluginRegistry, ui, apiClient }) {
    this.pluginRegistry = pluginRegistry;
    this.ui = ui;
    this.apiClient = apiClient;
    this.currentTab = 'overview';  // デフォルトタブ
  }

  /**
   * Settings初期化
   */
  async init() {
    // 1. UI初期化
    this.ui.init();

    // 2. Core Pluginを登録
    this._registerCorePlugins();

    // 3. Modalイベント設定
    this.ui.onOpen(async () => {
      await this._loadAllData();
      this._renderTabs();
      await this._switchTab(this.currentTab);
    });

    this.ui.onTabSwitch(async (tabId) => {
      this.currentTab = tabId;
      await this._switchTab(tabId);
    });

    // 4. EventBusリスニング
    this._setupEventListeners();
  }

  /**
   * Core Pluginを登録
   * @private
   */
  _registerCorePlugins() {
    // Overview Panel登録
    this.pluginRegistry.register({
      id: 'overview',
      displayName: 'Overview',
      order: 0,
      lifecycle: {
        load: async () => {
          const integrity = await this.apiClient.getIntegrity();
          appStore.setState({ settingsIntegrity: integrity });
        },
        render: async (container) => {
          const integrity = appStore.getState().settingsIntegrity;
          container.innerHTML = this._renderOverviewHTML(integrity);

          // Lucide icons再初期化
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      }
    });

    // Projects Panel登録
    this.pluginRegistry.register({
      id: 'projects',
      displayName: 'Projects',
      order: 10,
      lifecycle: {
        load: async () => {
          const config = await this.apiClient.getConfig();
          appStore.setState({ settingsProjects: config.projects });
        },
        render: async (container) => {
          const projects = appStore.getState().settingsProjects;
          container.innerHTML = this._renderProjectsHTML(projects);
        }
      }
    });
  }

  /**
   * 全プラグインのデータをロード
   * @private
   */
  async _loadAllData() {
    await this.pluginRegistry.loadAll();
  }

  /**
   * タブナビゲーションをレンダリング
   * @private
   */
  _renderTabs() {
    const tabs = this.pluginRegistry.generateTabNavigation();
    this.ui.renderTabs(tabs, this.currentTab);
  }

  /**
   * タブ切り替え
   * @private
   * @param {string} tabId - タブID
   */
  async _switchTab(tabId) {
    this.ui.activateTab(tabId);

    const container = document.getElementById(`${tabId}-panel`);
    if (!container) {
      console.error(`Panel container for ${tabId} not found`);
      return;
    }

    await this.pluginRegistry.renderPanel(tabId, container);
  }

  /**
   * EventBusリスニング
   * @private
   */
  _setupEventListeners() {
    eventBus.on('settings:plugin-registered', ({ pluginId }) => {
      console.log(`Plugin registered: ${pluginId}`);

      // Modal開いている場合はタブを再描画
      if (this.ui.isOpen()) {
        this._renderTabs();
      }
    });

    eventBus.on('settings:plugin-load-error', ({ pluginId, error }) => {
      console.error(`Plugin ${pluginId} failed to load:`, error);
      // TODO: エラー表示（Toast通知など）
    });
  }

  /**
   * Overview HTMLレンダリング
   * @private
   * @param {Object} integrity - 整合性データ
   * @returns {string} HTML文字列
   */
  _renderOverviewHTML(integrity) {
    if (!integrity) {
      return '<div class="config-empty">Failed to load integrity data</div>';
    }

    const { stats, summary, issues } = integrity;

    let html = `
      <div class="integrity-stats">
        <div class="stat-item success">
          <span class="label">Projects</span>
          <span class="count">${stats.projects || 0}</span>
        </div>
    `;

    // OSS版ではWorkspaces, Channels, Membersは表示しない
    // Mana拡張がロードされている場合のみ表示される

    if (summary.errors > 0) {
      html += `
        <div class="stat-item error">
          <span class="label">Errors</span>
          <span class="count">${summary.errors}</span>
        </div>
      `;
    }

    if (summary.warnings > 0) {
      html += `
        <div class="stat-item warning">
          <span class="label">Warnings</span>
          <span class="count">${summary.warnings}</span>
        </div>
      `;
    }

    html += '</div>';

    // Issue表示
    if (issues && issues.length > 0) {
      html += `
        <div class="integrity-issues">
          ${issues.map(issue => `
            <div class="issue-item ${issue.severity}">
              <i data-lucide="${issue.severity === 'error' ? 'alert-circle' : issue.severity === 'warning' ? 'alert-triangle' : 'info'}"></i>
              <span>${issue.message}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    return html;
  }

  /**
   * Projects HTMLレンダリング
   * @private
   * @param {Object} projectsData - プロジェクトデータ
   * @returns {string} HTML文字列
   */
  _renderProjectsHTML(projectsData) {
    const allProjects = projectsData?.projects || [];
    const root = projectsData?.root || '';

    // アーカイブされたプロジェクトを除外
    const projects = allProjects.filter(p => !p.archived);

    if (projects.length === 0) {
      return '<div class="config-empty">No projects found</div>';
    }

    return `
      <table class="config-table">
        <thead>
          <tr>
            <th>Project ID</th>
            <th>Local Path</th>
            <th>Included Globs</th>
          </tr>
        </thead>
        <tbody>
          ${projects.map(p => `
            <tr>
              <td><span class="badge badge-project">${p.emoji ? p.emoji + ' ' : ''}${p.id}</span></td>
              <td class="mono">${p.local?.path || '-'}</td>
              <td class="mono">${(p.local?.glob_include || []).slice(0, 3).join(', ')}${(p.local?.glob_include || []).length > 3 ? '...' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
}

/**
 * 簡易APIクライアント（Core Settings用）
 */
export class CoreApiClient {
  async getConfig() {
    const response = await fetch('/api/config');
    if (!response.ok) {
      throw new Error('Failed to fetch config');
    }
    return response.json();
  }

  async getIntegrity() {
    const response = await fetch('/api/config/integrity');
    if (!response.ok) {
      throw new Error('Failed to fetch integrity');
    }
    return response.json();
  }
}

/**
 * Settings Core Module
 *
 * Core Settings実装（OSS版）
 * Overview PanelとProjects PanelをPlugin Registryに登録します。
 */

import { eventBus } from '../core/event-bus.js';
import { appStore } from '../core/store.js';
import { escapeHtml } from '../ui-helpers.js';

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
          const [integrity, unified] = await Promise.all([
            this.apiClient.getIntegrity(),
            this.apiClient.getUnified()
          ]);

          // Mana統計を取得（Mana拡張がロードされている場合）
          let manaStats = null;
          try {
            const config = await this.apiClient.getConfig();
            if (config.slack) {
              manaStats = {
                workspaces: config.slack.workspaces ? Object.keys(config.slack.workspaces).length : 0,
                channels: config.slack.channels ? config.slack.channels.length : 0,
                members: config.slack.members ? config.slack.members.length : 0
              };
            }
          } catch (error) {
            // Mana拡張なし（OSS版）の場合はエラーを無視
            console.log('Mana stats not available (OSS mode)');
          }

          appStore.setState({
            settingsIntegrity: integrity,
            settingsUnified: unified,
            settingsManaStats: manaStats
          });
        },
        render: async (container) => {
          const { settingsIntegrity, settingsUnified, settingsManaStats } = appStore.getState();
          container.innerHTML = this._renderOverviewHTML(settingsIntegrity, settingsUnified, settingsManaStats);

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

    // パネルコンテナを動的に生成
    this._renderPanelContainers(tabs);
  }

  /**
   * パネルコンテナを動的に生成
   * @private
   * @param {Array} tabs - タブ一覧
   */
  _renderPanelContainers(tabs) {
    const panelsContainer = document.querySelector('.settings-content');
    if (!panelsContainer) return;

    // 既存のパネルをクリア
    panelsContainer.innerHTML = '';

    // 各タブに対応するパネルコンテナを生成
    tabs.forEach(tab => {
      const panel = document.createElement('div');
      panel.id = `${tab.id}-panel`;
      panel.className = 'settings-panel';
      if (tab.id === this.currentTab) {
        panel.classList.add('active');
      }
      panelsContainer.appendChild(panel);
    });
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
   * @param {Object} unified - 統合ビューデータ
   * @param {Object} manaStats - Mana統計（OSS版ではnull）
   * @returns {string} HTML文字列
   */
  _renderOverviewHTML(integrity, unified = null, manaStats = null) {
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

    // Mana統計を表示（Mana拡張がロードされている場合のみ）
    if (manaStats) {
      html += `
        <div class="stat-item success">
          <span class="label">Workspaces</span>
          <span class="count">${manaStats.workspaces || 0}</span>
        </div>
        <div class="stat-item success">
          <span class="label">Channels</span>
          <span class="count">${manaStats.channels || 0}</span>
        </div>
        <div class="stat-item success">
          <span class="label">Members</span>
          <span class="count">${manaStats.members || 0}</span>
        </div>
      `;
    }

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
            <div class="issue-item ${escapeHtml(issue.severity || '')}">
              <i data-lucide="${issue.severity === 'error' ? 'alert-circle' : issue.severity === 'warning' ? 'alert-triangle' : 'info'}"></i>
              <span>${escapeHtml(issue.message || '')}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Unified View（統合マッピング表）
    if (unified) {
      html += this._renderUnifiedView(unified);
    }

    return html;
  }

  /**
   * Unified View（統合マッピング表）をレンダリング
   * @private
   * @param {Object} unified - 統合ビューデータ
   * @returns {string} HTML文字列
   */
  _renderUnifiedView(unified) {
    const { workspaces, orphanedChannels, orphanedProjects } = unified;

    if (!workspaces || workspaces.length === 0) {
      return '<div class="config-empty">No workspaces found</div>';
    }

    let html = '<div class="settings-section"><h3>Unified Configuration Overview</h3><p class="settings-section-desc">Workspace → Project → Slack/GitHub/NocoDB の統合マッピング</p>';

    // Workspace毎にプロジェクト一覧を表示
    for (const ws of workspaces) {
      html += `
        <div class="unified-workspace" data-workspace="${escapeHtml(ws.key || '')}">
          <h3 class="workspace-header">
            <span class="workspace-name">${escapeHtml(ws.name || '')}</span>
            <span class="workspace-id mono">${escapeHtml(ws.id || '-')}</span>
          </h3>
      `;

      // アーカイブされていないプロジェクトのみ
      const activeProjects = (ws.projects || []).filter(p => !p.archived);

      if (activeProjects.length === 0) {
        html += '<div class="config-empty">No projects in this workspace</div>';
      } else {
        html += `
          <table class="config-table unified-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Slack Channels</th>
                <th>GitHub</th>
                <th>NocoDB</th>
              </tr>
            </thead>
            <tbody>
        `;

        for (const proj of activeProjects) {
          const hasGithub = !!proj.github;
          const hasNocodb = !!proj.nocodb;
          const warningClass = (!hasGithub || !hasNocodb) ? 'warning-row' : '';

          html += `
            <tr data-project="${escapeHtml(proj.id || '')}" class="${warningClass}">
              <td><span class="badge badge-project">${proj.emoji ? escapeHtml(proj.emoji) + ' ' : ''}${escapeHtml(proj.id || '')}</span></td>
              <td>
                ${proj.channels && proj.channels.length > 0
                  ? proj.channels.slice(0, 3).map(ch =>
                      `<span class="channel-tag" title="${escapeHtml(ch.type || '')}">#${escapeHtml(ch.name || '')}</span>`
                    ).join(' ')
                  : '<span class="status-missing">-</span>'
                }
                ${proj.channels && proj.channels.length > 3 ? `<span class="channel-count">+${proj.channels.length - 3}</span>` : ''}
              </td>
              <td class="${!hasGithub ? 'missing' : ''}">
                ${hasGithub
                  ? `<a href="${escapeHtml(proj.github.url || '')}" target="_blank" class="config-link">${escapeHtml(proj.github.owner || '')}/${escapeHtml(proj.github.repo || '')}</a>
                     ${proj.github.paths && proj.github.paths.length > 0
                       ? `<span class="paths-hint">[${proj.github.paths.slice(0, 2).map(p => escapeHtml(p)).join(', ')}${proj.github.paths.length > 2 ? '...' : ''}]</span>`
                       : ''
                     }`
                  : '<span class="status-missing">❌ 未設定</span>'
                }
              </td>
              <td class="${!hasNocodb ? 'missing' : ''}">
                ${hasNocodb
                  ? `<a href="${escapeHtml(proj.nocodb.url || '')}" target="_blank" class="config-link">${escapeHtml(proj.nocodb.base_name || '')}</a>`
                  : '<span class="status-missing">❌ 未設定</span>'
                }
              </td>
            </tr>
          `;
        }

        html += '</tbody></table>';
      }

      html += '</div>';
    }

    // Orphaned Items（孤立したプロジェクト・チャンネル）
    if ((orphanedProjects && orphanedProjects.length > 0) || (orphanedChannels && orphanedChannels.length > 0)) {
      html += '<div class="unified-orphans"><h3 class="orphans-header">⚠️ Orphaned Items</h3>';

      if (orphanedProjects && orphanedProjects.length > 0) {
        html += `
          <div class="orphan-section">
            <h4>Unassigned Projects</h4>
            <ul>
              ${orphanedProjects.map(p =>
                `<li><span class="badge badge-project">${escapeHtml(p.id || '')}</span> (GitHub: ${p.hasGithub ? '✅' : '❌'}, NocoDB: ${p.hasNocodb ? '✅' : '❌'}, Channels: ${p.channelCount || 0})</li>`
              ).join('')}
            </ul>
          </div>
        `;
      }

      if (orphanedChannels && orphanedChannels.length > 0) {
        html += `
          <div class="orphan-section">
            <h4>Unmapped Channels</h4>
            <ul>
              ${orphanedChannels.map(ch =>
                `<li>#${escapeHtml(ch.name || '')} (${escapeHtml(ch.workspace || '')}) → ${escapeHtml(ch.project_id || 'no project')}</li>`
              ).join('')}
            </ul>
          </div>
        `;
      }

      html += '</div>';
    }

    html += '</div>';

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
      <div class="config-table-container">
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
                <td><span class="badge badge-project">${p.emoji ? escapeHtml(p.emoji) + ' ' : ''}${escapeHtml(p.id || '')}</span></td>
                <td class="mono">${escapeHtml(p.local?.path || '-')}</td>
                <td class="mono">${escapeHtml((p.local?.glob_include || []).slice(0, 3).join(', '))}${(p.local?.glob_include || []).length > 3 ? '...' : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
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

  async getUnified() {
    const response = await fetch('/api/config/unified');
    if (!response.ok) {
      throw new Error('Failed to fetch unified view');
    }
    return response.json();
  }
}

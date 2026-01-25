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
          const [integrity, unified, health] = await Promise.all([
            this.apiClient.getIntegrity(),
            this.apiClient.getUnified(),
            this.apiClient.getHealth().catch(() => null) // ヘルスチェック失敗時もUIは表示
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
            settingsManaStats: manaStats,
            settingsHealth: health
          });
        },
        render: async (container) => {
          const { settingsIntegrity, settingsUnified, settingsManaStats, settingsHealth } = appStore.getState();
          container.innerHTML = this._renderOverviewHTML(settingsIntegrity, settingsUnified, settingsManaStats, settingsHealth);

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

    // Organizations Panel登録
    this.pluginRegistry.register({
      id: 'organizations',
      displayName: 'Organizations',
      order: 5,
      lifecycle: {
        load: async () => {
          const [organizations, dependencies] = await Promise.all([
            this.apiClient.getOrganizations(),
            this.apiClient.getDependencies()
          ]);
          appStore.setState({
            settingsOrganizations: organizations,
            settingsDependencies: dependencies
          });
        },
        render: async (container) => {
          const { settingsOrganizations, settingsDependencies } = appStore.getState();
          container.innerHTML = this._renderOrganizationsHTML(settingsOrganizations, settingsDependencies);

          // Lucide icons再初期化
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      }
    });

    // Integrations Panel登録
    this.pluginRegistry.register({
      id: 'integrations',
      displayName: 'Integrations',
      order: 20,
      lifecycle: {
        load: async () => {
          // 同期ステータスはConfigとHealthから取得
          const [config, health] = await Promise.all([
            this.apiClient.getConfig(),
            this.apiClient.getHealth().catch(() => null)
          ]);
          appStore.setState({
            settingsIntegrations: {
              slack: config.slack,
              github: config.github,
              nocodb: config.nocodb,
              health: health
            }
          });
        },
        render: async (container) => {
          const integrations = appStore.getState().settingsIntegrations;
          container.innerHTML = this._renderIntegrationsHTML(integrations);

          // Lucide icons再初期化
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
        }
      }
    });

    // Notifications Panel登録
    this.pluginRegistry.register({
      id: 'notifications',
      displayName: 'Notifications',
      order: 30,
      lifecycle: {
        load: async () => {
          const notifications = await this.apiClient.getNotifications();
          appStore.setState({ settingsNotifications: notifications });
        },
        render: async (container) => {
          const notifications = appStore.getState().settingsNotifications;
          container.innerHTML = this._renderNotificationsHTML(notifications);

          // Lucide icons再初期化
          if (typeof lucide !== 'undefined') {
            lucide.createIcons();
          }
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
   * @param {Object} health - システムヘルスチェック結果
   * @returns {string} HTML文字列
   */
  _renderOverviewHTML(integrity, unified = null, manaStats = null, health = null) {
    if (!integrity) {
      return '<div class="config-empty">Failed to load integrity data</div>';
    }

    const { stats, summary, issues } = integrity;

    // System Health セクション
    let html = this._renderHealthSection(health);

    html += `
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
   * System Healthセクションをレンダリング
   * @private
   * @param {Object} health - ヘルスチェック結果
   * @returns {string} HTML文字列
   */
  _renderHealthSection(health) {
    if (!health) {
      return '';
    }

    const statusIcon = {
      healthy: 'check-circle',
      degraded: 'alert-triangle',
      unhealthy: 'x-circle',
      starting: 'loader'
    };

    const statusClass = {
      healthy: 'success',
      degraded: 'warning',
      unhealthy: 'error',
      starting: 'info'
    };

    const formatUptime = (seconds) => {
      if (seconds < 60) return `${seconds}s`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
      return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
    };

    let html = `
      <div class="settings-section health-section">
        <h3>System Health</h3>
        <div class="health-overview">
          <div class="health-status ${statusClass[health.status] || 'info'}">
            <i data-lucide="${statusIcon[health.status] || 'help-circle'}"></i>
            <span class="status-text">${health.status?.toUpperCase() || 'UNKNOWN'}</span>
            <span class="uptime">Uptime: ${formatUptime(health.uptime || 0)}</span>
          </div>
        </div>
        <div class="health-checks">
    `;

    // 各チェック項目を表示
    if (health.checks) {
      for (const [name, check] of Object.entries(health.checks)) {
        const checkStatus = check.status || 'unknown';
        const checkIcon = statusIcon[checkStatus] || 'help-circle';
        const checkClass = statusClass[checkStatus] || 'info';

        html += `
          <div class="health-check-item ${checkClass}">
            <i data-lucide="${checkIcon}"></i>
            <span class="check-name">${escapeHtml(name)}</span>
            <span class="check-message">${escapeHtml(check.message || '')}</span>
          </div>
        `;
      }
    }

    html += `
        </div>
      </div>
    `;

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

  /**
   * Organizations HTMLレンダリング
   * @private
   * @param {Array} organizations - 法人一覧
   * @param {Object} dependencies - 依存関係マッピング
   * @returns {string} HTML文字列
   */
  _renderOrganizationsHTML(organizations, dependencies) {
    if (!organizations || organizations.length === 0) {
      return `
        <div class="config-empty">
          <i data-lucide="building-2"></i>
          <p>No organizations configured</p>
          <p class="config-empty-hint">Add organizations to config.yml to manage multiple legal entities</p>
        </div>
      `;
    }

    let html = '<div class="organizations-grid">';

    for (const org of organizations) {
      const projectCount = org.projects?.length || 0;

      html += `
        <div class="org-card">
          <div class="org-card-header">
            <div class="org-icon">
              <i data-lucide="building-2"></i>
            </div>
            <div class="org-info">
              <h4 class="org-name">${escapeHtml(org.name || org.id)}</h4>
              <span class="org-id mono">${escapeHtml(org.id)}</span>
            </div>
          </div>
          <div class="org-card-body">
            <div class="org-stat">
              <i data-lucide="user"></i>
              <span>CEO: ${escapeHtml(org.ceo || '-')}</span>
            </div>
            <div class="org-stat">
              <i data-lucide="folder"></i>
              <span>${projectCount} project${projectCount !== 1 ? 's' : ''}</span>
            </div>
          </div>
          ${projectCount > 0 ? `
            <div class="org-projects">
              ${org.projects.slice(0, 5).map(p => `
                <span class="badge badge-project">${escapeHtml(p)}</span>
              `).join('')}
              ${org.projects.length > 5 ? `<span class="org-projects-more">+${org.projects.length - 5}</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }

    html += '</div>';

    // Dependencies Section
    if (dependencies && Object.keys(dependencies).length > 0) {
      html += this._renderDependenciesSection(dependencies);
    }

    return html;
  }

  /**
   * Dependencies セクションをレンダリング
   * @private
   * @param {Object} dependencies - 依存関係マッピング
   * @returns {string} HTML文字列
   */
  _renderDependenciesSection(dependencies) {
    let html = `
      <div class="settings-section dependencies-section">
        <h3>Project Dependencies</h3>
        <div class="dependencies-list">
    `;

    for (const [projectId, config] of Object.entries(dependencies)) {
      const deps = config.depends_on || [];
      html += `
        <div class="dependency-item">
          <span class="badge badge-project">${escapeHtml(projectId)}</span>
          <i data-lucide="arrow-right"></i>
          ${deps.length > 0
            ? deps.map(d => `<span class="badge badge-dependency">${escapeHtml(d)}</span>`).join('')
            : '<span class="no-deps">No dependencies</span>'
          }
        </div>
      `;
    }

    html += '</div></div>';
    return html;
  }

  /**
   * Integrations HTMLレンダリング
   * @private
   * @param {Object} integrations - 連携設定
   * @returns {string} HTML文字列
   */
  _renderIntegrationsHTML(integrations) {
    if (!integrations) {
      return '<div class="config-empty">Failed to load integrations data</div>';
    }

    const { slack, github, nocodb, health } = integrations;

    let html = '<div class="integrations-grid">';

    // Slack Integration
    const slackConnected = slack && (slack.workspaces || slack.channels);
    html += `
      <div class="integration-card ${slackConnected ? 'connected' : 'disconnected'}">
        <div class="integration-header">
          <i data-lucide="hash"></i>
          <h4>Slack</h4>
          <span class="integration-status ${slackConnected ? 'success' : 'warning'}">
            ${slackConnected ? 'Connected' : 'Not Configured'}
          </span>
        </div>
        ${slackConnected ? `
          <div class="integration-stats">
            <div class="integration-stat">
              <span class="stat-value">${slack.workspaces ? Object.keys(slack.workspaces).length : 0}</span>
              <span class="stat-label">Workspaces</span>
            </div>
            <div class="integration-stat">
              <span class="stat-value">${slack.channels?.length || 0}</span>
              <span class="stat-label">Channels</span>
            </div>
            <div class="integration-stat">
              <span class="stat-value">${slack.members?.length || 0}</span>
              <span class="stat-label">Members</span>
            </div>
          </div>
        ` : `
          <p class="integration-hint">Configure Slack integration in _codex/common/meta/slack/</p>
        `}
      </div>
    `;

    // GitHub Integration
    const githubCount = github?.length || 0;
    html += `
      <div class="integration-card ${githubCount > 0 ? 'connected' : 'disconnected'}">
        <div class="integration-header">
          <i data-lucide="github"></i>
          <h4>GitHub</h4>
          <span class="integration-status ${githubCount > 0 ? 'success' : 'warning'}">
            ${githubCount > 0 ? 'Connected' : 'Not Configured'}
          </span>
        </div>
        ${githubCount > 0 ? `
          <div class="integration-stats">
            <div class="integration-stat">
              <span class="stat-value">${githubCount}</span>
              <span class="stat-label">Repositories</span>
            </div>
          </div>
        ` : `
          <p class="integration-hint">Add GitHub repos in config.yml projects section</p>
        `}
      </div>
    `;

    // NocoDB Integration
    const nocodbCount = nocodb?.length || 0;
    html += `
      <div class="integration-card ${nocodbCount > 0 ? 'connected' : 'disconnected'}">
        <div class="integration-header">
          <i data-lucide="table-2"></i>
          <h4>NocoDB</h4>
          <span class="integration-status ${nocodbCount > 0 ? 'success' : 'warning'}">
            ${nocodbCount > 0 ? 'Connected' : 'Not Configured'}
          </span>
        </div>
        ${nocodbCount > 0 ? `
          <div class="integration-stats">
            <div class="integration-stat">
              <span class="stat-value">${nocodbCount}</span>
              <span class="stat-label">Bases</span>
            </div>
          </div>
        ` : `
          <p class="integration-hint">Add NocoDB bases in config.yml projects section</p>
        `}
      </div>
    `;

    html += '</div>';

    return html;
  }

  /**
   * Notifications HTMLレンダリング
   * @private
   * @param {Object} notifications - 通知設定
   * @returns {string} HTML文字列
   */
  _renderNotificationsHTML(notifications) {
    if (!notifications) {
      return '<div class="config-empty">Failed to load notifications settings</div>';
    }

    const { channels, dnd } = notifications;

    let html = `
      <div class="notifications-settings">
        <div class="settings-section">
          <h3>Notification Channels</h3>
          <div class="notification-channels">
    `;

    // Channels
    const channelConfig = channels || { slack: true, web: true, email: false };
    const channelIcons = { slack: 'hash', web: 'bell', email: 'mail' };

    for (const [channel, enabled] of Object.entries(channelConfig)) {
      html += `
        <div class="notification-channel ${enabled ? 'enabled' : 'disabled'}">
          <i data-lucide="${channelIcons[channel] || 'message-square'}"></i>
          <span class="channel-name">${escapeHtml(channel.charAt(0).toUpperCase() + channel.slice(1))}</span>
          <span class="channel-status">${enabled ? 'Enabled' : 'Disabled'}</span>
        </div>
      `;
    }

    html += '</div></div>';

    // DND Settings
    const dndConfig = dnd || { enabled: false, start: 22, end: 9 };
    html += `
      <div class="settings-section">
        <h3>Do Not Disturb</h3>
        <div class="dnd-settings ${dndConfig.enabled ? 'enabled' : 'disabled'}">
          <div class="dnd-status">
            <i data-lucide="${dndConfig.enabled ? 'moon' : 'sun'}"></i>
            <span>${dndConfig.enabled ? 'DND is enabled' : 'DND is disabled'}</span>
          </div>
          ${dndConfig.enabled ? `
            <div class="dnd-schedule">
              <span class="dnd-time">
                <i data-lucide="clock"></i>
                ${String(dndConfig.start).padStart(2, '0')}:00 - ${String(dndConfig.end).padStart(2, '0')}:00
              </span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    html += '</div>';

    return html;
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

  async getHealth() {
    const response = await fetch('/api/health');
    if (!response.ok) {
      throw new Error('Failed to fetch health');
    }
    return response.json();
  }

  async getOrganizations() {
    const response = await fetch('/api/config/organizations');
    if (!response.ok) {
      throw new Error('Failed to fetch organizations');
    }
    return response.json();
  }

  async getDependencies() {
    const response = await fetch('/api/config/dependencies');
    if (!response.ok) {
      throw new Error('Failed to fetch dependencies');
    }
    return response.json();
  }

  async getNotifications() {
    const response = await fetch('/api/config/notifications');
    if (!response.ok) {
      throw new Error('Failed to fetch notifications');
    }
    return response.json();
  }
}

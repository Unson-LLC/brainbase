import { refreshIcons } from '../ui-helpers.js';

/**
 * Settings Core Module
 *
 * Core Settings実装（OSS版）
 * Overview PanelとProjects PanelをPlugin Registryに登録します。
 */

import { eventBus } from '../core/event-bus.js';
import { httpClient } from '../core/http-client.js';
import { appStore } from '../core/store.js';
import { fetchPreferences, updatePreferences } from '../state-api.js';
import { escapeHtml } from '../ui-helpers.js';

export class SettingsCore {
  constructor({ pluginRegistry, ui, apiClient }) {
    this.pluginRegistry = pluginRegistry;
    this.ui = ui;
    this.apiClient = apiClient;
    this.currentTab = 'overview';  // デフォルトタブ
    this.pendingIntegrationSubTab = null;
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
      requiredLevel: 1,
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

          refreshIcons();
        }
      }
    });

    // Projects Panel登録
    this.pluginRegistry.register({
      id: 'projects',
      displayName: 'Projects',
      order: 10,
      requiredLevel: 1,
      lifecycle: {
        load: async () => {
          const config = await this.apiClient.getConfig();
          appStore.setState({ settingsProjects: config.projects });
        },
        render: async (container) => {
          const projects = appStore.getState().settingsProjects;
          container.innerHTML = this._renderProjectsHTML(projects);
          this._setupProjectsCrud(container, projects?.projects || []);
        }
      }
    });

    // Organizations Panel登録（CEO以上のみ）
    this.pluginRegistry.register({
      id: 'organizations',
      displayName: 'Organizations',
      order: 5,
      requiredLevel: 3,
      lifecycle: {
        load: async () => {
          const organizations = await this.apiClient.getOrganizations();
          appStore.setState({ settingsOrganizations: organizations });
        },
        render: async (container) => {
          const { settingsOrganizations } = appStore.getState();
          container.innerHTML = this._renderOrganizationsHTML(settingsOrganizations || []);
          this._setupOrganizationsCrud(container, settingsOrganizations || []);

          refreshIcons();
        }
      }
    });

    // Integrations Panel登録（GM以上のみ）
    this.pluginRegistry.register({
      id: 'integrations',
      displayName: 'Integrations',
      order: 20,
      requiredLevel: 2,
      lifecycle: {
        load: async () => {
          // 同期ステータスはConfigとHealthから取得
          const [config, health, preferences, meetingSources] = await Promise.all([
            this.apiClient.getConfig(),
            this.apiClient.getHealth().catch(() => null),
            fetchPreferences(),
            this.apiClient.getMeetingSourceProviders().catch(() => null)
          ]);
          appStore.setState({
            settingsIntegrations: {
              slack: config.slack,
              github: config.github,
              nocodb: config.nocodb,
              meetingSources,
              health: health
            },
            settingsIntegrationProjects: config.projects?.projects || [],
            preferences
          });
        },
        render: async (container) => {
          const { settingsIntegrations, preferences, settingsIntegrationProjects } = appStore.getState();
          container.innerHTML = this._renderIntegrationsHTML(settingsIntegrations, preferences, settingsIntegrationProjects);

          this._setupIntegrationNav(container, this.pendingIntegrationSubTab);
          this.pendingIntegrationSubTab = null;

          // Slack details (filters + tables)
          this._renderSlackDetails(settingsIntegrations?.slack, container);

          // GitHub / NocoDB CRUD
          this._setupGitHubCrud(container, settingsIntegrations?.github || [], settingsIntegrationProjects || []);
          this._setupNocoDBCrud(container, settingsIntegrations?.nocodb || [], settingsIntegrationProjects || []);
          this._setupMeetingSourcesCrud(container, settingsIntegrations?.meetingSources || null);

          const saveBtn = container.querySelector('#nocodb-self-assignee-save');
          const input = container.querySelector('#nocodb-self-assignee');
          const status = container.querySelector('#nocodb-self-assignee-status');

          if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
              const value = input?.value?.trim() || '';
              saveBtn.disabled = true;
              if (status) status.textContent = '保存中...';

              try {
                const nextPreferences = await updatePreferences({ user: { assignee: value } });
                appStore.setState({ preferences: nextPreferences });
                if (status) status.textContent = '保存しました';
              } catch (error) {
                console.error('Failed to update preferences:', error);
                if (status) status.textContent = '保存に失敗しました';
              } finally {
                saveBtn.disabled = false;
              }
            });
          }

          refreshIcons();
        }
      }
    });

    // Notifications Panel登録
    this.pluginRegistry.register({
      id: 'notifications',
      displayName: 'Notifications',
      order: 30,
      requiredLevel: 1,
      lifecycle: {
        load: async () => {
          const notifications = await this.apiClient.getNotifications();
          appStore.setState({ settingsNotifications: notifications });
        },
        render: async (container) => {
          const notifications = appStore.getState().settingsNotifications;
          container.innerHTML = this._renderNotificationsHTML(notifications);
          this._setupNotificationsCrud(container, notifications);

          refreshIcons();
        }
      }
    });
  }

  /**
   * 全プラグインのデータをロード
   * @private
   */
  async _loadAllData() {
    const access = appStore.getState().auth?.access;
    await this.pluginRegistry.loadAll(access);
  }

  /**
   * タブナビゲーションをレンダリング
   * @private
   */
  _renderTabs() {
    const access = appStore.getState().auth?.access;
    const tabs = this.pluginRegistry.generateTabNavigation(access);
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
      switch (tab.id) {
        case 'overview':
          panel.id = 'overview-panel';
          break;
        case 'projects':
          panel.id = 'projects-panel';
          break;
        case 'organizations':
          panel.id = 'organizations-panel';
          break;
        case 'integrations':
          panel.id = 'integrations-panel';
          break;
        case 'notifications':
          panel.id = 'notifications-panel';
          break;
        default:
          panel.id = `${tab.id}-panel`;
      }
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

    eventBus.on('settings:open-tab', async (event) => {
      const tabId = event.detail?.tabId;
      const subTab = event.detail?.subTab;
      if (tabId) {
        this.currentTab = tabId;
      }
      if (tabId === 'integrations' && subTab) {
        this.pendingIntegrationSubTab = subTab;
      }

      if (!this.ui.isOpen()) {
        await this.ui.openModal();
        return;
      }

      await this._switchTab(this.currentTab);
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
      <div class="settings-section">
        <div class="settings-section-header">
          <h3><i data-lucide="shield-check"></i> Integrity Status</h3>
        </div>
      <div class="settings-form-card">
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

    html += '</div>'; // Close settings-form-card
    html += '</div>'; // Close settings-section

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
      <div class="settings-section">
        <div class="settings-section-header">
          <h3><i data-lucide="activity"></i> System Health</h3>
        </div>
      <div class="settings-form-card health-section">
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

    let html = `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3><i data-lucide="layers"></i> Unified Configuration Overview</h3>
        </div>
      <p class="settings-section-desc" style="margin-bottom: 1.5rem; padding-left: 0.5rem; color: var(--text-secondary);">Workspace → Project → Slack/GitHub/NocoDB の統合マッピング</p>
    `;

    // Workspace毎にプロジェクト一覧を表示
    for (const ws of workspaces) {
      html += `
        <div class="settings-form-card unified-workspace" data-workspace="${escapeHtml(ws.key || '')}">
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
      html += `
        <div class="settings-section-header" style="margin-top: 2rem;">
            <h3><i data-lucide="alert-triangle" style="color: var(--warning-color);"></i> Orphaned Items</h3>
        </div>
        <div class="settings-form-card unified-orphans">
      `;

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

    html += '</div>'; // Close settings-section

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
    const projects = allProjects;

    const rows = projects.map(p => `
      <tr>
        <td><span class="badge badge-project">${p.emoji ? escapeHtml(p.emoji) + ' ' : ''}${escapeHtml(p.id || '')}</span></td>
        <td class="mono">${escapeHtml(p.local?.path || '-')}</td>
        <td class="mono">${escapeHtml((p.local?.glob_include || []).slice(0, 3).join(', '))}${(p.local?.glob_include || []).length > 3 ? '...' : ''}</td>
        <td>${p.archived ? '<span class="status-missing">Archived</span>' : 'Active'}</td>
        <td class="table-actions">
          <button class="btn-secondary btn-sm" data-project-edit="${escapeHtml(p.id || '')}">編集</button>
          <button class="btn-danger btn-sm" data-project-delete="${escapeHtml(p.id || '')}">削除</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3>Project Editor</h3>
          <button class="btn-secondary btn-sm" id="project-reset-btn">クリア</button>
        </div>
        <p class="settings-section-desc">プロジェクトの基本情報とローカルパスを管理します</p>
        <div class="settings-form-card">
          <div class="settings-form-grid">
            <div class="form-group">
              <label for="project-id-input">Project ID</label>
              <input id="project-id-input" class="form-input" placeholder="salestailor" />
            </div>
            <div class="form-group">
              <label for="project-emoji-input">Emoji</label>
              <input id="project-emoji-input" class="form-input" placeholder="🧵" />
            </div>
            <div class="form-group">
              <label for="project-path-input">Local Path</label>
              <input id="project-path-input" class="form-input" placeholder="${escapeHtml('${PROJECTS_ROOT:-/path/to/projects}')}/salestailor" />
            </div>
            <div class="form-group">
              <label for="project-glob-input">Glob Include (1行1パス)</label>
              <textarea id="project-glob-input" class="form-input" rows="4" placeholder="app/**/*
docs/**/*"></textarea>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" id="project-archived-input" />
              Archived
            </label>
            <div class="form-actions">
              <button class="btn-primary btn-sm" id="project-save-btn">保存</button>
              <button class="btn-danger btn-sm" id="project-delete-btn">削除</button>
            </div>
            <p class="settings-section-desc" id="project-status"></p>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Projects</h3>
        ${rows
        ? `<div class="config-table-container">
              <table class="config-table">
                <thead>
                  <tr>
                    <th>Project ID</th>
                    <th>Local Path</th>
                    <th>Included Globs</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>`
        : '<div class="config-empty">No projects found</div>'
      }
      </div>
    `;
  }

  async _refreshProjectsPanel() {
    const config = await this.apiClient.getConfig();
    appStore.setState({ settingsProjects: config.projects });

    const container = document.getElementById('projects-panel');
    if (container) {
      await this.pluginRegistry.renderPanel('projects', container);
    }
  }

  _setupProjectsCrud(container, projects = []) {
    const idInput = container.querySelector('#project-id-input');
    const emojiInput = container.querySelector('#project-emoji-input');
    const pathInput = container.querySelector('#project-path-input');
    const globInput = container.querySelector('#project-glob-input');
    const archivedInput = container.querySelector('#project-archived-input');
    const saveBtn = container.querySelector('#project-save-btn');
    const deleteBtn = container.querySelector('#project-delete-btn');
    const resetBtn = container.querySelector('#project-reset-btn');
    const status = container.querySelector('#project-status');

    if (!idInput || !saveBtn || !deleteBtn) return;

    const projectById = new Map((projects || []).map(p => [p.id, p]));

    const clearForm = () => {
      idInput.value = '';
      if (emojiInput) emojiInput.value = '';
      if (pathInput) pathInput.value = '';
      if (globInput) globInput.value = '';
      if (archivedInput) archivedInput.checked = false;
      if (status) status.textContent = '';
    };

    const fillForm = (projectId) => {
      const project = projectById.get(projectId);
      if (!project) {
        if (emojiInput) emojiInput.value = '';
        if (pathInput) pathInput.value = '';
        if (globInput) globInput.value = '';
        if (archivedInput) archivedInput.checked = false;
        return;
      }
      if (emojiInput) emojiInput.value = project.emoji || '';
      if (pathInput) pathInput.value = project.local?.path || '';
      if (globInput) globInput.value = (project.local?.glob_include || []).join('\n');
      if (archivedInput) archivedInput.checked = Boolean(project.archived);
    };

    resetBtn?.addEventListener('click', () => clearForm());

    container.querySelectorAll('[data-project-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.dataset.projectEdit;
        if (!projectId) return;
        idInput.value = projectId;
        fillForm(projectId);
        if (status) {
          status.textContent = `編集対象を読み込みました: ${projectId}`;
        }
        idInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        idInput.focus();
      });
    });

    container.querySelectorAll('[data-project-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const projectId = btn.dataset.projectDelete;
        if (!projectId) return;
        if (status) status.textContent = '削除中...';
        try {
          await this.apiClient.deleteProject(projectId);
          await this._refreshProjectsPanel();
        } catch (error) {
          if (status) status.textContent = '削除に失敗しました';
        }
      });
    });

    saveBtn.addEventListener('click', async () => {
      const projectId = idInput.value.trim();
      const emoji = emojiInput?.value?.trim() || '';
      const localPath = pathInput?.value?.trim() || '';
      const glob = (globInput?.value || '')
        .split(/\r?\n|,/)
        .map(entry => entry.trim())
        .filter(Boolean);
      const archived = Boolean(archivedInput?.checked);

      if (!projectId || !localPath) {
        if (status) status.textContent = 'Project ID / Local Path は必須です';
        return;
      }

      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      if (status) status.textContent = '保存中...';

      try {
        await this.apiClient.upsertProject({
          id: projectId,
          emoji,
          local_path: localPath,
          glob_include: glob,
          archived
        });
        await this._refreshProjectsPanel();
      } catch (error) {
        if (status) status.textContent = '保存に失敗しました';
      } finally {
        saveBtn.disabled = false;
        deleteBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const projectId = idInput.value.trim();
      if (!projectId) {
        if (status) status.textContent = 'Project ID を入力してください';
        return;
      }
      if (status) status.textContent = '削除中...';
      try {
        await this.apiClient.deleteProject(projectId);
        await this._refreshProjectsPanel();
      } catch (error) {
        if (status) status.textContent = '削除に失敗しました';
      }
    });
  }

  /**
   * Organizations HTMLレンダリング
   * @private
   * @param {Array} organizations - 法人一覧
   * @param {Object} dependencies - 依存関係マッピング
   * @returns {string} HTML文字列
   */
  _renderOrganizationsHTML(organizations = []) {
    const rows = (organizations || []).map(org => {
      const projects = org.projects || [];
      const projectBadges = projects.slice(0, 4).map(p => `
        <span class="badge badge-project">${escapeHtml(p)}</span>
      `).join('');
      const more = projects.length > 4 ? `<span class="org-projects-more">+${projects.length - 4}</span>` : '';
      const projectsCell = projects.length > 0 ? `${projectBadges}${more}` : '<span class="status-missing">-</span>';

      return `
        <tr>
          <td><span class="badge badge-project">${escapeHtml(org.id || '')}</span></td>
          <td>${escapeHtml(org.name || org.id || '')}</td>
          <td>${escapeHtml(org.ceo || '-')}</td>
          <td>${projectsCell}</td>
          <td class="table-actions">
            <button class="btn-secondary btn-sm" data-org-edit="${escapeHtml(org.id || '')}">編集</button>
            <button class="btn-danger btn-sm" data-org-delete="${escapeHtml(org.id || '')}">削除</button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3>Add Organization</h3>
          <button class="btn-secondary btn-sm" id="org-reset-btn">クリア</button>
        </div>
        <div class="settings-form-card">
          <div class="settings-form-grid">
            <div class="form-group">
              <label for="org-id-input">Organization ID</label>
              <input id="org-id-input" class="form-input" placeholder="unson" />
            </div>
            <div class="form-group">
              <label for="org-name-input">Display Name</label>
              <input id="org-name-input" class="form-input" placeholder="Unson LLC" />
            </div>
            <div class="form-group">
              <label for="org-ceo-input">CEO</label>
              <input id="org-ceo-input" class="form-input" placeholder="CEO Name" />
            </div>
            <div class="form-group">
              <label for="org-projects-input">Projects (Comma separated)</label>
              <input id="org-projects-input" class="form-input" placeholder="brainbase, zeims" />
            </div>
            <div class="form-actions">
              <button class="btn-primary btn-sm" id="org-save-btn">保存</button>
              <button class="btn-danger btn-sm" id="org-delete-btn">削除</button>
            </div>
            <p class="settings-section-desc" id="org-status"></p>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h3>Organizations</h3>
        ${rows
        ? `<div class="config-table-container">
              <table class="config-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>CEO</th>
                    <th>Projects</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>`
        : `
            <div class="config-empty">
              <i data-lucide="building-2"></i>
              <p>No organizations configured</p>
              <p class="config-empty-hint">Add organizations to manage legal entities</p>
            </div>
          `
      }
      </div>
    `;
  }

  async _refreshOrganizationsPanel() {
    const organizations = await this.apiClient.getOrganizations();
    appStore.setState({ settingsOrganizations: organizations });

    const container = document.getElementById('organizations-panel');
    if (container) {
      await this.pluginRegistry.renderPanel('organizations', container);
    }
  }

  _setupOrganizationsCrud(container, organizations = []) {
    const idInput = container.querySelector('#org-id-input');
    const nameInput = container.querySelector('#org-name-input');
    const ceoInput = container.querySelector('#org-ceo-input');
    const projectsInput = container.querySelector('#org-projects-input');
    const saveBtn = container.querySelector('#org-save-btn');
    const deleteBtn = container.querySelector('#org-delete-btn');
    const resetBtn = container.querySelector('#org-reset-btn');
    const status = container.querySelector('#org-status');

    if (!idInput || !saveBtn || !deleteBtn) return;

    const orgById = new Map((organizations || []).map(org => [org.id, org]));

    const clearForm = () => {
      idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (ceoInput) ceoInput.value = '';
      if (projectsInput) projectsInput.value = '';
      if (status) status.textContent = '';
    };

    const fillForm = (orgId) => {
      const org = orgById.get(orgId);
      if (!org) {
        if (nameInput) nameInput.value = '';
        if (ceoInput) ceoInput.value = '';
        if (projectsInput) projectsInput.value = '';
        return;
      }
      if (nameInput) nameInput.value = org.name || org.id || '';
      if (ceoInput) ceoInput.value = org.ceo || '';
      if (projectsInput) projectsInput.value = (org.projects || []).join(', ');
    };

    resetBtn?.addEventListener('click', () => clearForm());

    container.querySelectorAll('[data-org-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orgId = btn.dataset.orgEdit;
        if (!orgId) return;
        idInput.value = orgId;
        fillForm(orgId);
      });
    });

    container.querySelectorAll('[data-org-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orgId = btn.dataset.orgDelete;
        if (!orgId) return;
        if (status) status.textContent = '削除中...';
        try {
          await this.apiClient.deleteOrganization(orgId);
          await this._refreshOrganizationsPanel();
        } catch (error) {
          if (status) status.textContent = '削除に失敗しました';
        }
      });
    });

    saveBtn.addEventListener('click', async () => {
      const orgId = idInput.value.trim();
      const name = nameInput?.value?.trim() || '';
      const ceo = ceoInput?.value?.trim() || '';
      const projects = (projectsInput?.value || '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);

      if (!orgId) {
        if (status) status.textContent = 'Organization ID は必須です';
        return;
      }

      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      if (status) status.textContent = '保存中...';

      try {
        await this.apiClient.upsertOrganization({
          id: orgId,
          name,
          ceo,
          projects
        });
        await this._refreshOrganizationsPanel();
      } catch (error) {
        if (status) status.textContent = '保存に失敗しました';
      } finally {
        saveBtn.disabled = false;
        deleteBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const orgId = idInput.value.trim();
      if (!orgId) {
        if (status) status.textContent = 'Organization ID を入力してください';
        return;
      }
      if (status) status.textContent = '削除中...';
      try {
        await this.apiClient.deleteOrganization(orgId);
        await this._refreshOrganizationsPanel();
      } catch (error) {
        if (status) status.textContent = '削除に失敗しました';
      }
    });
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
  _renderIntegrationsHTML(integrations, preferences = {}, projects = []) {
    if (!integrations) {
      return '<div class="config-empty">Failed to load integrations data</div>';
    }

    const { slack, github, nocodb, meetingSources, health } = integrations;
    const slackConnected = slack && (slack.workspaces || slack.channels);
    const slackWorkspaceCount = slack?.workspaces ? Object.keys(slack.workspaces).length : 0;
    const slackChannelCount = slack?.channels?.length || 0;
    const slackMemberCount = slack?.members?.length || 0;
    const githubCount = github?.length || 0;
    const nocodbCount = nocodb?.length || 0;
    const meetingSourceProviders = meetingSources?.providers || [];
    const meetingSourceConnectedCount = meetingSourceProviders.filter(p => p.enabled && p.auth_status === 'connected').length;
    const meetingSourceCount = meetingSourceProviders.length || 2;

    const assignee = preferences.user?.assignee || '';
    const escapedAssignee = escapeHtml(assignee);
    const mappingHtml = this._renderNocoDBMappings(nocodb);
    const projectOptions = (projects || []).map(p => `
      <option value="${escapeHtml(p.id || '')}">${escapeHtml(p.id || '')}</option>
    `).join('');

    const integrationCard = (key, label, icon, connected, metaHtml, description) => `
      <div class="integration-card ${connected ? 'connected' : ''}" data-integration-card="${key}">
        <div class="integration-card-header">
          <div class="integration-icon-wrapper">
            <i data-lucide="${icon}"></i>
          </div>
          <div class="integration-status-badge ${connected ? 'success' : 'neutral'}">
            ${connected ? 'Connected' : 'Not Connected'}
          </div>
        </div>
        <div class="integration-card-body">
          <h3>${label}</h3>
          <p>${description}</p>
        </div>
        <div class="integration-card-footer">
          <div class="integration-meta">
            ${metaHtml}
          </div>
          <button class="btn-secondary btn-sm">Configure</button>
        </div>
      </div>
    `;

    return `
      <div class="integrations-container">
        <!-- Level 1: Integrations Overview (Grid) -->
        <div id="integrations-overview" class="integrations-view active">
          <div class="settings-section">
            <div class="settings-section-header">
              <h3>Available Integrations</h3>
            </div>
            <p class="settings-section-desc">連携サービスを選択して設定を行います</p>
            
            <div class="integrations-grid">
              ${integrationCard(
      'slack',
      'Slack',
      'hash',
      !!slackConnected,
      `<span>${slackWorkspaceCount} Workspaces</span>`,
      'チームコミュニケーションと連携し、通知やスレッドの同期を行います。'
    )}
              ${integrationCard(
      'github',
      'GitHub',
      'github',
      githubCount > 0,
      `<span>${githubCount} Repositories</span>`,
      'リポジトリのIssueやPRをプロジェクトとリンクし、開発状況を可視化します。'
    )}
              ${integrationCard(
      'nocodb',
      'NocoDB',
      'table-2',
      nocodbCount > 0,
      `<span>${nocodbCount} Databases</span>`,
      'ノーコードデータベースと同期し、タスクや顧客情報を管理します。'
    )}
              ${integrationCard(
      'meeting-sources',
      'Meeting Sources',
      'mic-vocal',
      meetingSourceConnectedCount > 0,
      `<span>${meetingSourceConnectedCount}/${meetingSourceCount} Providers</span>`,
      'Tactiq / Plaud MCPから議事録ソースを直接同期します。'
    )}
            </div>
          </div>
        </div>

        <!-- Level 2: Detail Views -->
        <div id="integration-detail-slack" class="integrations-view detail-view">
          <div class="detail-header">
            <button class="btn-text back-to-integrations"><i data-lucide="arrow-left"></i> Back</button>
            <h2><i data-lucide="hash"></i> Slack Integration</h2>
          </div>
          
          <div class="settings-section">
            <h3>Sync Policy</h3>
            <p class="settings-section-desc">Slackの設定は同期専用です（GUIからの編集はできません）</p>
          </div>
          <div class="settings-section">
            <h3>Slack Workspaces</h3>
            <div id="slack-workspaces-list" class="config-list"></div>
          </div>

          <div class="settings-section">
            <h3>Channel Mappings</h3>
            <div class="filter-bar">
              <input type="text" id="slack-channel-filter" placeholder="Search channels..." class="form-input">
              <select id="slack-workspace-filter" class="form-input">
                <option value="">All Workspaces</option>
              </select>
            </div>
            <div id="slack-channels-list" class="config-table-container"></div>
          </div>

          <div class="settings-section">
            <h3>Member Mappings</h3>
            <div class="filter-bar">
              <input type="text" id="slack-member-filter" placeholder="Search members..." class="form-input">
            </div>
            <div id="slack-members-list" class="config-table-container"></div>
          </div>
        </div>

        <div id="integration-detail-github" class="integrations-view detail-view">
          <div class="detail-header">
            <button class="btn-text back-to-integrations"><i data-lucide="arrow-left"></i> Back</button>
            <h2><i data-lucide="github"></i> GitHub Integration</h2>
          </div>
          ${this._renderGitHubSection(github, projects)}
        </div>

        <div id="integration-detail-nocodb" class="integrations-view detail-view">
          <div class="detail-header">
            <button class="btn-text back-to-integrations"><i data-lucide="arrow-left"></i> Back</button>
            <h2><i data-lucide="table-2"></i> NocoDB Integration</h2>
          </div>
          
          <div class="settings-section">
            <div class="settings-section-header">
              <h3>自分の担当者名</h3>
            </div>
            <p class="settings-section-desc">「自分だけ」フィルタとプロジェクトタスク追加の既定値に使用します</p>
            <div class="settings-form-card">
              <div class="settings-form-grid">
                <div class="form-group">
                  <label for="nocodb-self-assignee">担当者名</label>
                  <input
                    type="text"
                    id="nocodb-self-assignee"
                    class="form-input"
                    placeholder="例: ksato"
                    value="${escapedAssignee}">
                </div>
                <div class="form-actions">
                  <button id="nocodb-self-assignee-save" class="btn-primary btn-sm">保存</button>
                </div>
                <p id="nocodb-self-assignee-status" class="settings-section-desc"></p>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-header">
              <h3>NocoDB Mapping Editor</h3>
              <button class="btn-secondary btn-sm" id="nocodb-reset-btn">クリア</button>
            </div>
            <div class="settings-form-card">
              <div class="settings-form-grid">
                <div class="form-group">
                  <label for="nocodb-project-select">Project</label>
                  <select id="nocodb-project-select" class="form-input">
                    <option value="">選択...</option>
                    ${projectOptions}
                  </select>
                </div>
                <div class="form-group">
                  <label for="nocodb-base-name-input">Base Name</label>
                  <input id="nocodb-base-name-input" class="form-input" placeholder="SalesTailor" />
                </div>
                <div class="form-group">
                  <label for="nocodb-project-id-input">NocoDB Project ID</label>
                  <input id="nocodb-project-id-input" class="form-input" placeholder="pqoxxxxxxxxxxxxx" />
                </div>
                <div class="form-group">
                  <label for="nocodb-base-id-input">Legacy Base ID</label>
                  <input id="nocodb-base-id-input" class="form-input" placeholder="appxxxxxxxxxxxxxx" />
                </div>
                <div class="form-group">
                  <label for="nocodb-url-input">URL</label>
                  <input id="nocodb-url-input" class="form-input" placeholder="https://noco.unson.jp/..." />
                </div>
                <div class="form-actions">
                  <button class="btn-primary btn-sm" id="nocodb-save-btn">保存</button>
                  <button class="btn-danger btn-sm" id="nocodb-delete-btn">削除</button>
                </div>
                <p class="settings-section-desc" id="nocodb-status"></p>
              </div>
            </div>
  
            <div class="settings-section">
              <h3>NocoDB Base Mappings</h3>
              <p class="settings-section-desc">プロジェクトとNocoDBベースの対応関係（正本: config.yml）</p>
              ${mappingHtml}
            </div>
          </div>
        </div>

        <div id="integration-detail-meeting-sources" class="integrations-view detail-view">
          <div class="detail-header">
            <button class="btn-text back-to-integrations"><i data-lucide="arrow-left"></i> Back</button>
            <h2><i data-lucide="mic-vocal"></i> Meeting Sources</h2>
          </div>
          ${this._renderMeetingSourcesSection(meetingSources)}
        </div>
      </div>
    `;
  }

  _setupIntegrationNav(container, initialTab = null) {
    const overview = container.querySelector('#integrations-overview');
    const cards = container.querySelectorAll('.integration-card');
    const detailViews = container.querySelectorAll('.integrations-view.detail-view');
    const backButtons = container.querySelectorAll('.back-to-integrations');

    // Show Detail View
    const showDetail = (key) => {
      overview.classList.remove('active');
      detailViews.forEach(view => view.classList.remove('active'));
      const target = container.querySelector(`#integration-detail-${key}`);
      if (target) {
        target.classList.add('active');
        // Smooth scroll to top
        container.closest('.settings-content')?.scrollTo(0, 0);
      }
    };

    // Card Clicks
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const key = card.dataset.integrationCard;
        if (key) showDetail(key);
      });
    });

    // Back Buttons
    backButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        detailViews.forEach(view => view.classList.remove('active'));
        overview.classList.add('active');
      });
    });

    // Initial Routing
    if (initialTab) {
      showDetail(initialTab);
    }
  }

  _renderGitHubSection(github, projects = []) {
    const projectOptions = (projects || []).map(p => `
      <option value="${escapeHtml(p.id)}">${escapeHtml(p.emoji || '')} ${escapeHtml(p.id)}</option>
    `).join('');

    const rows = (github || []).map(g => `
      <tr>
        <td><span class="badge badge-project">${escapeHtml(g.project_id || '')}</span></td>
        <td class="mono">${escapeHtml(g.owner || '')}</td>
        <td class="mono">${escapeHtml(g.repo || '')}</td>
        <td><span class="badge badge-type">${escapeHtml(g.branch || '')}</span></td>
        <td>${g.url ? `<a href="${escapeHtml(g.url)}" target="_blank" class="config-link">${escapeHtml(g.url)}</a>` : '-'}</td>
        <td class="table-actions">
          <button class="btn-secondary btn-sm" data-github-edit="${escapeHtml(g.project_id || '')}">編集</button>
          <button class="btn-danger btn-sm" data-github-delete="${escapeHtml(g.project_id || '')}">削除</button>
        </td>
      </tr>
    `).join('');

    return `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3>GitHub Config</h3>
          <button class="btn-secondary btn-sm" id="github-reset-btn">クリア</button>
        </div>
        <div class="settings-form-card">
          <div class="settings-form-grid">
            <div class="form-group">
              <label for="github-project-select">Linking Project</label>
              <select id="github-project-select" class="form-input">
                <option value="">(Select Project)</option>
                ${projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.emoji || '')} ${escapeHtml(p.id)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="github-owner-input">Owner (Org/User)</label>
              <input id="github-owner-input" class="form-input" placeholder="Unson-LLC" />
            </div>
            <div class="form-group">
              <label for="github-repo-input">Repository</label>
              <input id="github-repo-input" class="form-input" placeholder="brainbase" />
            </div>
            <div class="form-group">
              <label for="github-branch-input">Branch</label>
              <input id="github-branch-input" class="form-input" placeholder="main" />
            </div>
            <div class="form-actions">
              <button class="btn-primary btn-sm" id="github-save-btn">保存</button>
              <button class="btn-danger btn-sm" id="github-delete-btn">削除</button>
            </div>
            <p class="settings-section-desc" id="github-status"></p>
          </div>
        </div>
      </div>  ${rows
        ? `<div id="github-list" class="config-table-container">
              <table class="config-table">
                <thead>
                  <tr>
                    <th>Project ID</th>
                    <th>Owner</th>
                    <th>Repository</th>
                    <th>Branch</th>
                    <th>URL</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows}
                </tbody>
              </table>
            </div>`
        : '<div class="config-empty">No GitHub mappings found</div>'
      }
      </div>
    `;
  }

  _renderNocoDBMappings(nocodb) {
    if (!nocodb || nocodb.length === 0) {
      return '<div class="config-empty">No NocoDB mappings found</div>';
    }

    return `
      <div id="nocodb-list" class="config-table-container">
        <table class="config-table">
          <thead>
            <tr>
              <th>Project ID</th>
              <th>Base Name</th>
              <th>NocoDB Project ID</th>
              <th>Legacy Base ID</th>
              <th>URL</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${nocodb.map(n => `
              <tr>
                <td><span class="badge badge-project">${escapeHtml(n.project_id || '')}</span></td>
                <td>${escapeHtml(n.base_name || '')}</td>
                <td class="mono">${escapeHtml(n.nocodb_project_id || '')}</td>
                <td class="mono">${escapeHtml(n.legacy_base_id || '')}</td>
                <td>
                  ${n.url
        ? `<a href="${escapeHtml(n.url)}" target="_blank" class="config-link">${escapeHtml(n.url)}</a>`
        : '-'
      }
                </td>
                <td class="table-actions">
                  <button class="btn-secondary btn-sm" data-nocodb-edit="${escapeHtml(n.project_id || '')}">編集</button>
                  <button class="btn-danger btn-sm" data-nocodb-delete="${escapeHtml(n.project_id || '')}">削除</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  _renderMeetingSourcesSection(meetingSources) {
    const providers = meetingSources?.providers || [
      { provider: 'tactiq', enabled: false, auth_status: 'not_configured', capabilities: ['online_transcript', 'mcp_resource'], cursor: {} },
      { provider: 'plaud', enabled: false, auth_status: 'not_configured', capabilities: ['offline_recording', 'call_recording', 'mcp_resource'], cursor: {} }
    ];
    const providerRows = providers.map(provider => {
      const connected = provider.enabled && provider.auth_status === 'connected';
      const statusClass = connected ? 'success' : 'neutral';
      const label = provider.provider === 'tactiq'
        ? 'Tactiq'
        : provider.provider === 'plaud'
          ? 'Plaud.ai'
          : provider.provider;
      return `
        <div class="config-card" data-meeting-source-provider="${escapeHtml(provider.provider)}">
          <div class="config-card-header">
            <h4>${escapeHtml(label)}</h4>
            <span class="badge badge-type ${statusClass}">${connected ? 'Connected' : escapeHtml(provider.auth_status || 'Not Connected')}</span>
          </div>
          <div class="settings-form-grid">
            <div class="form-group">
              <label>Account Label</label>
              <input class="form-input" data-meeting-source-account="${escapeHtml(provider.provider)}" value="${escapeHtml(provider.account_label || '')}" placeholder="例: ksato ${escapeHtml(label)}" />
            </div>
            <div class="form-group">
              <label>Credential Ref</label>
              <input class="form-input" data-meeting-source-credential="${escapeHtml(provider.provider)}" type="password" placeholder="${provider.has_credential_ref ? '保存済み。更新時のみ入力' : 'MCP credential ref'}" />
            </div>
            <div class="form-actions">
              <button class="btn-primary btn-sm" data-meeting-source-connect="${escapeHtml(provider.provider)}">接続を保存</button>
              <button class="btn-secondary btn-sm" data-meeting-source-test="${escapeHtml(provider.provider)}">接続テスト</button>
              <button class="btn-danger btn-sm" data-meeting-source-disconnect="${escapeHtml(provider.provider)}">切断</button>
            </div>
          </div>
          <div class="config-card-stats">
            <div class="config-card-stat"><i data-lucide="key-round"></i><span>${provider.has_credential_ref ? 'credential saved' : 'credential missing'}</span></div>
            <div class="config-card-stat"><i data-lucide="clock"></i><span>last success: ${escapeHtml(provider.last_success_at || '-')}</span></div>
            <div class="config-card-stat"><i data-lucide="database"></i><span>cursor: ${escapeHtml(provider.cursor?.updated_since || '-')}</span></div>
          </div>
          ${provider.last_error ? `<p class="settings-section-desc text-danger">${escapeHtml(provider.last_error)}</p>` : ''}
          <p class="settings-section-desc">capabilities: ${(provider.capabilities || []).map(cap => `<span class="badge badge-type">${escapeHtml(cap)}</span>`).join(' ')}</p>
        </div>
      `;
    }).join('');

    return `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3>Tactiq / Plaud MCP</h3>
        </div>
        <p class="settings-section-desc">オンライン会議はTactiq、オフライン・電話・Tactiqが使えないオンラインはPlaudを主ソースとして同期します。カレンダーに存在しない雑談・電話もこの同期workerの対象です。</p>
        <div class="config-list">
          ${providerRows}
        </div>
        <p id="meeting-source-provider-status" class="settings-section-desc"></p>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">
          <h3>Manual Resync</h3>
        </div>
        <p class="settings-section-desc">手動再同期は必ずdry-runで件数と重複クラスタを確認してからconfirmします。</p>
        <div class="settings-form-card">
          <div class="settings-form-grid">
            <label class="checkbox-label">
              <input type="checkbox" data-meeting-source-resync-provider value="tactiq" checked />
              Tactiq
            </label>
            <label class="checkbox-label">
              <input type="checkbox" data-meeting-source-resync-provider value="plaud" checked />
              Plaud.ai
            </label>
            <div class="form-group">
              <label for="meeting-source-since">Replay Since</label>
              <input id="meeting-source-since" class="form-input" type="datetime-local" />
            </div>
            <div class="form-group">
              <label for="meeting-source-until">Replay Until</label>
              <input id="meeting-source-until" class="form-input" type="datetime-local" />
            </div>
            <div class="form-group">
              <label for="meeting-source-poll-interval-minutes">Poll Interval (min)</label>
              <input id="meeting-source-poll-interval-minutes" class="form-input" type="number" min="1" value="15" />
            </div>
            <div class="form-group">
              <label for="meeting-source-overlap-hours">Overlap Window (hour)</label>
              <input id="meeting-source-overlap-hours" class="form-input" type="number" min="0" value="24" />
            </div>
            <div class="form-group">
              <label for="meeting-source-provider-priority">Provider Priority</label>
              <select id="meeting-source-provider-priority" class="form-input">
                <option value="mode_default">online=Tactiq / offline・call=Plaud</option>
                <option value="tactiq_first">Tactiq first</option>
                <option value="plaud_first">Plaud first</option>
              </select>
            </div>
            <div class="form-group">
              <label for="meeting-source-org">Org</label>
              <input id="meeting-source-org" class="form-input" placeholder="例: brainbase" />
            </div>
            <div class="form-group">
              <label for="meeting-source-project">Project</label>
              <input id="meeting-source-project" class="form-input" placeholder="例: brainbase" />
            </div>
            <div class="form-group">
              <label for="meeting-source-case-scope">Case Scope</label>
              <input id="meeting-source-case-scope" class="form-input" placeholder="任意: meeting-source-sync" />
            </div>
            <div class="form-actions">
              <button class="btn-secondary btn-sm" id="meeting-source-preview-btn">Dry-run</button>
              <button class="btn-primary btn-sm" id="meeting-source-confirm-btn" disabled>Confirm</button>
            </div>
            <p id="meeting-source-resync-status" class="settings-section-desc"></p>
          </div>
        </div>
        <div id="meeting-source-preview-result" class="config-table-container"></div>
      </div>
    `;
  }

  async _refreshIntegrationsPanel(activeSubTab = null) {
    const [config, health, preferences, meetingSources] = await Promise.all([
      this.apiClient.getConfig(),
      this.apiClient.getHealth().catch(() => null),
      fetchPreferences(),
      this.apiClient.getMeetingSourceProviders().catch(() => null)
    ]);

    appStore.setState({
      settingsIntegrations: {
        slack: config.slack,
        github: config.github,
        nocodb: config.nocodb,
        meetingSources,
        health
      },
      settingsIntegrationProjects: config.projects?.projects || [],
      preferences
    });

    if (activeSubTab) {
      this.pendingIntegrationSubTab = activeSubTab;
    }

    const container = document.getElementById('integrations-panel');
    if (container) {
      await this.pluginRegistry.renderPanel('integrations', container);
    }
  }

  _setupGitHubCrud(container, github = [], projects = []) {
    const projectSelect = container.querySelector('#github-project-select');
    const ownerInput = container.querySelector('#github-owner-input');
    const repoInput = container.querySelector('#github-repo-input');
    const branchInput = container.querySelector('#github-branch-input');
    const saveBtn = container.querySelector('#github-save-btn');
    const deleteBtn = container.querySelector('#github-delete-btn');
    const resetBtn = container.querySelector('#github-reset-btn');
    const status = container.querySelector('#github-status');

    if (!projectSelect || !saveBtn || !deleteBtn) return;

    const mappingByProject = new Map((github || []).map(g => [g.project_id, g]));

    const clearForm = () => {
      projectSelect.value = '';
      if (ownerInput) ownerInput.value = '';
      if (repoInput) repoInput.value = '';
      if (branchInput) branchInput.value = '';
      if (status) status.textContent = '';
    };

    const fillForm = (projectId) => {
      const mapping = mappingByProject.get(projectId);
      if (!mapping) {
        if (ownerInput) ownerInput.value = '';
        if (repoInput) repoInput.value = '';
        if (branchInput) branchInput.value = '';
        return;
      }
      if (ownerInput) ownerInput.value = mapping.owner || '';
      if (repoInput) repoInput.value = mapping.repo || '';
      if (branchInput) branchInput.value = mapping.branch || 'main';
    };

    projectSelect.addEventListener('change', (e) => {
      fillForm(e.target.value);
    });

    resetBtn?.addEventListener('click', () => clearForm());

    container.querySelectorAll('[data-github-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.dataset.githubEdit;
        if (!projectId) return;
        projectSelect.value = projectId;
        fillForm(projectId);
      });
    });

    container.querySelectorAll('[data-github-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const projectId = btn.dataset.githubDelete;
        if (!projectId) return;
        if (status) status.textContent = '削除中...';
        try {
          await this.apiClient.deleteGitHubMapping(projectId);
          await eventBus.emit('settings:config-updated', { section: 'github', projectId });
          await this._refreshIntegrationsPanel('github');
        } catch (error) {
          if (status) status.textContent = '削除に失敗しました';
        }
      });
    });

    saveBtn.addEventListener('click', async () => {
      const projectId = projectSelect.value;
      const owner = ownerInput?.value?.trim() || '';
      const repo = repoInput?.value?.trim() || '';
      const branch = branchInput?.value?.trim() || '';

      if (!projectId || !owner || !repo) {
        if (status) status.textContent = 'Project / Owner / Repository は必須です';
        return;
      }

      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      if (status) status.textContent = '保存中...';

      try {
        await this.apiClient.upsertGitHubMapping({
          project_id: projectId,
          owner,
          repo,
          branch: branch || 'main'
        });
        await eventBus.emit('settings:config-updated', { section: 'github', projectId });
        await this._refreshIntegrationsPanel('github');
      } catch (error) {
        if (status) status.textContent = '保存に失敗しました';
      } finally {
        saveBtn.disabled = false;
        deleteBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const projectId = projectSelect.value;
      if (!projectId) {
        if (status) status.textContent = 'Project を選択してください';
        return;
      }
      if (status) status.textContent = '削除中...';
      try {
        await this.apiClient.deleteGitHubMapping(projectId);
        await eventBus.emit('settings:config-updated', { section: 'github', projectId });
        await this._refreshIntegrationsPanel('github');
      } catch (error) {
        if (status) status.textContent = '削除に失敗しました';
      }
    });
  }

  _setupNocoDBCrud(container, nocodb = [], projects = []) {
    const projectSelect = container.querySelector('#nocodb-project-select');
    const baseNameInput = container.querySelector('#nocodb-base-name-input');
    const baseIdInput = container.querySelector('#nocodb-base-id-input');
    const projectIdInput = container.querySelector('#nocodb-project-id-input');
    const urlInput = container.querySelector('#nocodb-url-input');
    const saveBtn = container.querySelector('#nocodb-save-btn');
    const deleteBtn = container.querySelector('#nocodb-delete-btn');
    const resetBtn = container.querySelector('#nocodb-reset-btn');
    const status = container.querySelector('#nocodb-status');

    if (!projectSelect || !saveBtn || !deleteBtn) return;

    const mappingByProject = new Map((nocodb || []).map(n => [n.project_id, n]));

    const clearForm = () => {
      projectSelect.value = '';
      if (baseNameInput) baseNameInput.value = '';
      if (baseIdInput) baseIdInput.value = '';
      if (projectIdInput) projectIdInput.value = '';
      if (urlInput) urlInput.value = '';
      if (status) status.textContent = '';
    };

    const fillForm = (projectId) => {
      const mapping = mappingByProject.get(projectId);
      if (!mapping) {
        if (baseNameInput) baseNameInput.value = '';
        if (baseIdInput) baseIdInput.value = '';
        if (projectIdInput) projectIdInput.value = '';
        if (urlInput) urlInput.value = '';
        return;
      }
      if (baseNameInput) baseNameInput.value = mapping.base_name || '';
      if (baseIdInput) baseIdInput.value = mapping.legacy_base_id || '';
      if (projectIdInput) projectIdInput.value = mapping.nocodb_project_id || '';
      if (urlInput) urlInput.value = mapping.url || '';
    };

    projectSelect.addEventListener('change', (e) => {
      fillForm(e.target.value);
    });

    resetBtn?.addEventListener('click', () => clearForm());

    container.querySelectorAll('[data-nocodb-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const projectId = btn.dataset.nocodbEdit;
        if (!projectId) return;
        projectSelect.value = projectId;
        fillForm(projectId);
      });
    });

    container.querySelectorAll('[data-nocodb-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const projectId = btn.dataset.nocodbDelete;
        if (!projectId) return;
        if (status) status.textContent = '削除中...';
        try {
          await this.apiClient.deleteNocoDBMapping(projectId);
          await eventBus.emit('settings:config-updated', { section: 'nocodb', projectId });
          await this._refreshIntegrationsPanel('nocodb');
        } catch (error) {
          if (status) status.textContent = '削除に失敗しました';
        }
      });
    });

    saveBtn.addEventListener('click', async () => {
      const projectId = projectSelect.value;
      const baseName = baseNameInput?.value?.trim() || '';
      const nocodbProjectId = projectIdInput?.value?.trim() || '';
      const legacyBaseId = baseIdInput?.value?.trim() || '';
      const url = urlInput?.value?.trim() || '';

      if (!projectId || !nocodbProjectId) {
        if (status) status.textContent = 'Project / NocoDB Project ID は必須です';
        return;
      }

      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      if (status) status.textContent = '保存中...';

      try {
        await this.apiClient.upsertNocoDBMapping({
          project_id: projectId,
          base_id: legacyBaseId,
          nocodb_project_id: nocodbProjectId,
          base_name: baseName,
          url
        });
        await eventBus.emit('settings:config-updated', { section: 'nocodb', projectId });
        await this._refreshIntegrationsPanel('nocodb');
      } catch (error) {
        if (status) status.textContent = '保存に失敗しました';
      } finally {
        saveBtn.disabled = false;
        deleteBtn.disabled = false;
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const projectId = projectSelect.value;
      if (!projectId) {
        if (status) status.textContent = 'Project を選択してください';
        return;
      }
      if (status) status.textContent = '削除中...';
      try {
        await this.apiClient.deleteNocoDBMapping(projectId);
        await eventBus.emit('settings:config-updated', { section: 'nocodb', projectId });
        await this._refreshIntegrationsPanel('nocodb');
      } catch (error) {
        if (status) status.textContent = '削除に失敗しました';
      }
    });
  }

  _setupMeetingSourcesCrud(container) {
    const providerStatus = container.querySelector('#meeting-source-provider-status');
    const resyncStatus = container.querySelector('#meeting-source-resync-status');
    const previewBtn = container.querySelector('#meeting-source-preview-btn');
    const confirmBtn = container.querySelector('#meeting-source-confirm-btn');
    const previewResult = container.querySelector('#meeting-source-preview-result');
    let currentPreviewId = null;

    const setProviderStatus = (message) => {
      if (providerStatus) providerStatus.textContent = message || '';
    };
    const setResyncStatus = (message) => {
      if (resyncStatus) resyncStatus.textContent = message || '';
    };

    container.querySelectorAll('[data-meeting-source-connect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.meetingSourceConnect;
        const accountInput = container.querySelector(`[data-meeting-source-account="${provider}"]`);
        const credentialInput = container.querySelector(`[data-meeting-source-credential="${provider}"]`);
        btn.disabled = true;
        setProviderStatus(`${provider} を保存中...`);
        try {
          await this.apiClient.connectMeetingSourceProvider(provider, {
            account_label: accountInput?.value?.trim() || provider,
            credential_ref: credentialInput?.value?.trim() || undefined
          });
          await eventBus.emit('settings:config-updated', { section: 'meeting-sources', provider });
          await this._refreshIntegrationsPanel('meeting-sources');
        } catch (error) {
          setProviderStatus(`${provider} の保存に失敗しました`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-meeting-source-test]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.meetingSourceTest;
        btn.disabled = true;
        setProviderStatus(`${provider} をテスト中...`);
        try {
          const result = await this.apiClient.testMeetingSourceProvider(provider);
          setProviderStatus(result.ok ? `${provider} の接続を確認しました` : `${provider} の接続確認に失敗しました: ${result.error || result.warning || 'unknown error'}`);
        } catch (error) {
          setProviderStatus(`${provider} の接続確認に失敗しました`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('[data-meeting-source-disconnect]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset.meetingSourceDisconnect;
        btn.disabled = true;
        setProviderStatus(`${provider} を切断中...`);
        try {
          await this.apiClient.disconnectMeetingSourceProvider(provider);
          await eventBus.emit('settings:config-updated', { section: 'meeting-sources', provider });
          await this._refreshIntegrationsPanel('meeting-sources');
        } catch (error) {
          setProviderStatus(`${provider} の切断に失敗しました`);
        } finally {
          btn.disabled = false;
        }
      });
    });

    const selectedProviders = () => Array.from(container.querySelectorAll('[data-meeting-source-resync-provider]:checked'))
      .map(input => input.value);
    const isoFromInput = (id) => {
      const value = container.querySelector(id)?.value || '';
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    const numberFromInput = (id, fallback) => {
      const value = Number(container.querySelector(id)?.value || '');
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    };
    const sourceLabel = (source) => {
      if (!source) return '-';
      const provider = source.provider || source.source_provider || source.source_system || 'source';
      const id = source.provider_source_id || source.external_id || source.source_id || source.mcp_resource_uri || '';
      return [provider, id].filter(Boolean).join(':');
    };
    const renderPreview = (result) => {
      const providerRows = (result.provider_results || []).map(providerResult => {
        const artifactCount = Number(providerResult.artifact_count || 0);
        const status = providerResult.error
          ? 'error'
          : providerResult.skipped
            ? 'skipped'
            : 'ready';
        const detail = providerResult.error || providerResult.reason || `${artifactCount} artifacts`;
        return `
          <tr>
            <td><span class="badge badge-type">${escapeHtml(providerResult.provider || '')}</span></td>
            <td>${escapeHtml(status)}</td>
            <td>${artifactCount}</td>
            <td>${escapeHtml(detail)}</td>
          </tr>
        `;
      }).join('');
      const rows = (result.clusters || []).map(cluster => {
        const primarySource = sourceLabel(cluster.primary_source);
        const supportingSources = (cluster.supporting_sources || []).map(sourceLabel).filter(Boolean);
        return `
          <tr>
            <td class="mono">${escapeHtml(cluster.source_cluster_id || '')}</td>
            <td>${escapeHtml(cluster.title || '')}</td>
            <td>${escapeHtml(cluster.meeting_mode || '')}</td>
            <td>${(cluster.providers || []).map(provider => `<span class="badge badge-type">${escapeHtml(provider)}</span>`).join(' ')}</td>
            <td>${escapeHtml(primarySource)}</td>
            <td>${supportingSources.length ? supportingSources.map(source => `<span class="badge badge-type">${escapeHtml(source)}</span>`).join(' ') : '-'}</td>
          </tr>
        `;
      }).join('');
      if (!previewResult) return;
      const hasProviderIssues = (result.provider_results || []).some(providerResult => providerResult.error || providerResult.skipped);
      previewResult.innerHTML = `
        <div class="settings-section-desc">
          preview_id: <span class="mono">${escapeHtml(result.preview_id || '')}</span> /
          artifacts: ${Number(result.artifact_count || 0)} /
          expected Meeting Pack: ${Number(result.expected_meeting_pack_count || 0)}
        </div>
        ${(result.errors || []).length ? `<p class="settings-section-desc text-danger">errors: ${escapeHtml((result.errors || []).map(e => `${e.provider}: ${e.message}`).join(' / '))}</p>` : ''}
        ${providerRows ? `
          <table class="config-table" data-meeting-source-provider-results>
            <thead>
              <tr><th>Provider</th><th>Status</th><th>Artifacts</th><th>Reason</th></tr>
            </thead>
            <tbody>${providerRows}</tbody>
          </table>
        ` : ''}
        ${rows ? `
          <table class="config-table">
            <thead>
              <tr><th>Cluster</th><th>Title</th><th>Mode</th><th>Providers</th><th>Primary Source</th><th>Supporting Sources</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        ` : `<div class="config-empty">${hasProviderIssues ? '同期候補はありません。providerの状態と理由を確認してください。' : '同期候補はありません'}</div>`}
      `;
    };

    previewBtn?.addEventListener('click', async () => {
      const providers = selectedProviders();
      const since = isoFromInput('#meeting-source-since');
      const until = isoFromInput('#meeting-source-until');
      if (providers.length === 0) {
        setResyncStatus('Providerを1つ以上選択してください');
        return;
      }
      if (!since && !until) {
        setResyncStatus('SinceまたはUntilを指定してください');
        return;
      }
      const orgId = container.querySelector('#meeting-source-org')?.value?.trim() || null;
      const projectId = container.querySelector('#meeting-source-project')?.value?.trim() || null;
      const caseScope = container.querySelector('#meeting-source-case-scope')?.value?.trim() || null;
      const syncPolicy = {
        poll_interval_minutes: numberFromInput('#meeting-source-poll-interval-minutes', 15),
        overlap_hours: numberFromInput('#meeting-source-overlap-hours', 24),
        provider_priority: container.querySelector('#meeting-source-provider-priority')?.value || 'mode_default'
      };
      if (!orgId || !projectId) {
        setResyncStatus('OrgとProjectを指定してください');
        return;
      }
      previewBtn.disabled = true;
      if (confirmBtn) confirmBtn.disabled = true;
      setResyncStatus('dry-run中...');
      try {
        const result = await this.apiClient.previewMeetingSourceResync({
          providers,
          since,
          until,
          org_id: orgId,
          project_id: projectId,
          case_scope: caseScope,
          sync_policy: syncPolicy,
          dry_run: true
        });
        currentPreviewId = result.preview_id;
        renderPreview(result);
        setResyncStatus('dry-runが完了しました。内容を確認してConfirmできます。');
        if (confirmBtn) confirmBtn.disabled = !currentPreviewId;
      } catch (error) {
        currentPreviewId = null;
        setResyncStatus('dry-runに失敗しました');
      } finally {
        previewBtn.disabled = false;
      }
    });

    confirmBtn?.addEventListener('click', async () => {
      if (!currentPreviewId) {
        setResyncStatus('先にdry-runを実行してください');
        return;
      }
      confirmBtn.disabled = true;
      setResyncStatus('confirm中...');
      try {
        const result = await this.apiClient.confirmMeetingSourceResync({ preview_id: currentPreviewId });
        const count = Number(result.meeting_pack_count || 0);
        setResyncStatus(result.submitted
          ? `${count}件のMeeting Packをレビュー取込へ送信しました`
          : `${count}件のMeeting Packドラフトを作成しました。レビュー取込は未送信です`);
        await eventBus.emit('settings:config-updated', { section: 'meeting-sources', previewId: currentPreviewId });
        await this._refreshIntegrationsPanel('meeting-sources');
      } catch (error) {
        setResyncStatus('confirmに失敗しました');
        confirmBtn.disabled = false;
      }
    });
  }

  _renderSlackDetails(slackConfig, container) {
    const workspacesContainer = container.querySelector('#slack-workspaces-list');
    const channelsContainer = container.querySelector('#slack-channels-list');
    const membersContainer = container.querySelector('#slack-members-list');
    const channelFilter = container.querySelector('#slack-channel-filter');
    const workspaceFilter = container.querySelector('#slack-workspace-filter');
    const memberFilter = container.querySelector('#slack-member-filter');

    if (!slackConfig) {
      workspacesContainer.innerHTML = '<div class="config-empty">Slack configuration not found</div>';
      channelsContainer.innerHTML = '<div class="config-empty">Slack configuration not found</div>';
      membersContainer.innerHTML = '<div class="config-empty">Slack configuration not found</div>';
      return;
    }

    this._renderSlackWorkspaces(slackConfig, workspacesContainer, workspaceFilter);
    this._renderSlackChannels(slackConfig, channelsContainer, '', workspaceFilter?.value || '');
    this._renderSlackMembers(slackConfig, membersContainer, '');

    if (channelFilter) {
      channelFilter.addEventListener('input', (e) => {
        const workspaceVal = workspaceFilter?.value || '';
        this._renderSlackChannels(slackConfig, channelsContainer, e.target.value, workspaceVal);
      });
    }

    if (workspaceFilter) {
      workspaceFilter.addEventListener('change', (e) => {
        const channelVal = channelFilter?.value || '';
        this._renderSlackChannels(slackConfig, channelsContainer, channelVal, e.target.value);
      });
    }

    if (memberFilter) {
      memberFilter.addEventListener('input', (e) => {
        this._renderSlackMembers(slackConfig, membersContainer, e.target.value);
      });
    }
  }

  _renderSlackWorkspaces(slackConfig, container, workspaceFilter) {
    const workspaces = slackConfig?.workspaces || {};
    const channels = slackConfig?.channels || [];

    if (Object.keys(workspaces).length === 0) {
      container.innerHTML = '<div class="config-empty">No workspaces found</div>';
      return;
    }

    const channelCounts = {};
    channels.forEach(ch => {
      channelCounts[ch.workspace] = (channelCounts[ch.workspace] || 0) + 1;
    });

    container.innerHTML = Object.entries(workspaces).map(([key, ws]) => `
      <div class="config-card">
        <div class="config-card-header">
          <h4>${escapeHtml(ws.name || key)}</h4>
          ${ws.default ? '<span class="badge badge-type">Default</span>' : ''}
        </div>
        <div class="config-card-id">${escapeHtml(ws.id || '')}</div>
        <div class="config-card-stats">
          <div class="config-card-stat">
            <i data-lucide="hash"></i>
            <span>${channelCounts[key] || 0} channels</span>
          </div>
          <div class="config-card-stat">
            <i data-lucide="folder"></i>
            <span>${(ws.projects || []).length} projects</span>
          </div>
        </div>
      </div>
    `).join('');

    if (workspaceFilter) {
      workspaceFilter.innerHTML = '<option value="">All Workspaces</option>' +
        Object.entries(workspaces).map(([key, ws]) =>
          `<option value="${escapeHtml(key)}">${escapeHtml(ws.name || key)}</option>`
        ).join('');
    }
  }

  _renderSlackChannels(slackConfig, container, filter = '', workspaceFilter = '') {
    let channels = slackConfig?.channels || [];

    if (channels.length === 0) {
      container.innerHTML = '<div class="config-empty">No channels found</div>';
      return;
    }

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      channels = channels.filter(ch =>
        ch.channel_name?.toLowerCase().includes(lowerFilter) ||
        ch.project_id?.toLowerCase().includes(lowerFilter)
      );
    }
    if (workspaceFilter) {
      channels = channels.filter(ch => ch.workspace === workspaceFilter);
    }

    container.innerHTML = `
      <table class="config-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Workspace</th>
            <th>Project</th>
            <th>Type</th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          ${channels.map(ch => `
            <tr>
              <td>#${escapeHtml(ch.channel_name || '')}</td>
              <td><span class="badge badge-workspace">${escapeHtml(ch.workspace || '')}</span></td>
              <td><span class="badge badge-project">${escapeHtml(ch.project_id || '')}</span></td>
              <td><span class="badge badge-type">${escapeHtml(ch.type || '-')}</span></td>
              <td class="mono">${escapeHtml(ch.channel_id || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  _renderSlackMembers(slackConfig, container, filter = '') {
    let members = slackConfig?.members || [];

    if (members.length === 0) {
      container.innerHTML = '<div class="config-empty">No members found</div>';
      return;
    }

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      members = members.filter(m =>
        m.slack_name?.toLowerCase().includes(lowerFilter) ||
        m.brainbase_name?.toLowerCase().includes(lowerFilter)
      );
    }

    container.innerHTML = `
      <table class="config-table">
        <thead>
          <tr>
            <th>Slack Name</th>
            <th>Brainbase Name</th>
            <th>Workspace</th>
            <th>Slack ID</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${members.map(m => `
            <tr>
              <td>@${escapeHtml(m.slack_name || '')}</td>
              <td>${escapeHtml(m.brainbase_name || '')}</td>
              <td><span class="badge badge-workspace">${escapeHtml(m.workspace || '')}</span></td>
              <td class="mono">${escapeHtml(m.slack_id || '')}</td>
              <td class="mono">${escapeHtml(m.note || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
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
    const channelConfig = channels || {};
    const dndConfig = dnd || {};

    const hourOptions = (selected) => {
      const numeric = Number.isFinite(Number(selected)) ? Number(selected) : null;
      const placeholder = `<option value="" ${numeric === null ? 'selected' : ''}>--</option>`;
      const hours = Array.from({ length: 24 }, (_, i) => `
        <option value="${i}" ${numeric === i ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>
      `).join('');
      return `${placeholder}${hours}`;
    };

    return `
      <div class="notifications-settings">
        <div class="settings-section">
          <div class="settings-section-header">
            <h3>Notification Channels</h3>
            <button class="btn-primary btn-sm" id="notifications-save-btn">保存</button>
          </div>
          <div class="settings-form-card">
            <div class="settings-form-grid">
              <label class="checkbox-label">
                <input type="checkbox" id="notify-slack" ${channelConfig.slack ? 'checked' : ''} />
                Slack
              </label>
              <label class="checkbox-label">
                <input type="checkbox" id="notify-web" ${channelConfig.web ? 'checked' : ''} />
                Web
              </label>
              <label class="checkbox-label">
                <input type="checkbox" id="notify-email" ${channelConfig.email ? 'checked' : ''} />
                Email
              </label>
            </div>
            <p class="settings-section-desc" id="notifications-status"></p>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-header">
            <h3>Do Not Disturb</h3>
          </div>
          <div class="settings-form-card">
            <label class="checkbox-label">
              <input type="checkbox" id="dnd-enabled" ${dndConfig.enabled ? 'checked' : ''} />
              DNDを有効にする
            </label>
            <div class="settings-form-grid">
              <div class="form-group">
                <label for="dnd-start">Start</label>
                <select id="dnd-start" class="form-input" ${dndConfig.enabled ? '' : 'disabled'}>
                  ${hourOptions(dndConfig.start)}
                </select>
              </div>
              <div class="form-group">
                <label for="dnd-end">End</label>
                <select id="dnd-end" class="form-input" ${dndConfig.enabled ? '' : 'disabled'}>
                  ${hourOptions(dndConfig.end)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async _refreshNotificationsPanel() {
    const notifications = await this.apiClient.getNotifications();
    appStore.setState({ settingsNotifications: notifications });

    const container = document.getElementById('notifications-panel');
    if (container) {
      await this.pluginRegistry.renderPanel('notifications', container);
    }
  }

  _setupNotificationsCrud(container, notifications = {}) {
    const saveBtn = container.querySelector('#notifications-save-btn');
    const slackInput = container.querySelector('#notify-slack');
    const webInput = container.querySelector('#notify-web');
    const emailInput = container.querySelector('#notify-email');
    const dndEnabled = container.querySelector('#dnd-enabled');
    const dndStart = container.querySelector('#dnd-start');
    const dndEnd = container.querySelector('#dnd-end');
    const status = container.querySelector('#notifications-status');

    if (!saveBtn) return;

    const toggleDndInputs = () => {
      const enabled = Boolean(dndEnabled?.checked);
      if (dndStart) dndStart.disabled = !enabled;
      if (dndEnd) dndEnd.disabled = !enabled;
    };

    dndEnabled?.addEventListener('change', toggleDndInputs);

    saveBtn.addEventListener('click', async () => {
      const startValue = dndStart?.value ?? '';
      const endValue = dndEnd?.value ?? '';
      const payload = {
        channels: {
          slack: Boolean(slackInput?.checked),
          web: Boolean(webInput?.checked),
          email: Boolean(emailInput?.checked)
        },
        dnd: {
          enabled: Boolean(dndEnabled?.checked),
          start: startValue === '' ? null : Number(startValue),
          end: endValue === '' ? null : Number(endValue)
        }
      };

      saveBtn.disabled = true;
      if (status) status.textContent = '保存中...';

      try {
        await this.apiClient.updateNotifications(payload);
        await this._refreshNotificationsPanel();
      } catch (error) {
        if (status) status.textContent = '保存に失敗しました';
      } finally {
        saveBtn.disabled = false;
      }
    });
  }
}

/**
 * 簡易APIクライアント（Core Settings用）
 */
export class CoreApiClient {
  constructor(client = httpClient) {
    this.client = client;
  }

  async getConfig() {
    return this.client.get('/api/config');
  }

  async getIntegrity() {
    return this.client.get('/api/config/integrity');
  }

  async getUnified() {
    return this.client.get('/api/config/unified');
  }

  async getHealth() {
    return this.client.get('/api/health');
  }

  async getOrganizations() {
    return this.client.get('/api/config/organizations');
  }

  async getDependencies() {
    return this.client.get('/api/config/dependencies');
  }

  async getNotifications() {
    return this.client.get('/api/config/notifications');
  }

  async upsertProject(payload) {
    return this.client.post('/api/config/projects', payload);
  }

  async deleteProject(projectId) {
    return this.client.delete(`/api/config/projects/${encodeURIComponent(projectId)}`);
  }

  async upsertOrganization(payload) {
    return this.client.post('/api/config/organizations', payload);
  }

  async deleteOrganization(orgId) {
    return this.client.delete(`/api/config/organizations/${encodeURIComponent(orgId)}`);
  }

  async updateNotifications(payload) {
    return this.client.put('/api/config/notifications', payload);
  }

  async upsertGitHubMapping(payload) {
    return this.client.post('/api/config/github', payload);
  }

  async deleteGitHubMapping(projectId) {
    return this.client.delete(`/api/config/github/${encodeURIComponent(projectId)}`);
  }

  async upsertNocoDBMapping(payload) {
    return this.client.post('/api/config/nocodb', payload);
  }

  async deleteNocoDBMapping(projectId) {
    return this.client.delete(`/api/config/nocodb/${encodeURIComponent(projectId)}`);
  }

  async getMeetingSourceProviders() {
    return this.client.get('/api/settings/meeting-sources/mcp-providers');
  }

  async connectMeetingSourceProvider(provider, payload) {
    return this.client.post(`/api/settings/meeting-sources/mcp-providers/${encodeURIComponent(provider)}/connect`, payload);
  }

  async testMeetingSourceProvider(provider) {
    return this.client.post(`/api/settings/meeting-sources/mcp-providers/${encodeURIComponent(provider)}/test`, {});
  }

  async disconnectMeetingSourceProvider(provider) {
    return this.client.post(`/api/settings/meeting-sources/mcp-providers/${encodeURIComponent(provider)}/disconnect`, {});
  }

  async previewMeetingSourceResync(payload) {
    return this.client.post('/api/settings/meeting-sources/resync-preview', payload);
  }

  async confirmMeetingSourceResync(payload) {
    return this.client.post('/api/settings/meeting-sources/resync-confirm', payload);
  }
}

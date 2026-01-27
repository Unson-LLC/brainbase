/**
 * Settings Core Module
 *
 * Core Settings実装（OSS版）
 * Overview PanelとProjects PanelをPlugin Registryに登録します。
 */

import { eventBus } from '../core/event-bus.js';
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
          this._setupProjectsCrud(container, projects?.projects || []);
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
          const organizations = await this.apiClient.getOrganizations();
          appStore.setState({ settingsOrganizations: organizations });
        },
        render: async (container) => {
          const { settingsOrganizations } = appStore.getState();
          container.innerHTML = this._renderOrganizationsHTML(settingsOrganizations || []);
          this._setupOrganizationsCrud(container, settingsOrganizations || []);

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
          const [config, health, preferences] = await Promise.all([
            this.apiClient.getConfig(),
            this.apiClient.getHealth().catch(() => null),
            fetchPreferences()
          ]);
          appStore.setState({
            settingsIntegrations: {
              slack: config.slack,
              github: config.github,
              nocodb: config.nocodb,
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
          this._setupNotificationsCrud(container, notifications);

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
          <h3>Organization Editor</h3>
          <button class="btn-secondary btn-sm" id="org-reset-btn">クリア</button>
        </div>
        <p class="settings-section-desc">法人情報とプロジェクト紐づけを管理します</p>
        <div class="settings-form-grid">
          <div class="form-group">
            <label for="org-id-input">Organization ID</label>
            <input id="org-id-input" class="form-input" placeholder="salestailor" />
          </div>
          <div class="form-group">
            <label for="org-name-input">Name</label>
            <input id="org-name-input" class="form-input" placeholder="SalesTailor Inc." />
          </div>
          <div class="form-group">
            <label for="org-ceo-input">CEO</label>
            <input id="org-ceo-input" class="form-input" placeholder="hori_shiori" />
          </div>
          <div class="form-group">
            <label for="org-projects-input">Projects (comma separated)</label>
            <input id="org-projects-input" class="form-input" placeholder="salestailor, salestailor-app" />
          </div>
          <div class="form-actions">
            <button class="btn-primary btn-sm" id="org-save-btn">保存</button>
            <button class="btn-danger btn-sm" id="org-delete-btn">削除</button>
          </div>
          <p class="settings-section-desc" id="org-status"></p>
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

    const { slack, github, nocodb, health } = integrations;
    const slackConnected = slack && (slack.workspaces || slack.channels);
    const slackWorkspaceCount = slack?.workspaces ? Object.keys(slack.workspaces).length : 0;
    const slackChannelCount = slack?.channels?.length || 0;
    const slackMemberCount = slack?.members?.length || 0;
    const githubCount = github?.length || 0;
    const nocodbCount = nocodb?.length || 0;

    const assignee = preferences.user?.assignee || '';
    const escapedAssignee = escapeHtml(assignee);
    const mappingHtml = this._renderNocoDBMappings(nocodb);
    const projectOptions = (projects || []).map(p => `
      <option value="${escapeHtml(p.id || '')}">${escapeHtml(p.id || '')}</option>
    `).join('');

    const navItem = (key, label, icon, connected, metaHtml) => `
      <button class="integration-nav-item ${connected ? 'connected' : 'disconnected'}" data-integration="${key}">
        <div class="integration-nav-main">
          <i data-lucide="${icon}"></i>
          <div class="integration-nav-text">
            <span class="integration-nav-title">${label}</span>
            <span class="integration-nav-status ${connected ? 'success' : 'warning'}">
              ${connected ? 'Connected' : 'Not Configured'}
            </span>
          </div>
        </div>
        <div class="integration-nav-meta">
          ${metaHtml}
        </div>
      </button>
    `;

    return `
      <div class="integrations-layout">
        <aside class="integrations-sidebar">
          <div class="integrations-sidebar-title">Integrations</div>
          ${navItem(
      'slack',
      'Slack',
      'hash',
      !!slackConnected,
      `<span>${slackWorkspaceCount} WS</span><span>${slackChannelCount} CH</span><span>${slackMemberCount} MB</span>`
    )}
          ${navItem(
      'github',
      'GitHub',
      'github',
      githubCount > 0,
      `<span>${githubCount} Repos</span>`
    )}
          ${navItem(
      'nocodb',
      'NocoDB',
      'table-2',
      nocodbCount > 0,
      `<span>${nocodbCount} Bases</span>`
    )}
        </aside>

        <div class="integrations-main">
          <div class="integration-panel active" data-integration-panel="slack">
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

          <div class="integration-panel" data-integration-panel="github">
            ${this._renderGitHubSection(github, projects)}
          </div>

          <div class="integration-panel" data-integration-panel="nocodb">
            <div class="settings-section">
              <h3>自分の担当者名</h3>
              <p class="settings-section-desc">「自分だけ」フィルタとプロジェクトタスク追加の既定値に使用します</p>
              <div class="form-group">
                <label for="nocodb-self-assignee">担当者名</label>
                <input
                  type="text"
                  id="nocodb-self-assignee"
                  class="form-input"
                  placeholder="例: ksato"
                  value="${escapedAssignee}">
              </div>
              <button id="nocodb-self-assignee-save" class="btn-secondary btn-sm">保存</button>
              <p id="nocodb-self-assignee-status" class="settings-section-desc"></p>
            </div>

            <div class="settings-section">
              <div class="settings-section-header">
                <h3>NocoDB Mapping Editor</h3>
                <button class="btn-secondary btn-sm" id="nocodb-reset-btn">クリア</button>
              </div>
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
      </div>
    `;
  }

  _setupIntegrationNav(container, initialTab = null) {
    const items = Array.from(container.querySelectorAll('.integration-nav-item'));
    const panels = Array.from(container.querySelectorAll('.integration-panel'));
    if (items.length === 0 || panels.length === 0) return;

    const activate = (key) => {
      items.forEach(item => {
        item.classList.toggle('active', item.dataset.integration === key);
      });
      panels.forEach(panel => {
        panel.classList.toggle('active', panel.dataset.integrationPanel === key);
      });
    };

    const defaultKey = initialTab || items[0].dataset.integration;
    activate(defaultKey);

    items.forEach(item => {
      item.addEventListener('click', () => {
        activate(item.dataset.integration);
      });
    });
  }

  _renderGitHubSection(github, projects = []) {
    const projectOptions = (projects || []).map(p => `
      <option value="${escapeHtml(p.id || '')}">${escapeHtml(p.id || '')}</option>
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
          <h3>GitHub Repository Mappings</h3>
          <button class="btn-secondary btn-sm" id="github-reset-btn">クリア</button>
        </div>
        <p class="settings-section-desc">プロジェクトとGitHubリポジトリの対応関係（正本: config.yml）</p>
        <div class="settings-form-grid">
          <div class="form-group">
            <label for="github-project-select">Project</label>
            <select id="github-project-select" class="form-input">
              <option value="">選択...</option>
              ${projectOptions}
            </select>
          </div>
          <div class="form-group">
            <label for="github-owner-input">Owner</label>
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
        ${rows
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

  async _refreshIntegrationsPanel(activeSubTab = null) {
    const [config, health, preferences] = await Promise.all([
      this.apiClient.getConfig(),
      this.apiClient.getHealth().catch(() => null),
      fetchPreferences()
    ]);

    appStore.setState({
      settingsIntegrations: {
        slack: config.slack,
        github: config.github,
        nocodb: config.nocodb,
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
    const channelConfig = channels || { slack: true, web: true, email: false };
    const dndConfig = dnd || { enabled: false, start: 22, end: 9 };

    const hourOptions = (selected) => Array.from({ length: 24 }, (_, i) => `
      <option value="${i}" ${Number(selected) === i ? 'selected' : ''}>${String(i).padStart(2, '0')}:00</option>
    `).join('');

    return `
      <div class="notifications-settings">
        <div class="settings-section">
          <div class="settings-section-header">
            <h3>Notification Channels</h3>
            <button class="btn-primary btn-sm" id="notifications-save-btn">保存</button>
          </div>
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

        <div class="settings-section">
          <h3>Do Not Disturb</h3>
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
      const payload = {
        channels: {
          slack: Boolean(slackInput?.checked),
          web: Boolean(webInput?.checked),
          email: Boolean(emailInput?.checked)
        },
        dnd: {
          enabled: Boolean(dndEnabled?.checked),
          start: dndStart ? Number(dndStart.value) : 0,
          end: dndEnd ? Number(dndEnd.value) : 0
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

  async upsertProject(payload) {
    const response = await fetch('/api/config/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update project');
    }
    return response.json();
  }

  async deleteProject(projectId) {
    const response = await fetch(`/api/config/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to delete project');
    }
    return response.json();
  }

  async upsertOrganization(payload) {
    const response = await fetch('/api/config/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update organization');
    }
    return response.json();
  }

  async deleteOrganization(orgId) {
    const response = await fetch(`/api/config/organizations/${encodeURIComponent(orgId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to delete organization');
    }
    return response.json();
  }

  async updateNotifications(payload) {
    const response = await fetch('/api/config/notifications', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update notifications');
    }
    return response.json();
  }

  async upsertGitHubMapping(payload) {
    const response = await fetch('/api/config/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update GitHub mapping');
    }
    return response.json();
  }

  async deleteGitHubMapping(projectId) {
    const response = await fetch(`/api/config/github/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to delete GitHub mapping');
    }
    return response.json();
  }

  async upsertNocoDBMapping(payload) {
    const response = await fetch('/api/config/nocodb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to update NocoDB mapping');
    }
    return response.json();
  }

  async deleteNocoDBMapping(projectId) {
    const response = await fetch(`/api/config/nocodb/${encodeURIComponent(projectId)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to delete NocoDB mapping');
    }
    return response.json();
  }
}

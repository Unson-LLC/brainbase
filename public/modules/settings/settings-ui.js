/**
 * Settings UI Module
 *
 * Settings Modal/TabのUI制御を提供します。
 * Plugin Registryと連携し、動的にタブナビゲーションを生成します。
 */

export class SettingsUI {
  constructor() {
    this.modal = null;
    this.modalContent = null;
    this.settingsBtn = null;
    this.closeBtn = null;
    this.tabsContainer = null;
    this.panelsContainer = null;
    this.isModalOpen = false;

    // コールバック
    this.onOpenCallback = null;
    this.onCloseCallback = null;
    this.onTabSwitchCallback = null;
  }

  /**
   * UI初期化
   */
  init() {
    // DOM要素を取得
    this.modal = document.getElementById('settings-modal');
    this.modalContent = document.getElementById('settings-view');
    this.settingsBtn = document.getElementById('settings-btn');
    this.closeBtn = document.getElementById('close-settings-btn');

    // Settings Modal の構造を初期化（Plugin Architecture対応）
    this._initModalStructure();

    this.tabsContainer = document.querySelector('.settings-tabs');
    this.panelsContainer = document.querySelector('.settings-content');

    // イベントリスナー設定
    this._setupEventListeners();
  }

  /**
   * Settings Modal の構造を初期化
   * Plugin Architecture に対応した空の構造を生成
   * @private
   */
  _initModalStructure() {
    const modalBody = this.modalContent?.querySelector('.modal-body');
    if (!modalBody) return;

    // modal-body の内容を完全にクリアして、Plugin Architecture用の構造を作成
    // 古い integrity-summary、ハードコードされたタブ、パネルをすべて削除
    modalBody.innerHTML = `
      <div class="settings-tabs"></div>
      <div class="settings-content"></div>
    `;
  }

  /**
   * Modal開閉イベント
   * @param {Function} callback - Modal開閉時のコールバック
   */
  onOpen(callback) {
    this.onOpenCallback = callback;
  }

  /**
   * Modal閉鎖イベント
   * @param {Function} callback - Modal閉鎖時のコールバック
   */
  onClose(callback) {
    this.onCloseCallback = callback;
  }

  /**
   * タブ切り替えイベント
   * @param {Function} callback - タブ切り替え時のコールバック(tabId引数)
   */
  onTabSwitch(callback) {
    this.onTabSwitchCallback = callback;
  }

  /**
   * Modal表示
   */
  async openModal() {
    if (!this.modal) return;

    this.modal.classList.add('active');
    if (this.settingsBtn) {
      this.settingsBtn.classList.add('active');
    }
    this.isModalOpen = true;

    // コールバック実行
    if (this.onOpenCallback) {
      await this.onOpenCallback();
    }

    // Lucide icons再初期化（動的にタブが追加された場合のため）
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  /**
   * Modal非表示
   */
  closeModal() {
    if (!this.modal) return;

    this.modal.classList.remove('active');
    if (this.settingsBtn) {
      this.settingsBtn.classList.remove('active');
    }
    this.isModalOpen = false;

    // コールバック実行
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * タブナビゲーションをレンダリング
   * @param {Array<{id: string, displayName: string, order: number}>} tabs - タブ一覧
   * @param {string} activeTabId - アクティブなタブID
   */
  renderTabs(tabs, activeTabId) {
    if (!this.tabsContainer) return;

    this.tabsContainer.innerHTML = tabs
      .map(tab => `
        <button
          class="settings-tab ${tab.id === activeTabId ? 'active' : ''}"
          data-tab="${tab.id}"
        >
          <i data-lucide="${this._getTabIcon(tab.id)}"></i>
          ${tab.displayName}
        </button>
      `)
      .join('');

    // Lucide icons再初期化
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }

    // タブクリックイベントを再設定
    this._setupTabClickListeners();
  }

  /**
   * タブをアクティブ化
   * @param {string} tabId - タブID
   */
  activateTab(tabId) {
    if (!this.tabsContainer || !this.panelsContainer) return;

    // タブボタンのactive切り替え
    const tabButtons = this.tabsContainer.querySelectorAll('.settings-tab');
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // パネルのactive切り替え
    const panels = this.panelsContainer.querySelectorAll('.settings-panel');
    panels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${tabId}-panel`);
    });
  }

  /**
   * Modal開閉状態を取得
   * @returns {boolean}
   */
  isOpen() {
    return this.isModalOpen;
  }

  /**
   * イベントリスナー設定
   * @private
   */
  _setupEventListeners() {
    // Settings button click
    this.settingsBtn?.addEventListener('click', () => {
      this.openModal();
    });

    // Close button click
    this.closeBtn?.addEventListener('click', () => {
      this.closeModal();
    });

    // Backdrop click
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.closeModal();
      }
    });
  }

  /**
   * タブクリックイベント設定
   * @private
   */
  _setupTabClickListeners() {
    if (!this.tabsContainer) return;

    const tabButtons = this.tabsContainer.querySelectorAll('.settings-tab');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (this.onTabSwitchCallback) {
          this.onTabSwitchCallback(tabId);
        }
      });
    });
  }

  /**
   * タブアイコンを取得
   * @private
   * @param {string} tabId - タブID
   * @returns {string} Lucideアイコン名
   */
  _getTabIcon(tabId) {
    const iconMap = {
      'overview': 'layout-grid',
      'projects': 'folder-git-2',
      'slack': 'hash',
      'github': 'github',
      'nocodb': 'table-2',
      'airtable': 'table'
    };

    return iconMap[tabId] || 'folder';
  }
}

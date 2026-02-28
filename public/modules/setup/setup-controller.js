/**
 * Setup Controller - Frontend
 * ユーザーのセットアップ設定を取得し、config.ymlをダウンロード可能にする
 */

const STORAGE_TOKEN_KEY = 'brainbase.auth.token';
const SETUP_CONFIG_ENDPOINT = '/api/setup/config';
const DEFAULT_ERROR_MESSAGE = 'セットアップ設定の取得に失敗しました';

export class SetupController {
    constructor() {
        this.config = null;
        this.downloadListenerRegistered = false;
    }

    async init() {
        try {
            const token = this.getAuthToken();
            if (!token) {
                this.redirectToDevice('No auth token found, redirecting to auth');
                return;
            }

            const config = await this.fetchSetupConfig(token);
            if (!config) {
                return;
            }

            this.config = config;
            this.renderSetup();
            this.attachEventListeners();

        } catch (error) {
            console.error('Setup init error:', error);
            this.showError(error.message || DEFAULT_ERROR_MESSAGE);
        }
    }

    getAuthToken() {
        return localStorage.getItem(STORAGE_TOKEN_KEY);
    }

    redirectToDevice(message) {
        if (message) {
            console.warn(message);
        }
        window.location.href = '/device';
    }

    handleUnauthorized() {
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        this.redirectToDevice('Auth token invalid, redirecting to auth');
    }

    async fetchSetupConfig(token) {
        const response = await fetch(SETUP_CONFIG_ENDPOINT, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                this.handleUnauthorized();
                return null;
            }
            throw new Error(`Failed to fetch setup config: ${response.status}`);
        }

        const config = await response.json();

        if (!config.ok) {
            throw new Error(config.error || 'Failed to fetch setup config');
        }

        return config;
    }

    renderSetup() {
        this.hideElement('loading');
        this.showElement('setup-content');

        const { user, projects } = this.config;
        this.updateUserInfo(user);
        this.renderProjectList(projects);
    }

    attachEventListeners() {
        if (this.downloadListenerRegistered) {
            return;
        }

        const downloadBtn = document.getElementById('download-btn');
        if (!downloadBtn) {
            console.warn('Download button not found');
            return;
        }

        downloadBtn.addEventListener('click', () => {
            this.downloadConfig();
        });

        this.downloadListenerRegistered = true;
    }

    downloadConfig() {
        const configYaml = this.config?.configYaml;
        if (!configYaml) {
            console.error('Config YAML is not ready for download');
            return;
        }

        const blob = new Blob([configYaml], { type: 'text/yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'config.yml';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    showError(message) {
        this.hideElement('loading');
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }

    updateUserInfo(user = {}) {
        const { name = '-', slackUserId = '-', workspaceId = '-' } = user;
        this.setTextContent('user-name', name);
        this.setTextContent('slack-user-id', slackUserId);
        this.setTextContent('workspace-id', workspaceId);
    }

    renderProjectList(projects = []) {
        const projectList = document.getElementById('project-list');
        if (!projectList) {
            console.warn('Project list element not found');
            return;
        }

        projectList.innerHTML = '';

        if (projects.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'アクセス可能なプロジェクトがありません';
            li.style.color = '#fca5a5';
            projectList.appendChild(li);
            return;
        }

        projects.forEach(project => {
            projectList.appendChild(this.createProjectListItem(project));
        });
    }

    createProjectListItem(project) {
        const li = document.createElement('li');
        const description = project.description ? ` - ${project.description}` : '';
        li.innerHTML = `<strong>${project.name}</strong> (${project.id})${description}`;
        return li;
    }

    setTextContent(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    showElement(elementId, displayValue = 'block') {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.display = displayValue;
        }
    }

    hideElement(elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.style.display = 'none';
        }
    }
}

// 初期化
const controller = new SetupController();
controller.init();

/**
 * Setup Controller - Frontend
 * ユーザーのセットアップ設定を取得し、config.ymlをダウンロード可能にする
 */

const STORAGE_TOKEN_KEY = 'brainbase.auth.token';

export class SetupController {
    constructor() {
        this.config = null;
    }

    async init() {
        try {
            // 認証チェック
            const token = localStorage.getItem(STORAGE_TOKEN_KEY);
            if (!token) {
                console.warn('No auth token found, redirecting to auth');
                window.location.href = '/device';
                return;
            }

            // セットアップ設定を取得
            const response = await fetch('/api/setup/config', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                if (response.status === 401) {
                    localStorage.removeItem(STORAGE_TOKEN_KEY);
                    window.location.href = '/device';
                    return;
                }
                throw new Error(`Failed to fetch setup config: ${response.status}`);
            }

            this.config = await response.json();

            if (!this.config.ok) {
                throw new Error(this.config.error || 'Failed to fetch setup config');
            }

            this.renderSetup();
            this.attachEventListeners();

        } catch (error) {
            console.error('Setup init error:', error);
            this.showError(error.message || 'セットアップ設定の取得に失敗しました');
        }
    }

    renderSetup() {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('setup-content').style.display = 'block';

        // ユーザー情報
        document.getElementById('user-name').textContent = this.config.user.name;
        document.getElementById('slack-user-id').textContent = this.config.user.slackUserId;
        document.getElementById('workspace-id').textContent = this.config.user.workspaceId;

        // プロジェクト一覧
        const projectList = document.getElementById('project-list');
        projectList.innerHTML = '';

        if (this.config.projects.length === 0) {
            const li = document.createElement('li');
            li.textContent = 'アクセス可能なプロジェクトがありません';
            li.style.color = '#fca5a5';
            projectList.appendChild(li);
        } else {
            this.config.projects.forEach(project => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${project.name}</strong> (${project.id})${project.description ? ` - ${project.description}` : ''}`;
                projectList.appendChild(li);
            });
        }
    }

    attachEventListeners() {
        document.getElementById('download-btn').addEventListener('click', () => {
            this.downloadConfig();
        });
    }

    downloadConfig() {
        const blob = new Blob([this.config.configYaml], { type: 'text/yaml' });
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
        document.getElementById('loading').style.display = 'none';
        const errorDiv = document.getElementById('error');
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
    }
}

// 初期化
const controller = new SetupController();
controller.init();

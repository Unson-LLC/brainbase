/**
 * Device Authorization Controller
 * Handles OAuth 2.0 Device Code Flow (RFC 8628) for CLI clients
 */
export class DeviceAuthController {
    constructor() {
        this.deviceCode = null;
        this.userCode = null;
        this.slackUserId = null;
        this.slackWorkspaceId = null;

        // DOM elements
        this.stepInput = null;
        this.stepSlack = null;
        this.stepApprove = null;
        this.stepSuccess = null;
        this.stepError = null;

        this.userCodeInput = null;
        this.verifyBtn = null;
        this.verifyError = null;
        this.slackLoginBtn = null;
        this.approveBtn = null;
        this.denyBtn = null;
        this.backToInputBtn = null;

        this.userCodeDisplay = null;
        this.userCodeDisplayApprove = null;
        this.errorDesc = null;
    }

    init() {
        this.cacheElements();
        this.attachEventListeners();
        this.checkUrlParams();
    }

    cacheElements() {
        this.stepInput = document.getElementById('step-input');
        this.stepSlack = document.getElementById('step-slack');
        this.stepApprove = document.getElementById('step-approve');
        this.stepSuccess = document.getElementById('step-success');
        this.stepError = document.getElementById('step-error');

        this.userCodeInput = document.getElementById('user-code-input');
        this.verifyBtn = document.getElementById('verify-btn');
        this.verifyError = document.getElementById('verify-error');
        this.slackLoginBtn = document.getElementById('slack-login-btn');
        this.approveBtn = document.getElementById('approve-btn');
        this.denyBtn = document.getElementById('deny-btn');
        this.backToInputBtn = document.getElementById('back-to-input-btn');

        this.userCodeDisplay = document.getElementById('user-code-display');
        this.userCodeDisplayApprove = document.getElementById('user-code-display-approve');
        this.errorDesc = document.getElementById('error-desc');
    }

    attachEventListeners() {
        // User code input: format as XXXX-XXXX
        this.userCodeInput.addEventListener('input', (e) => {
            let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (value.length > 4) {
                value = value.slice(0, 4) + '-' + value.slice(4, 8);
            }
            e.target.value = value;
            this.verifyBtn.disabled = value.replace('-', '').length !== 8;
        });

        // Verify user code
        this.verifyBtn.addEventListener('click', () => this.verifyUserCode());

        // Slack login
        this.slackLoginBtn.addEventListener('click', () => this.startSlackAuth());

        // Approve/Deny
        this.approveBtn.addEventListener('click', () => this.approveDevice());
        this.denyBtn.addEventListener('click', () => this.denyDevice());

        // Back button
        this.backToInputBtn.addEventListener('click', () => this.showStep('input'));

        // Enter key on input
        this.userCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !this.verifyBtn.disabled) {
                this.verifyUserCode();
            }
        });
    }

    checkUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const userCode = params.get('user_code');

        if (userCode) {
            // Auto-fill and verify if user_code is in URL (verification_uri_complete)
            this.userCodeInput.value = userCode.toUpperCase();
            this.verifyBtn.disabled = false;
            this.verifyUserCode();
        }

        // Check if returning from Slack OAuth
        const slackCallback = params.get('slack_callback');
        if (slackCallback === 'true') {
            const deviceCode = sessionStorage.getItem('brainbase_device_code');
            const userCode = sessionStorage.getItem('brainbase_user_code');

            // Slack認証後、localStorageからaccess情報を取得
            let slackUserId = null;
            let slackWorkspaceId = null;
            try {
                const accessJson = localStorage.getItem('brainbase_access');
                if (accessJson) {
                    const access = JSON.parse(accessJson);
                    slackUserId = access.slackUserId;
                    slackWorkspaceId = access.workspaceId;
                }
            } catch (e) {
                console.error('Failed to parse access from localStorage', e);
            }

            if (deviceCode && userCode && slackUserId && slackWorkspaceId) {
                this.deviceCode = deviceCode;
                this.userCode = userCode;
                this.slackUserId = slackUserId;
                this.slackWorkspaceId = slackWorkspaceId;

                this.userCodeDisplay.textContent = userCode;
                this.userCodeDisplayApprove.textContent = userCode;

                this.showStep('approve');
            } else {
                this.showGlobalError('Slack認証情報が見つかりません。もう一度お試しください。');
            }
        }
    }

    showStep(step) {
        const steps = ['input', 'slack', 'approve', 'success', 'error'];
        steps.forEach(s => {
            const el = document.getElementById(`step-${s}`);
            if (el) {
                el.classList.toggle('active', s === step);
            }
        });
    }

    async verifyUserCode() {
        // ハイフンを削除して、正しいフォーマット（XXXX-XXXX）に再フォーマット
        const rawCode = this.userCodeInput.value.replace(/-/g, '').toUpperCase();
        if (rawCode.length !== 8) {
            this.showError('正しい形式で入力してください (XXXX-XXXX)');
            return;
        }
        const userCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;

        this.verifyBtn.disabled = true;
        this.verifyBtn.innerHTML = '<span class="spinner"></span> 確認中...';
        this.hideError();

        try {
            const response = await fetch('/api/auth/device/verify-user-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_code: userCode })
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || 'コードの確認に失敗しました');
            }

            this.deviceCode = data.device_code;
            this.userCode = userCode;
            this.userCodeDisplay.textContent = this.formatUserCode(userCode);
            this.userCodeDisplayApprove.textContent = this.formatUserCode(userCode);

            // Save to sessionStorage for Slack callback
            sessionStorage.setItem('brainbase_device_code', this.deviceCode);
            sessionStorage.setItem('brainbase_user_code', this.formatUserCode(userCode));

            this.showStep('slack');
        } catch (error) {
            this.showError(error.message || 'コードの確認に失敗しました');
        } finally {
            this.verifyBtn.disabled = false;
            this.verifyBtn.textContent = '次へ';
        }
    }

    startSlackAuth() {
        if (!this.deviceCode) {
            this.showGlobalError('デバイスコードが見つかりません');
            return;
        }

        // Save device_code to sessionStorage
        sessionStorage.setItem('brainbase_device_code', this.deviceCode);
        sessionStorage.setItem('brainbase_user_code', this.userCode);

        // Redirect to Slack OAuth
        const returnUrl = `${window.location.origin}/device?slack_callback=true`;
        const authUrl = `/api/auth/slack/start?origin=${encodeURIComponent(returnUrl)}&redirect=${encodeURIComponent(returnUrl)}`;

        window.location.href = authUrl;
    }

    async approveDevice() {
        if (!this.deviceCode || !this.slackUserId || !this.slackWorkspaceId) {
            this.showGlobalError('認証情報が見つかりません');
            return;
        }

        this.approveBtn.disabled = true;
        this.approveBtn.innerHTML = '<span class="spinner"></span> 承認中...';

        try {
            const response = await fetch('/api/auth/device/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_code: this.deviceCode,
                    slack_user_id: this.slackUserId,
                    slack_workspace_id: this.slackWorkspaceId
                })
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || '承認に失敗しました');
            }

            // Clear sessionStorage
            sessionStorage.removeItem('brainbase_device_code');
            sessionStorage.removeItem('brainbase_user_code');
            sessionStorage.removeItem('brainbase_slack_user_id');
            sessionStorage.removeItem('brainbase_slack_workspace_id');

            this.showStep('success');
        } catch (error) {
            this.showGlobalError(error.message || '承認に失敗しました');
        } finally {
            this.approveBtn.disabled = false;
            this.approveBtn.textContent = '許可';
        }
    }

    async denyDevice() {
        if (!this.deviceCode) {
            this.showGlobalError('デバイスコードが見つかりません');
            return;
        }

        this.denyBtn.disabled = true;
        this.denyBtn.innerHTML = '<span class="spinner"></span> 拒否中...';

        try {
            const response = await fetch('/api/auth/device/deny', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ device_code: this.deviceCode })
            });

            const data = await response.json();

            if (!response.ok || !data.ok) {
                throw new Error(data.error || '拒否に失敗しました');
            }

            // Clear sessionStorage
            sessionStorage.removeItem('brainbase_device_code');
            sessionStorage.removeItem('brainbase_user_code');
            sessionStorage.removeItem('brainbase_slack_user_id');
            sessionStorage.removeItem('brainbase_slack_workspace_id');

            this.errorDesc.textContent = '認証を拒否しました';
            this.showStep('error');
        } catch (error) {
            this.showGlobalError(error.message || '拒否に失敗しました');
        } finally {
            this.denyBtn.disabled = false;
            this.denyBtn.textContent = '拒否';
        }
    }

    formatUserCode(code) {
        // Format as XXXX-XXXX
        const clean = code.replace(/[^A-Z0-9]/g, '');
        if (clean.length === 8) {
            return `${clean.slice(0, 4)}-${clean.slice(4)}`;
        }
        return code;
    }

    showError(message) {
        this.verifyError.textContent = message;
        this.verifyError.style.display = 'block';
    }

    hideError() {
        this.verifyError.style.display = 'none';
    }

    showGlobalError(message) {
        this.errorDesc.textContent = message;
        this.showStep('error');
    }
}

// Handle Slack OAuth callback (postMessage from auth callback page)
window.addEventListener('message', (event) => {
    // Verify origin
    const allowedOrigins = ['http://localhost:31013', 'https://bb.unson.jp', 'https://graph.brainbase.work'];
    if (!allowedOrigins.includes(event.origin)) {
        return;
    }

    if (event.data.type === 'brainbase-auth') {
        const { token, access } = event.data;

        if (token && access) {
            // Extract Slack user info from access payload
            const slackUserId = access.slackUserId;
            const slackWorkspaceId = access.workspaceId;

            if (slackUserId && slackWorkspaceId) {
                sessionStorage.setItem('brainbase_slack_user_id', slackUserId);
                sessionStorage.setItem('brainbase_slack_workspace_id', slackWorkspaceId);

                // Redirect to approve step
                window.location.href = '/device?slack_callback=true';
            }
        }
    }
});

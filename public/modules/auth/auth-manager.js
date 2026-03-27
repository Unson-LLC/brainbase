const DEFAULT_STORAGE_PREFIX = 'brainbase.auth';
const DEFAULT_REMOTE_AUTH_BASE = 'https://bb.brain-base.work';

function safeJsonParse(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function decodeJwtPayload(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    try {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const padding = (4 - (normalized.length % 4 || 4)) % 4;
        const padded = normalized.padEnd(normalized.length + padding, '=');
        const json = atob(padded);
        return JSON.parse(json);
    } catch (error) {
        return null;
    }
}

export class AuthManager {
    constructor({ httpClient, store, eventBus, storagePrefix = DEFAULT_STORAGE_PREFIX, authBaseURL } = {}) {
        this.httpClient = httpClient;
        this.store = store;
        this.eventBus = eventBus;
        this.storageKeys = {
            token: `${storagePrefix}.token`,
            access: `${storagePrefix}.access`,
            refresh: `${storagePrefix}.refresh`,
            csrfSession: `${storagePrefix}.csrf`
        };
        this.token = null;
        this.access = null;
        this.refreshToken = null;
        this.csrfSessionId = null;
        this.authBaseURL = authBaseURL || '';
        this.sessionAuthenticated = false;
        this.authMode = null;
        this.sessionExpiresAt = null;
        this._messageListenerBound = false;
        this._loginPopup = null;
        this._verifying = false;
    }

    async initFromStorage() {
        if (typeof window === 'undefined' || !window.localStorage) return;

        this._ensureMessageListener();

        const token = window.localStorage.getItem(this.storageKeys.token);
        const access = safeJsonParse(window.localStorage.getItem(this.storageKeys.access));
        const refreshToken = window.localStorage.getItem(this.storageKeys.refresh);
        this.refreshToken = refreshToken || null;

        if (token && !this.isTokenExpired(token)) {
            this.token = token;
            this.access = access;
            if (this.httpClient?.setAuthToken) {
                this.httpClient.setAuthToken(token);
            }
            this._setVerifying(true);
            const ok = await this.verifyToken({ token });
            this._setVerifying(false);
            if (ok) {
                this.setSession({ token, access: this.access || access, persist: false });
                return;
            }
        }

        if (this.httpClient?.clearAuthToken) {
            this.httpClient.clearAuthToken();
        }
        this.token = null;
        this.access = access || null;

        this._setVerifying(true);
        const hasCookieSession = await this.verifyToken({ token: null });
        this._setVerifying(false);
        if (hasCookieSession) {
            this.setSession({
                token: null,
                access: this.access || access,
                refreshToken: this.refreshToken,
                persist: false,
                sessionAuthenticated: true
            });
            return;
        }

        if (refreshToken) {
            this._setVerifying(true);
            const refreshed = await this.refreshSession({ refreshToken });
            this._setVerifying(false);
            if (refreshed) {
                return;
            }
        }

        this._setVerifying(false);
        this.clearSession({ persist: false });
    }

    setSession({
        token,
        access = null,
        refreshToken = this.refreshToken,
        persist = true,
        sessionAuthenticated = null,
        authMode = this.authMode,
        sessionExpiresAt = this.sessionExpiresAt
    } = {}) {
        this.token = token || null;
        this.access = access || null;
        this.refreshToken = refreshToken || null;
        this.sessionAuthenticated = sessionAuthenticated == null
            ? Boolean(this.token || this.access)
            : Boolean(sessionAuthenticated);
        this.authMode = authMode || (this.token ? 'token' : (this.sessionAuthenticated ? 'session' : null));
        this.sessionExpiresAt = sessionExpiresAt || null;

        if (persist && typeof window !== 'undefined' && window.localStorage) {
            if (this.token) {
                window.localStorage.setItem(this.storageKeys.token, this.token);
            } else {
                window.localStorage.removeItem(this.storageKeys.token);
            }
            if (this.access) {
                window.localStorage.setItem(this.storageKeys.access, JSON.stringify(this.access));
            } else {
                window.localStorage.removeItem(this.storageKeys.access);
            }
            if (this.refreshToken) {
                window.localStorage.setItem(this.storageKeys.refresh, this.refreshToken);
            } else {
                window.localStorage.removeItem(this.storageKeys.refresh);
            }
        }

        if (this.httpClient?.setAuthToken && this.token) {
            this.httpClient.setAuthToken(this.token);
        }

        this._syncStore();
        this._emit('auth:changed');
    }

    clearSession({ persist = true } = {}) {
        this.token = null;
        this.access = null;
        this.refreshToken = null;
        this.sessionAuthenticated = false;
        this.authMode = null;
        this.sessionExpiresAt = null;

        if (persist && typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(this.storageKeys.token);
            window.localStorage.removeItem(this.storageKeys.access);
            window.localStorage.removeItem(this.storageKeys.refresh);
        }

        if (this.httpClient?.clearAuthToken) {
            this.httpClient.clearAuthToken();
        }

        this._syncStore();
        this._emit('auth:changed');
    }

    async logout() {
        if (this.httpClient?.post && this.token) {
            try {
                await this.httpClient.post('/api/auth/logout', {});
            } catch (error) {
                // Ignore logout errors and clear local session.
            }
        }
        this.clearSession();
    }

    async verifyToken({ token = this.token } = {}) {
        if (typeof window === 'undefined') return false;
        const authBase = this.resolveAuthBaseURL() || window.location.origin;
        let url;
        try {
            url = new URL('/api/auth/verify', authBase);
        } catch {
            return false;
        }

        try {
            const headers = token ? { Authorization: `Bearer ${token}` } : {};
            const response = await fetch(url.toString(), { headers });
            if (!response.ok) {
                this.sessionAuthenticated = false;
                if (!token) {
                    this.authMode = null;
                    this.sessionExpiresAt = null;
                }
                return false;
            }
            const data = await response.json().catch(() => null);
            if (data?.access) {
                this.access = data.access;
            }
            this.sessionAuthenticated = true;
            this.authMode = data?.authMode || (token ? 'token' : 'session');
            this.sessionExpiresAt = data?.sessionExpiresAt || null;
            return data?.ok === true || response.status === 200;
        } catch (error) {
            this.sessionAuthenticated = false;
            if (!token) {
                this.authMode = null;
                this.sessionExpiresAt = null;
            }
            return false;
        }
    }

    _ensureCsrfSessionId() {
        if (this.csrfSessionId) return this.csrfSessionId;
        if (typeof window === 'undefined' || !window.localStorage) {
            this.csrfSessionId = 'default';
            return this.csrfSessionId;
        }

        let stored = window.localStorage.getItem(this.storageKeys.csrfSession);
        if (!stored) {
            try {
                stored = (window.crypto && window.crypto.randomUUID)
                    ? window.crypto.randomUUID()
                    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            } catch (error) {
                stored = `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
            window.localStorage.setItem(this.storageKeys.csrfSession, stored);
        }
        this.csrfSessionId = stored;
        return stored;
    }

    async _fetchRemoteCsrfToken(authBase) {
        if (!authBase || typeof window === 'undefined') return '';
        let url;
        try {
            url = new URL('/api/csrf-token', authBase);
        } catch {
            return '';
        }
        const sessionId = this._ensureCsrfSessionId();
        try {
            const response = await fetch(url.toString(), {
                headers: { 'X-Session-Id': sessionId }
            });
            if (!response.ok) return '';
            const data = await response.json().catch(() => null);
            return data?.token || '';
        } catch (error) {
            return '';
        }
    }

    _shouldUseRemoteAuth(authBase) {
        if (typeof window === 'undefined') return Boolean(authBase);
        if (!authBase) return false;
        try {
            const authOrigin = new URL(authBase).origin;
            return authOrigin !== window.location.origin;
        } catch {
            return false;
        }
    }

    async refreshSession({ refreshToken = this.refreshToken } = {}) {
        if (typeof window === 'undefined') return false;
        const authBase = this.resolveAuthBaseURL() || window.location.origin;
        const useRemote = this._shouldUseRemoteAuth(authBase);

        if (this.httpClient?.post && !useRemote) {
            try {
                const body = refreshToken ? { refresh_token: refreshToken } : {};
                const data = await this.httpClient.post('/api/auth/refresh', body);
                if (!data?.token) return false;
                this.setSession({
                    token: data.token,
                    refreshToken: data.refresh_token || refreshToken,
                    access: data.access || this.access,
                    persist: true,
                    sessionAuthenticated: true,
                    authMode: 'token'
                });
                return true;
            } catch (error) {
                return false;
            }
        }

        let url;
        try {
            url = new URL('/api/auth/refresh', authBase);
        } catch {
            return false;
        }

        try {
            const headers = { 'content-type': 'application/json' };
            if (useRemote) {
                const sessionId = this._ensureCsrfSessionId();
                const csrfToken = await this._fetchRemoteCsrfToken(authBase);
                if (csrfToken) {
                    headers['X-CSRF-Token'] = csrfToken;
                }
                headers['X-Session-Id'] = sessionId;
            }
            const response = await fetch(url.toString(), {
                method: 'POST',
                headers,
                body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {})
            });
            if (!response.ok) return false;
            const data = await response.json().catch(() => null);
            if (!data?.token) return false;
            this.setSession({
                token: data.token,
                refreshToken: data.refresh_token || refreshToken,
                access: data.access || this.access,
                persist: true,
                sessionAuthenticated: true,
                authMode: 'token'
            });
            return true;
        } catch (error) {
            return false;
        }
    }

    resolveAuthBaseURL() {
        if (typeof window === 'undefined') {
            return this.authBaseURL || '';
        }

        if (Object.prototype.hasOwnProperty.call(window, '__BRAINBASE_AUTH_BASE_URL')) {
            const explicit = window.__BRAINBASE_AUTH_BASE_URL;
            if (typeof explicit === 'string') {
                return explicit.replace(/\/+$/, '');
            }
        }

        if (this.authBaseURL) {
            return this.authBaseURL.replace(/\/+$/, '');
        }

        if (this.httpClient?.baseURL) {
            return String(this.httpClient.baseURL).replace(/\/+$/, '');
        }

        return window.location.origin;
    }

    /**
     * Auth base URL used only for Slack login start (redirect via remote).
     * verify/refresh use the local origin to avoid cross-origin fetch issues.
     */
    resolveLoginBaseURL() {
        const host = typeof window !== 'undefined' ? window.location.hostname : '';
        if (host === 'localhost' || host === '127.0.0.1') {
            return DEFAULT_REMOTE_AUTH_BASE;
        }
        return this.resolveAuthBaseURL();
    }

    getAllowedOrigins() {
        const origins = new Set();
        if (typeof window !== 'undefined') {
            origins.add(window.location.origin);
        }

        const authBase = this.resolveAuthBaseURL();
        if (authBase) {
            try {
                origins.add(new URL(authBase).origin);
            } catch {
                // ignore invalid url
            }
        }
        const loginBase = this.resolveLoginBaseURL();
        if (loginBase) {
            try {
                origins.add(new URL(loginBase).origin);
            } catch {
                // ignore invalid url
            }
        }
        return origins;
    }

    _ensureMessageListener() {
        if (this._messageListenerBound || typeof window === 'undefined') return;

        window.addEventListener('message', async (event) => {
            if (!event?.data || event.data.type !== 'brainbase-auth') return;
            const allowedOrigins = this.getAllowedOrigins();
            if (!allowedOrigins.has(event.origin)) {
                return;
            }

            const { token, access, refresh_token: refreshTokenRaw, refreshToken: refreshTokenCamel } = event.data;
            const refreshToken = refreshTokenRaw || refreshTokenCamel || null;
            if (!token) return;
            this.token = token;
            this.access = access || null;
            this.refreshToken = refreshToken || this.refreshToken || null;
            if (this.refreshToken && window.localStorage) {
                window.localStorage.setItem(this.storageKeys.refresh, this.refreshToken);
            }
            if (this.httpClient?.setAuthToken) {
                this.httpClient.setAuthToken(token);
            }

            this._setVerifying(true);
            const ok = await this.verifyToken({ token });
            this._setVerifying(false);
            if (ok) {
                this.setSession({
                    token,
                    access: this.access || access,
                    refreshToken: this.refreshToken,
                    persist: true,
                    sessionAuthenticated: true,
                    authMode: this.authMode || 'token',
                    sessionExpiresAt: this.sessionExpiresAt
                });
            } else if (this.refreshToken) {
                const refreshed = await this.refreshSession({ refreshToken: this.refreshToken });
                if (!refreshed) {
                    this.setSession({ token: null, access: null, refreshToken: this.refreshToken, persist: true });
                    return;
                }
            } else {
                this.clearSession({ persist: true });
                return;
            }

            if (this._loginPopup && !this._loginPopup.closed) {
                try {
                    this._loginPopup.close();
                } catch (error) {
                    // ignore popup close errors
                }
            }
        }, { capture: true });

        this._messageListenerBound = true;
    }

    startSlackLogin({ redirectPath = '/' } = {}) {
        if (typeof window === 'undefined') return;
        this._ensureMessageListener();
        const authBase = this.resolveLoginBaseURL() || window.location.origin;
        const url = new URL('/api/auth/slack/start', authBase);
        url.searchParams.set('origin', window.location.origin);
        if (redirectPath) {
            url.searchParams.set('redirect', redirectPath);
        }

        const popup = window.open(
            url.toString(),
            'brainbase-auth',
            'width=480,height=720,menubar=no,toolbar=no,location=no,status=no'
        );
        if (popup) {
            this._loginPopup = popup;
            popup.focus();
            return;
        }

        window.location.assign(url.toString());
    }

    getSummary() {
        const payload = decodeJwtPayload(this.token);
        const exp = payload?.exp || null;
        const iat = payload?.iat || null;
        return {
            status: this.getStatus(),
            token: this.token,
            access: this.access,
            authMode: this.authMode,
            exp,
            iat,
            expiresAt: this.sessionExpiresAt || (exp ? new Date(exp * 1000) : null)
        };
    }

    getToken() {
        return this.token;
    }

    getStatus() {
        if (this._verifying) return 'checking';
        if (this.sessionAuthenticated && (!this.token || !this.isTokenExpired(this.token))) {
            return 'authenticated';
        }
        if (!this.token) return 'anonymous';
        if (this.isTokenExpired(this.token)) return 'expired';
        return 'authenticated';
    }

    isTokenExpired(token = this.token) {
        const payload = decodeJwtPayload(token);
        if (!payload?.exp) return false;
        return payload.exp * 1000 <= Date.now();
    }

    _syncStore() {
        if (!this.store?.setState) return;
        const summary = this.getSummary();
        this.store.setState({ auth: summary });
    }

    _emit(eventName) {
        if (!this.eventBus?.emit) return;
        this.eventBus.emit(eventName, { summary: this.getSummary() });
    }

    _setVerifying(value) {
        this._verifying = Boolean(value);
        this._syncStore();
        this._emit('auth:changed');
    }
}

import { AuthManager } from './auth-manager.js';

/**
 * Coordinates auth bootstrap for the application shell.
 */
export class AuthInitController {
    constructor({ httpClient, store, eventBus, showError } = {}) {
        this.httpClient = httpClient;
        this.store = store;
        this.eventBus = eventBus;
        this.showError = showError;
        this.authManager = null;
    }

    async initialize() {
        this.authManager = this._createAuthManager();
        this._registerUnauthorizedHandler();
        await this._restoreAuthSession();
        return this.authManager;
    }

    _createAuthManager() {
        return new AuthManager({
            httpClient: this.httpClient,
            store: this.store,
            eventBus: this.eventBus
        });
    }

    _registerUnauthorizedHandler() {
        if (!this.httpClient?.setUnauthorizedHandler) return;

        this.httpClient.setUnauthorizedHandler(() => {
            this.authManager?.clearSession();
            this.showError?.('認証が必要です。Settings > 認証からログインしてください。');
        });
    }

    async _restoreAuthSession() {
        await this.authManager?.initFromStorage();
    }
}

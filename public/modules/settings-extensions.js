// @ts-check

/**
 * Optional settings extension hooks.
 *
 * The main app treats this as an extension point. Keep it lightweight so a
 * missing optional settings feature cannot block the whole UI bootstrap.
 */
export class SettingsExtensions {
    constructor({
        store = null,
        httpClient = null,
        compressImage = null,
        showSuccess = null,
        showError = null,
        showInfo = null
    } = {}) {
        this.store = store;
        this.httpClient = httpClient;
        this.compressImage = compressImage;
        this.showSuccess = showSuccess;
        this.showError = showError;
        this.showInfo = showInfo;
    }

    setupSettingsExtensions() {
        // Extension slots are optional. Concrete settings panels can register
        // here without making app startup depend on them.
    }
}

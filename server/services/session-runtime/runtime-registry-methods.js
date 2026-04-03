export const runtimeRegistryMethods = {
    isActive(sessionId) {
        return this.activeSessions.has(sessionId);
    },

    getActiveSessions() {
        return this.activeSessions;
    },

    markReady() {
        if (this._isReady) {
            return;
        }
        this._isReady = true;
        if (this._readyResolver) {
            this._readyResolver(true);
        }
    },

    isReady() {
        return this._isReady;
    },

    async waitUntilReady(timeoutMs = 10000) {
        if (this._isReady) {
            return true;
        }

        return await Promise.race([
            this._readyPromise.then(() => true),
            new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
        ]);
    }
};

export class TerminalInteractionService {
    constructor({
        httpClient,
        getTerminalTransportClient = null,
        getFallbackTerminalAccess = null,
        shouldUseXtermTransport = null
    }) {
        this.httpClient = httpClient;
        this.getTerminalTransportClient = typeof getTerminalTransportClient === 'function'
            ? getTerminalTransportClient
            : () => null;
        this.getFallbackTerminalAccess = typeof getFallbackTerminalAccess === 'function'
            ? getFallbackTerminalAccess
            : () => null;
        this.shouldUseXtermTransport = typeof shouldUseXtermTransport === 'function'
            ? shouldUseXtermTransport
            : () => false;
    }

    getAvailability(sessionId) {
        if (!sessionId) {
            return { canSend: false, reason: 'no-session' };
        }

        if (this._isBlocked(sessionId)) {
            return { canSend: false, reason: 'blocked' };
        }

        return { canSend: true, reason: 'ready' };
    }

    async sendInput(sessionId, payload) {
        if (!payload) return;
        this._assertSendable(sessionId);

        if (this._canSendViaXterm(sessionId)) {
            const transport = this.getTerminalTransportClient();
            await transport.sendText(payload);
            await transport.sendKey('Enter');
            return;
        }

        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: payload,
            type: 'text'
        });
        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: 'Enter',
            type: 'key'
        });
        await this._syncActiveXtermSnapshot(sessionId);
    }

    async sendKey(sessionId, key) {
        if (!key) return;
        this._assertSendable(sessionId);

        if (this._canSendViaXterm(sessionId)) {
            const transport = this.getTerminalTransportClient();
            await transport.sendKey(key);
            return;
        }

        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: key,
            type: 'key'
        });
        await this._syncActiveXtermSnapshot(sessionId);
    }

    async interruptSession(sessionId) {
        this._assertSendable(sessionId);

        if (this._canSendViaXterm(sessionId)) {
            const transport = this.getTerminalTransportClient();
            await transport.interrupt();
            return;
        }

        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: 'C-c',
            type: 'key'
        });
        await this._syncActiveXtermSnapshot(sessionId);
    }

    async fetchTerminalContent(sessionId, lines = 500) {
        const res = await fetch(`/api/sessions/${sessionId}/content?lines=${lines}`);
        if (!res.ok) throw new Error('Failed to fetch content');
        const { content } = await res.json();
        return content;
    }

    _assertSendable(sessionId) {
        const availability = this.getAvailability(sessionId);
        if (availability.canSend) return;

        const error = new Error(availability.reason === 'blocked'
            ? 'Terminal is blocked by another viewer'
            : 'Terminal input is unavailable');
        error.code = availability.reason === 'blocked' ? 'TERMINAL_BLOCKED' : 'TERMINAL_INPUT_UNAVAILABLE';
        throw error;
    }

    _canSendViaXterm(sessionId) {
        if (!sessionId || !this.shouldUseXtermTransport()) return false;
        const transport = this.getTerminalTransportClient();
        return Boolean(transport?.canSendInput?.(sessionId));
    }

    _isBlocked(sessionId) {
        const transport = this.getTerminalTransportClient();
        if (transport?.isBlockedForSession?.(sessionId)) {
            return true;
        }
        const fallbackAccess = this.getFallbackTerminalAccess(sessionId);
        return fallbackAccess?.state === 'blocked';
    }

    async _syncActiveXtermSnapshot(sessionId) {
        if (!sessionId || !this.shouldUseXtermTransport()) return;
        const transport = this.getTerminalTransportClient();
        if (!transport?.isActiveForSession?.(sessionId) || transport?.isBlockedForSession?.(sessionId)) {
            return;
        }
        await transport.refreshSnapshot?.();
    }
}

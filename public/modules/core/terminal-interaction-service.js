// @ts-check
export class TerminalInteractionService {
    constructor({
        httpClient,
        getTerminalTransportClient = null,
        getFallbackTerminalAccess = null,
        shouldUseXtermTransport = null,
        getSessionEngine = null,
        isTerminalReadOnly = null
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
        this.getSessionEngine = typeof getSessionEngine === 'function'
            ? getSessionEngine
            : () => null;
        this.isTerminalReadOnly = typeof isTerminalReadOnly === 'function'
            ? isTerminalReadOnly
            : () => false;
    }

    getAvailability(sessionId) {
        if (!sessionId) {
            return { canSend: false, reason: 'no-session' };
        }

        if (this._isBlocked(sessionId)) {
            return { canSend: false, reason: 'blocked' };
        }

        if (this.isTerminalReadOnly(sessionId)) {
            return { canSend: false, reason: 'read-only' };
        }

        return { canSend: true, reason: 'ready' };
    }

    async sendInput(sessionId, payload) {
        if (!payload) return;
        const normalizedPayload = this._normalizeProjectSlashCommandForSession(sessionId, payload);
        if (this._looksLikeSlashCommand(normalizedPayload)) {
            await this.sendText(sessionId, normalizedPayload);
            await this.sendKey(sessionId, 'Enter');
            return;
        }
        await this.sendText(sessionId, `${normalizedPayload}\n`);
    }

    _looksLikeSlashCommand(payload) {
        if (typeof payload !== 'string') return false;
        const trimmed = payload.trim();
        if (trimmed !== payload) return false;
        return /^\/[A-Za-z][A-Za-z0-9_-]*(?:\s+[^\r\n]*)?$/.test(trimmed);
    }

    _normalizeProjectSlashCommandForSession(sessionId, payload) {
        if (this.getSessionEngine(sessionId) !== 'codex') return payload;
        const command = this._parseProjectSlashCommand(payload);
        if (!command) return payload;
        const argsText = command.args ? ` Arguments: ${command.args}` : '';
        return `Run the project command /${command.name} by following .claude/commands/${command.name}.md.${argsText}`;
    }

    _parseProjectSlashCommand(payload) {
        if (typeof payload !== 'string') return null;
        const match = payload.match(/^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.+))?$/);
        if (!match) return null;
        const commandName = this._normalizeProjectCommandName(match[1]);
        if (!commandName) return null;
        return {
            name: commandName,
            args: match[2]?.trim() || ''
        };
    }

    _normalizeProjectCommandName(name) {
        const aliases = {
            ohayo: 'ohayo',
            ohayou: 'ohayo',
            oyaho: 'ohayo',
            oyasumi: 'oyasumi',
            retro: 'retro'
        };
        return aliases[String(name || '').toLowerCase()] || null;
    }

    async sendText(sessionId, text) {
        if (!text) return;
        this._assertSendable(sessionId);

        if (this._canSendViaXterm(sessionId)) {
            const transport = this.getTerminalTransportClient();
            await transport.sendText(text);
            return;
        }

        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: text,
            type: 'text'
        });
        await this._syncActiveXtermSnapshot(sessionId);
    }

    async sendPasteText(sessionId, text) {
        if (!text) return;
        this._assertSendable(sessionId);

        if (this._canSendViaXterm(sessionId)) {
            const transport = this.getTerminalTransportClient();
            if (typeof transport.sendPasteText === 'function') {
                await transport.sendPasteText(text);
                return;
            }
            await transport.sendText(text);
            return;
        }

        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: text,
            type: 'text'
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

        const messages = {
            blocked: 'Terminal is blocked by another viewer',
            'read-only': 'Terminal display is read-only'
        };
        const error = /** @type {Error & { code?: string }} */ (new Error(messages[availability.reason] || 'Terminal input is unavailable'));
        error.code = availability.reason === 'blocked'
            ? 'TERMINAL_BLOCKED'
            : availability.reason === 'read-only'
                ? 'TERMINAL_READ_ONLY'
                : 'TERMINAL_INPUT_UNAVAILABLE';
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

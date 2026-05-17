import { CliState, detectCliStateWithColors } from './cli-pattern-detector.js';

const PROBE_COOLDOWN_MS = 2_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

function nowIso() {
    return new Date().toISOString();
}

export class TerminalInputProbeService {
    constructor({
        ownershipService,
        runtimeQuery,
        terminalIo,
        snapshotService,
        runtimeRegistry,
        captureCache = null,
        probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS
    } = {}) {
        this.ownershipService = ownershipService;
        this.runtimeQuery = runtimeQuery;
        this.terminalIo = terminalIo;
        this.snapshotService = snapshotService;
        this.runtimeRegistry = runtimeRegistry;
        this.captureCache = captureCache;
        this.probeTimeoutMs = probeTimeoutMs;
        this.lastProbeAt = new Map();
    }

    async probe({ sessionId, viewerId, viewerLabel = null } = {}) {
        if (!sessionId) return this._fail(sessionId, 'SESSION_ID_REQUIRED', 'sessionId is required');
        if (!viewerId) return this._fail(sessionId, 'VIEWER_ID_REQUIRED', 'viewerId is required');

        // getTerminalAccessState の代わりに ensureTerminalOwnership を使う。
        // TTL 切れ（10分間操作なし）で ownership が expired になると state='available' になり
        // 正当な viewer が probe を呼んでも全拒否される。expired なら自動再取得する。
        const ownershipResult = this.ownershipService?.ensureTerminalOwnership
            ? this.ownershipService.ensureTerminalOwnership(sessionId, viewerId, viewerLabel)
            : this._getLegacyTerminalOwnership(sessionId, viewerId);
        const terminalAccess = ownershipResult?.terminalAccess;
        if (!ownershipResult?.allowed) {
            return this._fail(sessionId, 'SESSION_OWNED_BY_OTHER_VIEWER', 'Session is owned by another viewer', { terminalAccess });
        }

        const lastProbeAt = this.lastProbeAt.get(sessionId) || 0;
        if (Date.now() - lastProbeAt < PROBE_COOLDOWN_MS) {
            const registryEntry = this.runtimeRegistry?.getSession?.(sessionId);
            if (registryEntry?.observed?.inputProbe?.status === 'passed') {
                return { success: true, inputReady: true, probe: registryEntry.observed.inputProbe, terminalAccess };
            }
        }
        this.lastProbeAt.set(sessionId, Date.now());

        const tmuxRunning = await this.runtimeQuery?.isTmuxSessionRunning?.(sessionId);
        if (!tmuxRunning) {
            return this._fail(sessionId, 'TMUX_NOT_RUNNING', 'tmux session not found', { terminalAccess });
        }

        let snapshot;
        try {
            snapshot = await this._withTimeout(
                this._getSnapshot(sessionId),
                this.probeTimeoutMs,
                'PROBE_TIMEOUT'
            );
        } catch (error) {
            const code = error?.code === 'PROBE_TIMEOUT' ? 'PROBE_TIMEOUT' : 'SNAPSHOT_UNAVAILABLE';
            return this._fail(sessionId, code, error?.message || 'terminal snapshot is not available', { terminalAccess });
        }
        if (snapshot.copyMode) {
            return this._fail(sessionId, 'TERMINAL_COPY_MODE', 'terminal is in copy mode', { terminalAccess });
        }

        const cliResult = detectCliStateWithColors(snapshot.text, snapshot.colorText);
        this.runtimeRegistry?.setCliState?.(sessionId, cliResult);
        if (![CliState.READY, CliState.IDLE, CliState.WAITING].includes(cliResult.state)) {
            return this._fail(sessionId, 'CLI_NOT_IDLE', 'CLI is not ready for input', { terminalAccess, cliState: cliResult.state });
        }
        const probe = {
            status: 'passed',
            lastPassedAt: nowIso(),
            lastFailedAt: null,
            reason: null,
            mode: cliResult.state === CliState.WAITING ? 'waiting_prompt' : 'snapshot_ready',
            cliReason: cliResult.reason || null
        };
        this.runtimeRegistry?.setInputProbe?.(sessionId, probe);
        this.ownershipService?.touchTerminalOwnership?.(sessionId, viewerId, viewerLabel);
        return {
            success: true,
            inputReady: true,
            probe,
            terminalAccess,
            cliState: cliResult.state
        };
    }

    async _getSnapshot(sessionId) {
        if (this.captureCache?.getSnapshot) {
            return await this.captureCache.getSnapshot(sessionId, {
                lines: 80,
                includeColors: true,
                includeCopyMode: true
            });
        }
        const [text, colorText, copyMode] = await Promise.all([
            this.snapshotService.getContent(sessionId, 80),
            this.snapshotService.getContentWithColors(sessionId, 80).catch(() => null),
            this.snapshotService.getPaneMode(sessionId).catch(() => false)
        ]);
        return { text, colorText, copyMode };
    }

    _withTimeout(promise, timeoutMs, code) {
        const safeTimeoutMs = Math.max(100, Number(timeoutMs) || DEFAULT_PROBE_TIMEOUT_MS);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const error = new Error(`terminal input probe timed out after ${safeTimeoutMs}ms`);
                error.code = code;
                reject(error);
            }, safeTimeoutMs);
            Promise.resolve(promise)
                .then((value) => {
                    clearTimeout(timer);
                    resolve(value);
                })
                .catch((error) => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    _getLegacyTerminalOwnership(sessionId, viewerId) {
        const terminalAccess = this.ownershipService?.getTerminalAccessState?.(sessionId, viewerId);
        return {
            allowed: terminalAccess?.state === 'owner' || terminalAccess?.state === 'available',
            terminalAccess
        };
    }

    _fail(sessionId, code, message, extra = {}) {
        const probe = {
            status: 'failed',
            lastPassedAt: null,
            lastFailedAt: nowIso(),
            reason: code
        };
        if (sessionId) {
            this.runtimeRegistry?.setInputProbe?.(sessionId, probe);
        }
        return {
            success: false,
            inputReady: false,
            code,
            message,
            probe,
            ...extra
        };
    }
}

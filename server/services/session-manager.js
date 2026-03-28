/**
 * SessionManager
 * セッション管理とttyd/tmuxプロセス管理を担当
 */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../utils/logger.js';
import { TerminalOutputParser } from './terminal-output-parser.js';
import { gracefulCleanup } from '../lib/graceful-cleanup.js';
import { SessionHealthMonitor } from './session-health-monitor.js';

const INPUT_TEMPFILE_THRESHOLD_BYTES = 16 * 1024;
const TASK_BRIEF_MAX_LENGTH = 56;
const TASK_BRIEF_MIN_LENGTH = 8;
const PROMPT_BUFFER_MAX_LENGTH = 4000;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const NATURAL_LANGUAGE_HINT_PATTERN = /\b(please|fix|make|update|improve|investigate|check|review|implement|show|change|add|remove|explain|summarize|help|need|want|should|could)\b/i;
const SHELL_COMMAND_PREFIXES = new Set([
    'git', 'jj', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'ls', 'cd', 'cat', 'sed', 'rg',
    'find', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'bash', 'zsh', 'sh', 'python', 'python3', 'uv',
    'docker', 'tmux', 'claude', 'codex', 'curl'
]);

function normalizeTaskBriefCandidate(rawValue) {
    if (typeof rawValue !== 'string') return '';

    return rawValue
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•>\d.)\s]+/, '').trim())
        .filter(Boolean)
        .find((line) => {
            if (!line) return false;
            if (/[\x00-\x08\x0b-\x1f\x7f]/.test(line)) return false;
            if (/^\/[\w:-]+$/.test(line)) return false;
            if (/^https?:\/\//.test(line)) return false;
            if (/^(~|\.{1,2}|\/)?[\w./-]+$/.test(line)) return false;
            return true;
        }) || '';
}

function looksLikeShellCommand(candidate) {
    if (!candidate || CJK_PATTERN.test(candidate)) return false;
    if (/[`$|&;<>]/.test(candidate)) return true;

    const tokens = candidate.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    const firstToken = tokens[0].toLowerCase();
    if (SHELL_COMMAND_PREFIXES.has(firstToken)) return true;

    const optionTokenCount = tokens.filter((token) => token.startsWith('-')).length;
    if (optionTokenCount >= 2) return true;

    return false;
}

function deriveTaskBriefFromPrompt(prompt) {
    const candidate = normalizeTaskBriefCandidate(prompt);
    if (!candidate || candidate.length < TASK_BRIEF_MIN_LENGTH) return null;

    const sentence = candidate.split(/(?<=[。.!?！？])\s+/)[0]?.trim() || candidate;
    const compact = sentence.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < TASK_BRIEF_MIN_LENGTH) return null;
    if (!CJK_PATTERN.test(compact) && !NATURAL_LANGUAGE_HINT_PATTERN.test(compact) && looksLikeShellCommand(compact)) {
        return null;
    }

    return compact.length > TASK_BRIEF_MAX_LENGTH
        ? `${compact.slice(0, TASK_BRIEF_MAX_LENGTH - 1)}…`
        : compact;
}

function trimPromptBuffer(value) {
    if (typeof value !== 'string') return '';
    return value.length > PROMPT_BUFFER_MAX_LENGTH
        ? value.slice(value.length - PROMPT_BUFFER_MAX_LENGTH)
        : value;
}

export class SessionManager {
    /**
     * @param {Object} options - 設定オプション
     * @param {string} options.serverDir - server.jsのディレクトリ（__dirname）
     * @param {Function} options.execPromise - util.promisify(exec)
     * @param {Object} options.stateStore - StateStoreインスタンス
     * @param {Object} options.worktreeService - WorktreeServiceインスタンス（Phase 2）
     * @param {number|string} [options.uiPort] - UIサーバーのポート
     */
    constructor({ serverDir, execPromise, stateStore, worktreeService, uiPort }) {
        this.serverDir = serverDir;
        this.execPromise = execPromise;
        this.stateStore = stateStore;
        this.worktreeService = worktreeService;  // Phase 2: Worktree削除用
        this.uiPort = uiPort;

        // セッション状態
        this.activeSessions = new Map(); // sessionId -> { port, process }
        this.hookStatus = new Map(); // sessionId -> { status, timestamp, lastWorkingAt, lastDoneAt, lastActivityAt, lastEventType, activeTurnIds, liveActivity }
        this.startLocks = new Map(); // sessionId -> Promise (並行起動防止ロック)
        this.terminalOwners = new Map(); // sessionId -> { viewerId, viewerLabel, claimedAt, lastSeenAt }
        this.promptBuffers = new Map(); // sessionId -> string
        // ポート範囲を40000番台に設定（UIの31013/31014帯との競合回避）
        this.nextPort = 40000;

        // 起動準備完了フラグ
        this._isReady = false;
        this._readyResolver = null;
        this._readyPromise = new Promise((resolve) => {
            this._readyResolver = resolve;
        });

        // ターミナル出力パーサー
        this.outputParser = new TerminalOutputParser();

        // 許可されたキー
        this.ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'C-u', 'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'S-Tab', 'BTab'];
        this.TERMINAL_OWNER_TTL_MS = 10 * 60 * 1000;
    }

    _appendPromptBuffer(sessionId, chunk) {
        if (!sessionId || typeof chunk !== 'string' || !chunk) return;
        const previous = this.promptBuffers.get(sessionId) || '';
        this.promptBuffers.set(sessionId, trimPromptBuffer(`${previous}${chunk}`));
    }

    _backspacePromptBuffer(sessionId) {
        const previous = this.promptBuffers.get(sessionId) || '';
        if (!previous) return;
        const next = Array.from(previous).slice(0, -1).join('');
        if (next) {
            this.promptBuffers.set(sessionId, next);
            return;
        }
        this.promptBuffers.delete(sessionId);
    }

    _clearPromptBuffer(sessionId) {
        this.promptBuffers.delete(sessionId);
    }

    async _persistSessionLiveSummary(sessionId, { taskBrief = null, assistantSnippet = null } = {}, timestamp = Date.now()) {
        if (!sessionId || (!taskBrief && !assistantSnippet)) return false;
        const currentState = this.stateStore.get();
        const updatedAtIso = new Date(timestamp).toISOString();
        const hookStatusData = this._normalizeHookData(this.hookStatus.get(sessionId));
        const hookTaskBrief = hookStatusData?.liveActivity?.taskBrief || null;
        const hookAssistantSnippet = hookStatusData?.liveActivity?.assistantSnippet || null;
        const nextHookStatus = hookStatusData
            ? {
                ...hookStatusData,
                liveActivity: {
                    ...(hookStatusData.liveActivity || {}),
                    ...(taskBrief ? { taskBrief } : {}),
                    ...(assistantSnippet ? {
                        assistantSnippet,
                        assistantSnippetUpdatedAt: timestamp
                    } : {}),
                    updatedAt: Math.max(hookStatusData.liveActivity?.updatedAt || 0, timestamp)
                }
            }
            : null;
        let changed = false;
        const updatedSessions = (currentState.sessions || []).map((session) => {
            if (session.id !== sessionId) return session;

            const needsTaskBriefUpdate = Boolean(taskBrief) && session.taskBrief !== taskBrief;
            const needsAssistantSnippetUpdate = Boolean(assistantSnippet) && session.lastAssistantSnippet !== assistantSnippet;
            const needsHookStatusUpdate = Boolean(nextHookStatus) && (
                (Boolean(taskBrief) && hookTaskBrief !== taskBrief)
                || (Boolean(assistantSnippet) && hookAssistantSnippet !== assistantSnippet)
            );
            if (!needsTaskBriefUpdate && !needsAssistantSnippetUpdate && !needsHookStatusUpdate) return session;

            changed = true;
            return {
                ...session,
                ...(needsHookStatusUpdate ? { hookStatus: nextHookStatus } : {}),
                ...(needsTaskBriefUpdate ? {
                    taskBrief,
                    taskBriefUpdatedAt: updatedAtIso
                } : {}),
                ...(needsAssistantSnippetUpdate ? {
                    lastAssistantSnippet: assistantSnippet,
                    lastAssistantSnippetAt: updatedAtIso
                } : {}),
                updatedAt: updatedAtIso
            };
        });

        if (nextHookStatus) {
            this.hookStatus.set(sessionId, nextHookStatus);
        }

        if (changed) {
            await this.stateStore.update({ ...currentState, sessions: updatedSessions });
        }

        return changed;
    }

    async _persistSessionTaskBrief(sessionId, taskBrief, timestamp = Date.now()) {
        if (!sessionId || !taskBrief) return false;
        return this._persistSessionLiveSummary(sessionId, { taskBrief }, timestamp);
    }

    async _persistAssistantSnippet(sessionId, assistantSnippet, timestamp = Date.now()) {
        if (!sessionId || !assistantSnippet) return false;
        return this._persistSessionLiveSummary(sessionId, { assistantSnippet }, timestamp);
    }

    async _finalizePromptBuffer(sessionId, timestamp = Date.now()) {
        const prompt = (this.promptBuffers.get(sessionId) || '').trim();
        this.promptBuffers.delete(sessionId);
        if (!prompt) return null;

        const taskBrief = deriveTaskBriefFromPrompt(prompt);
        if (!taskBrief) return null;

        await this._persistSessionTaskBrief(sessionId, taskBrief, timestamp);
        return taskBrief;
    }

    async _capturePromptInput(sessionId, input, type) {
        const timestamp = Date.now();
        if (type === 'key') {
            if (input === 'Enter' || input === 'M-Enter') {
                await this._finalizePromptBuffer(sessionId, timestamp);
                return;
            }

            if (input === 'C-c' || input === 'C-d' || input === 'Escape') {
                this._clearPromptBuffer(sessionId);
            }
            return;
        }

        if (typeof input !== 'string' || !input) return;
        if (input === '\x7f') {
            this._backspacePromptBuffer(sessionId);
            return;
        }

        const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        if (/[\x00-\x08\x0b-\x1f\x7f]/.test(normalized.replace(/\n/g, ''))) {
            if (/[\x03\x1b]/.test(normalized)) {
                this._clearPromptBuffer(sessionId);
            }
            return;
        }

        if (!normalized.includes('\n')) {
            this._appendPromptBuffer(sessionId, normalized);
            return;
        }

        const parts = normalized.split('\n');
        for (let index = 0; index < parts.length; index += 1) {
            if (parts[index]) {
                this._appendPromptBuffer(sessionId, parts[index]);
            }
            if (index < parts.length - 1) {
                await this._finalizePromptBuffer(sessionId, timestamp);
            }
        }
    }

    _normalizeViewerId(viewerId) {
        if (typeof viewerId !== 'string') return null;
        const normalized = viewerId.trim();
        return normalized || null;
    }

    _normalizeViewerLabel(viewerLabel) {
        if (typeof viewerLabel !== 'string') return null;
        const normalized = viewerLabel.trim();
        return normalized || null;
    }

    _getTerminalOwnerEntry(sessionId) {
        const owner = this.terminalOwners.get(sessionId);
        if (!owner) return null;

        if (Date.now() - owner.lastSeenAt > this.TERMINAL_OWNER_TTL_MS) {
            this.terminalOwners.delete(sessionId);
            return null;
        }

        return owner;
    }

    _buildTerminalAccessState(owner, viewerId) {
        if (!owner) {
            return {
                state: 'available',
                ownerViewerLabel: null,
                ownerLastSeenAt: null,
                canTakeover: false
            };
        }

        const isOwner = owner.viewerId === viewerId;
        return {
            state: isOwner ? 'owner' : 'blocked',
            ownerViewerLabel: owner.viewerLabel || null,
            ownerLastSeenAt: new Date(owner.lastSeenAt).toISOString(),
            canTakeover: !isOwner
        };
    }

    getTerminalAccessState(sessionId, viewerId) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        const owner = this._getTerminalOwnerEntry(sessionId);
        return this._buildTerminalAccessState(owner, normalizedViewerId);
    }

    claimTerminalOwnership(sessionId, viewerId, viewerLabel) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) return null;

        const now = Date.now();
        const owner = {
            viewerId: normalizedViewerId,
            viewerLabel: this._normalizeViewerLabel(viewerLabel),
            claimedAt: now,
            lastSeenAt: now
        };
        this.terminalOwners.set(sessionId, owner);
        return owner;
    }

    touchTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) return null;

        const owner = this._getTerminalOwnerEntry(sessionId);
        if (!owner || owner.viewerId !== normalizedViewerId) {
            return null;
        }

        owner.lastSeenAt = Date.now();
        if (viewerLabel) {
            owner.viewerLabel = this._normalizeViewerLabel(viewerLabel);
        }
        this.terminalOwners.set(sessionId, owner);
        return owner;
    }

    ensureTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        if (!sessionId || !normalizedViewerId) {
            return { allowed: false, terminalAccess: this._buildTerminalAccessState(this._getTerminalOwnerEntry(sessionId), normalizedViewerId) };
        }

        const currentOwner = this._getTerminalOwnerEntry(sessionId);
        if (!currentOwner) {
            const owner = this.claimTerminalOwnership(sessionId, normalizedViewerId, viewerLabel);
            return { allowed: true, owner, terminalAccess: this._buildTerminalAccessState(owner, normalizedViewerId) };
        }

        if (currentOwner.viewerId === normalizedViewerId) {
            const owner = this.touchTerminalOwnership(sessionId, normalizedViewerId, viewerLabel) || currentOwner;
            return { allowed: true, owner, terminalAccess: this._buildTerminalAccessState(owner, normalizedViewerId) };
        }

        // Auto-takeover: last accessor wins (no concurrent viewing expected)
        const owner = this.claimTerminalOwnership(sessionId, normalizedViewerId, viewerLabel);
        return { allowed: true, owner, terminalAccess: this._buildTerminalAccessState(owner, normalizedViewerId) };
    }

    forceTerminalOwnership(sessionId, viewerId, viewerLabel = null) {
        const owner = this.claimTerminalOwnership(sessionId, viewerId, viewerLabel);
        return {
            allowed: Boolean(owner),
            owner,
            terminalAccess: this._buildTerminalAccessState(owner, this._normalizeViewerId(viewerId))
        };
    }

    releaseTerminalOwnership(sessionId, viewerId, { force = false } = {}) {
        const normalizedViewerId = this._normalizeViewerId(viewerId);
        const owner = this._getTerminalOwnerEntry(sessionId);
        if (!owner) return false;
        if (!force && owner.viewerId !== normalizedViewerId) return false;
        this.terminalOwners.delete(sessionId);
        return true;
    }

    /**
     * 永続化された状態からhookStatusを復元
     */
    async restoreHookStatus() {
        const state = this.stateStore.get();
        if (state.sessions) {
            state.sessions.forEach(session => {
                if (session.hookStatus) {
                    this.hookStatus.set(session.id, session.hookStatus);
                }
            });
        }
    }

    _getStoredWorkspacePath(session) {
        return session?.worktree?.path || session?.path || null;
    }

    _getWorkspaceName(session) {
        if (!session?.id) return null;

        const repoPath = session?.worktree?.repo || null;
        if (repoPath) {
            return `${session.id}-${path.basename(repoPath)}`;
        }

        const storedPath = this._getStoredWorkspacePath(session);
        if (!storedPath) return null;

        const basename = path.basename(storedPath.replace(/\/+$/, ''));
        return basename.startsWith(`${session.id}-`) ? basename : null;
    }

    _getCandidateWorkspacePaths(session) {
        const candidates = [];
        const workspaceName = this._getWorkspaceName(session);
        const repoPath = session?.worktree?.repo || null;

        const pushCandidate = (candidate) => {
            if (!candidate || typeof candidate !== 'string') return;
            if (!candidates.includes(candidate)) {
                candidates.push(candidate);
            }
        };

        pushCandidate(session?.worktree?.path);
        pushCandidate(session?.path);

        if (workspaceName) {
            pushCandidate(path.join(this.worktreeService?.worktreesDir || '', workspaceName));

            const configuredRoot = process.env.BRAINBASE_WORKTREES_DIR;
            if (configuredRoot) {
                pushCandidate(path.join(configuredRoot, workspaceName));
            }

            if (repoPath) {
                pushCandidate(path.join(repoPath, '.worktrees', workspaceName));
            }

            try {
                for (const entry of fs.readdirSync('/Volumes', { withFileTypes: true })) {
                    if (!entry.isDirectory()) continue;
                    pushCandidate(path.join('/Volumes', entry.name, 'brainbase-worktrees', workspaceName));
                }
            } catch {
                // Ignore missing /Volumes or permission issues
            }
        }

        return candidates;
    }

    async _getTmuxCurrentPath(sessionId) {
        if (!sessionId) return null;
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -t "${sessionId}" -F "#{pane_current_path}" 2>/dev/null || true`
            );
            const currentPath = stdout
                .split('\n')
                .map(line => line.trim())
                .find(Boolean);

            return currentPath && fs.existsSync(currentPath) ? currentPath : null;
        } catch {
            return null;
        }
    }

    async _persistResolvedWorkspacePath(sessionId, resolvedPath) {
        if (!sessionId || !resolvedPath) return;

        const currentState = this.stateStore.get();
        let changed = false;
        const updatedSessions = (currentState.sessions || []).map((session) => {
            if (session.id !== sessionId) return session;

            const nextSession = { ...session };
            if (nextSession.path !== resolvedPath) {
                nextSession.path = resolvedPath;
                changed = true;
            }

            if (nextSession.worktree) {
                const nextWorktree = { ...nextSession.worktree };
                if (nextWorktree.path !== resolvedPath) {
                    nextWorktree.path = resolvedPath;
                    changed = true;
                }
                nextSession.worktree = nextWorktree;
            }

            if (changed) {
                nextSession.updatedAt = new Date().toISOString();
            }

            return nextSession;
        });

        if (changed) {
            await this.stateStore.update({ ...currentState, sessions: updatedSessions });
        }
    }

    async resolveSessionWorkspacePath(sessionOrId, options = {}) {
        const { persist = true, preferTmux = true } = options;
        const state = this.stateStore.get();
        const session = typeof sessionOrId === 'string'
            ? (state.sessions || []).find((item) => item.id === sessionOrId)
            : sessionOrId;

        if (!session) return null;

        const seen = new Set();
        const orderedCandidates = [];
        const pushOrdered = (candidate) => {
            if (!candidate || seen.has(candidate)) return;
            seen.add(candidate);
            orderedCandidates.push(candidate);
        };

        if (preferTmux) {
            pushOrdered(await this._getTmuxCurrentPath(session.id));
        }

        for (const candidate of this._getCandidateWorkspacePaths(session)) {
            pushOrdered(candidate);
        }

        const resolvedPath = orderedCandidates.find((candidate) => fs.existsSync(candidate)) || null;
        if (resolvedPath && persist) {
            await this._persistResolvedWorkspacePath(session.id, resolvedPath);
        }

        return resolvedPath;
    }

    async reconcileSessionWorkspacePaths() {
        const state = this.stateStore.get();
        const sessions = state.sessions || [];

        for (const session of sessions) {
            if (!session?.id) continue;
            await this.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true });
        }
    }

    /**
     * Phase 3: activeセッションを復元
     * サーバー起動時にstate.jsonからintendedState === 'active'のセッションを復元し、
     * 既存のttydプロセスと紐付ける。
     *
     * 改善: state.jsonのttydProcess情報を優先使用
     * 1. ttydProcess情報がある場合 → プロセス存在確認 → activeSessionsに登録
     * 2. ttydProcess情報がない場合 → ps auxで検索（後方互換性）
     * 3. どちらでも見つからない場合 → 新規起動
     */
    async restoreActiveSessions() {
        try {
            logger.info('[restoreActiveSessions] Restoring active sessions from state.json...');

            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            if (sessions.length === 0) {
                logger.info('[restoreActiveSessions] No sessions in state.json');
                return;
            }

            // intendedState === 'active' のセッションを抽出
            const activeSessions = sessions.filter(s => s.intendedState === 'active');
            logger.info(`[restoreActiveSessions] Found ${activeSessions.length} active session(s) in state.json`);

            if (activeSessions.length === 0) {
                return;
            }

            // Collect tmux sessions once
            const { stdout: tmuxOut } = await this.execPromise(
                'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
            ).catch(() => ({ stdout: '' }));
            const tmuxSessions = new Set(tmuxOut.trim().split('\n').filter(Boolean));

            // Collect ttyd processes once (skip in xterm-only mode)
            const ttydProcsBySessionId = new Map();
            if (!this._isXtermOnlyMode()) {
                const { stdout: psOut } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
                const ttydLines = psOut.trim() ? psOut.trim().split('\n') : [];

                for (const line of ttydLines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parseInt(parts[1], 10);
                    if (!Number.isFinite(pid)) continue;

                    const sessionMatch = line.match(/-b\s+\/console\/(session-\d+)/);
                    const sessionId = sessionMatch ? sessionMatch[1] : null;
                    if (!sessionId) continue;

                    const portMatch = line.match(/-p\s+(\d+)/);
                    const port = portMatch ? parseInt(portMatch[1], 10) : null;
                    if (!Number.isFinite(port)) continue;

                    const list = ttydProcsBySessionId.get(sessionId) || [];
                    list.push({ pid, port, line });
                    ttydProcsBySessionId.set(sessionId, list);
                }
            }

            const pauseSessionIds = new Set();

            for (const session of activeSessions) {
                const sessionId = session.id;
                const engine = session.engine || 'claude';
                const initialCommand = session.initialCommand || '';
                const cwd = await this.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
                    || this._getStoredWorkspacePath(session);

                const hasTmux = tmuxSessions.has(sessionId);
                const candidates = ttydProcsBySessionId.get(sessionId) || [];

                // If tmux is missing, don't auto-recreate. Pause + kill stray ttyd (prevents wrong log linkage).
                if (!hasTmux) {
                    if (candidates.length > 0) {
                        logger.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Killing ${candidates.length} ttyd process(es) and pausing session.`);
                        for (const proc of candidates) {
                            await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                        }
                    } else {
                        logger.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Pausing session.`);
                    }
                    pauseSessionIds.add(sessionId);
                    this.activeSessions.delete(sessionId);
                    continue;
                }

                // xterm-only mode: tmuxが生きていればOK、ttyd再接続は不要
                if (this._isXtermOnlyMode()) {
                    logger.info(`[restoreActiveSessions] xterm-only: tmux alive for ${sessionId}`);
                    continue;
                }

                // Prefer persisted pid if it's still running.
                const persistedPid = session?.ttydProcess?.pid;
                const persistedPort = session?.ttydProcess?.port;

                let keep = null;
                if (Number.isFinite(persistedPid) && this._isProcessRunning(persistedPid)) {
                    const port = Number.isFinite(persistedPort)
                        ? persistedPort
                        : candidates.find(p => p.pid === persistedPid)?.port;
                    if (Number.isFinite(port)) {
                        keep = { pid: persistedPid, port };
                    }
                }

                // Otherwise, adopt from ps aux.
                if (!keep && candidates.length > 0) {
                    const running = candidates.filter(p => this._isProcessRunning(p.pid));
                    const pool = running.length > 0 ? running : candidates;
                    const chosen = pool.sort((a, b) => b.pid - a.pid)[0];
                    keep = { pid: chosen.pid, port: chosen.port };
                }

                if (keep && Number.isFinite(keep.pid) && Number.isFinite(keep.port)) {
                    this.activeSessions.set(sessionId, {
                        port: keep.port,
                        pid: keep.pid,
                        process: null
                    });

                    // Kill duplicates (best-effort)
                    for (const proc of candidates) {
                        if (proc.pid === keep.pid) continue;
                        logger.warn(`[restoreActiveSessions] Duplicate ttyd for ${sessionId}: killing pid ${proc.pid} (keeping ${keep.pid})`);
                        await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    }

                    // Sync persisted ttydProcess when needed
                    if (session?.ttydProcess?.pid !== keep.pid || session?.ttydProcess?.port !== keep.port) {
                        await this._saveTtydProcessInfo(sessionId, { port: keep.port, pid: keep.pid, engine });
                    }

                    logger.info(`[restoreActiveSessions] Restored session ${sessionId}: PID ${keep.pid}, Port ${keep.port}`);
                    continue;
                }

                // No running ttyd found: clear stale info then start a new ttyd attached to existing tmux.
                if (session.ttydProcess) {
                    await this._clearTtydProcessInfo(sessionId);
                }

                try {
                    // Use persisted port for reconnection stability (UI URLs stay valid)
                    const preferredPort = session?.ttydProcess?.port;
                    logger.info(`[restoreActiveSessions] Reconnecting ttyd for ${sessionId} (preferredPort: ${preferredPort}, engine: ${engine})`);

                    await this._restartTtydForExistingTmux(sessionId, preferredPort, engine);
                    logger.info(`[restoreActiveSessions] Successfully reconnected ttyd for ${sessionId}`);
                } catch (err) {
                    logger.error(`[restoreActiveSessions] Failed to reconnect ttyd for ${sessionId}:`, err);
                }
            }

            if (pauseSessionIds.size > 0) {
                const now = new Date().toISOString();
                const currentState = this.stateStore.get();
                const updatedSessions = (currentState.sessions || []).map(session => {
                    if (!pauseSessionIds.has(session.id)) return session;
                    return {
                        ...session,
                        intendedState: 'paused',
                        pausedReason: 'tmux_missing_on_restore',
                        pausedAt: now,
                        tmuxMissingAt: now,
                        ttydProcess: null,
                        updatedAt: now
                    };
                });
                await this.stateStore.update({ ...currentState, sessions: updatedSessions });
                logger.warn(`[restoreActiveSessions] Paused ${pauseSessionIds.size} session(s) with missing TMUX`);
            }

            logger.info(`[restoreActiveSessions] Total restored/started: ${this.activeSessions.size} session(s)`);

            // Update nextPort to avoid port conflicts with restored sessions
            // 既存セッションがUIポート帯でも、新規セッションは40000番台から開始
            const ports = Array.from(this.activeSessions.values())
                .map(s => s.port)
                .filter(p => Number.isFinite(p));

            if (ports.length > 0) {
                const maxPort = Math.max(40000, ...ports);
                this.nextPort = maxPort + 1;
                logger.info(`[restoreActiveSessions] Updated nextPort to ${this.nextPort} (max existing port: ${maxPort})`);
            }

            // Best-effort: orphan/duplicate cleanup
            await this.cleanupOrphans();
        } catch (err) {
            logger.error('[restoreActiveSessions] Error:', err);
        }
    }

    /**
     * 孤立したttydプロセスをクリーンアップ
     *
     * BUG FIX: 以前は`pkill ttyd`で全プロセスを殺していたが、
     * これはactiveセッションのttydも殺してしまう。
     *
     * 修正後: activeSessionsに登録されていないttydプロセスのみ殺す
     */
    async cleanupOrphans() {
        try {
            logger.info('[cleanupOrphans] Checking for orphaned/duplicate ttyd processes...');

            // 1. 全てのttydプロセスを取得
            const { stdout } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
            if (!stdout.trim()) {
                logger.info('[cleanupOrphans] No ttyd processes found');
                return;
            }

            const lines = stdout.trim().split('\n');
            logger.info(`[cleanupOrphans] Found ${lines.length} ttyd process(es)`);

            // 2. 保護対象: state.json の intendedState === 'active' または 'paused'
            const state = this.stateStore.get();
            const protectedSessionIds = new Set(
                (state.sessions || [])
                    .filter(s => s.intendedState === 'active' || s.intendedState === 'paused')
                    .map(s => s.id)
            );
            logger.info(`[cleanupOrphans] Found ${protectedSessionIds.size} active/paused session(s) in state.json`);

            // 3. state.json / in-memory の正PIDマップ
            const statePidBySessionId = new Map();
            const stateEngineBySessionId = new Map();
            for (const session of state.sessions || []) {
                const pid = session?.ttydProcess?.pid;
                if (Number.isFinite(pid)) {
                    statePidBySessionId.set(session.id, pid);
                    stateEngineBySessionId.set(session.id, session.engine || session?.ttydProcess?.engine || 'claude');
                }
            }

            const activePidBySessionId = new Map();
            for (const [sessionId, sessionData] of this.activeSessions) {
                const pid = sessionData.process?.pid || sessionData.pid;
                if (Number.isFinite(pid)) {
                    activePidBySessionId.set(sessionId, pid);
                }
            }

            // 4. ttydプロセスを sessionId ごとにグループ化
            const procsBySessionId = new Map();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);
                if (!Number.isFinite(pid)) continue;

                const sessionMatch = line.match(/-b\s+\/console\/(session-\d+)/);
                const sessionId = sessionMatch ? sessionMatch[1] : null;
                if (!sessionId) continue;

                const portMatch = line.match(/-p\s+(\d+)/);
                const port = portMatch ? parseInt(portMatch[1], 10) : null;

                const list = procsBySessionId.get(sessionId) || [];
                list.push({ pid, port, line });
                procsBySessionId.set(sessionId, list);
            }

            let killed = 0;

            // 5. 保護対象外は全kill
            for (const [sessionId, procs] of procsBySessionId.entries()) {
                if (protectedSessionIds.has(sessionId)) continue;

                for (const proc of procs) {
                    logger.info(`[cleanupOrphans] Killing orphaned ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                    await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    killed++;
                }
                procsBySessionId.delete(sessionId);
            }

            // 6. 保護対象内の重複だけkill（正PIDは保持）
            for (const [sessionId, procs] of procsBySessionId.entries()) {
                if (procs.length <= 1) continue;

                const activePid = activePidBySessionId.get(sessionId);
                const statePid = statePidBySessionId.get(sessionId);

                const candidatePids = new Set(procs.map(p => p.pid));

                let keepPid = null;
                if (Number.isFinite(activePid) && candidatePids.has(activePid) && this._isProcessRunning(activePid)) {
                    keepPid = activePid;
                } else if (Number.isFinite(statePid) && candidatePids.has(statePid) && this._isProcessRunning(statePid)) {
                    keepPid = statePid;
                } else {
                    // Prefer the newest PID as a fallback.
                    keepPid = Math.max(...procs.map(p => p.pid));
                }

                logger.warn(`[cleanupOrphans] Duplicate ttyd detected for ${sessionId}. Keeping pid=${keepPid}, killing ${procs.length - 1} process(es).`);

                for (const proc of procs) {
                    if (proc.pid === keepPid) continue;
                    logger.info(`[cleanupOrphans] Killing duplicate ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                    await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    killed++;
                }

                // Best-effort: persist keepPid when state pid doesn't match.
                if (Number.isFinite(keepPid) && keepPid != statePid) {
                    const keepPort = procs.find(p => p.pid == keepPid)?.port;
                    if (Number.isFinite(keepPort)) {
                        const engine = stateEngineBySessionId.get(sessionId) || 'claude';
                        await this._saveTtydProcessInfo(sessionId, { port: keepPort, pid: keepPid, engine });
                    }
                }
            }

            logger.info(`[cleanupOrphans] Cleaned up ${killed} orphaned/duplicate ttyd process(es)`);
        } catch (err) {
            logger.error('[cleanupOrphans] Error:', err);
        }
    }

    /**
     * 空きポートを検索
     * @param {number} startPort - 検索開始ポート
     * @returns {Promise<number>} 空きポート番号
     */
    findFreePort(startPort) {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            // ttydはIPv4で待ち受けるため、同じ条件で空きポート判定する
            server.listen({ port: startPort, host: '0.0.0.0' }, () => {
                server.close(() => resolve(startPort));
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(this.findFreePort(startPort + 1));
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * ttydがポートをリッスン状態になるまで待機
     * @param {number} port - 監視対象ポート
     * @param {number} timeoutMs - タイムアウト（デフォルト: 10000ms）
     * @param {number} retryIntervalMs - リトライ間隔（デフォルト: 100ms）
     * @returns {Promise<void>} - リッスン開始したらresolve、タイムアウトでreject
     * @throws {Error} - タイムアウト時
     */
    async waitForTtydReady(port, timeoutMs = 10000, retryIntervalMs = 100) {
        const startTime = Date.now();
        const deadline = startTime + timeoutMs;

        while (Date.now() < deadline) {
            try {
                await this._checkPortListening(port);
                const elapsedMs = Date.now() - startTime;
                logger.info(`[ttyd] Port ${port} ready after ${elapsedMs}ms`);
                return;
            } catch (err) {
                await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
            }
        }

        const elapsedMs = Date.now() - startTime;
        throw new Error(`ttyd port ${port} did not become ready within ${timeoutMs}ms (elapsed: ${elapsedMs}ms)`);
    }

    /**
     * 指定ポートがリッスン状態かチェック（TCP接続試行）
     * @private
     * @param {number} port - チェック対象ポート
     * @param {number} connectionTimeout - 接続タイムアウト（デフォルト: 100ms）
     * @returns {Promise<void>} - リッスン中ならresolve、接続失敗でreject
     */
    _checkPortListening(port, connectionTimeout = 100) {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ port, host: 'localhost', timeout: connectionTimeout });

            socket.on('connect', () => {
                socket.end();
                resolve();
            });

            socket.on('timeout', () => {
                socket.destroy();
                reject(new Error('Connection timeout'));
            });

            socket.on('error', (err) => {
                socket.destroy();
                reject(err);
            });
        });
    }

    /**
     * セッション状態を取得（Hook報告ベース）
     * ハートビートタイムアウト: 60分以上working報告がなければisWorking=falseとする
     * @returns {Object} sessionId -> {isWorking, isDone}
     */
    getSessionStatus() {
        const status = {};
        const HEARTBEAT_TIMEOUT = 60 * 60 * 1000; // 60分
        const now = Date.now();

        // hookStatusでループ（ttyd停止後も'done'を保持するため）
        for (const [sessionId, hookData] of this.hookStatus) {
            const normalized = this._normalizeHookData(hookData);
            if (!normalized) continue;

            const activeTurnCount = normalized.activeTurnIds.length;
            const hasWorking = normalized.lastWorkingAt > 0;
            const hasDone = normalized.lastDoneAt > 0;
            if (!hasWorking && !hasDone && activeTurnCount === 0) continue;

            // タイムアウト判定: 最後のworking報告から10分経過したらisWorking: false
            const lastActiveAt = Math.max(normalized.lastActivityAt, normalized.lastWorkingAt);
            const isStale = lastActiveAt > 0 && (now - lastActiveAt > HEARTBEAT_TIMEOUT);
            const isWorking = !isStale && (activeTurnCount > 0 || normalized.lastWorkingAt > normalized.lastDoneAt);
            const isDone = !isWorking && (normalized.lastDoneAt > 0 || isStale);

            status[sessionId] = {
                isWorking,
                isDone,
                lastWorkingAt: normalized.lastWorkingAt,
                lastDoneAt: normalized.lastDoneAt,
                lastActivityAt: normalized.lastActivityAt,
                lastEventType: normalized.lastEventType,
                liveActivity: normalized.liveActivity,
                activeTurnCount,
                timestamp: normalized.timestamp
            };
        }

        return status;
    }

    /**
     * Activity報告を記録
     * @param {string} sessionId - セッションID
     * @param {string} status - ステータス（'working' | 'done'）
     * @param {number} reportedAt - 報告時刻（ms）
     */
    reportActivity(sessionId, status, reportedAt, metadata = {}) {
        if (status !== 'working' && status !== 'done') {
            logger.warn(`[Hook] Ignoring invalid status for ${sessionId}: ${status}`);
            return;
        }

        const timestamp = this._coerceTimestamp(reportedAt);
        const lifecycle = typeof metadata.lifecycle === 'string' ? metadata.lifecycle : '';
        const eventType = typeof metadata.eventType === 'string' ? metadata.eventType : '';
        const turnId = typeof metadata.turnId === 'string' ? metadata.turnId.trim() : '';
        logger.info(`[Hook] Received status update from ${sessionId}: ${status} @ ${timestamp} (${lifecycle || 'legacy'}${turnId ? `:${turnId}` : ''})`);

        const currentHookData = this._normalizeHookData(this.hookStatus.get(sessionId)) || {
            lastWorkingAt: 0,
            lastDoneAt: 0,
            lastActivityAt: 0,
            lastEventType: null,
            activeTurnIds: [],
            liveActivity: null
        };

        let lastWorkingAt = currentHookData.lastWorkingAt;
        let lastDoneAt = currentHookData.lastDoneAt;
        let lastActivityAt = Math.max(currentHookData.lastActivityAt, timestamp);
        let lastEventType = eventType || currentHookData.lastEventType || null;
        const activeTurnIds = new Set(currentHookData.activeTurnIds);

        if (lifecycle === 'turn_started') {
            if (turnId) {
                activeTurnIds.add(turnId);
            }
            lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            lastDoneAt = 0;
        } else if (lifecycle === 'turn_completed') {
            if (turnId) {
                activeTurnIds.delete(turnId);
            } else if (activeTurnIds.size > 0) {
                logger.warn(`[Hook] Ignoring ambiguous turn_completed without turnId for ${sessionId}; keeping ${activeTurnIds.size} active turn(s)`);
            }

            if (turnId || activeTurnIds.size === 0) {
                lastDoneAt = Math.max(lastDoneAt, timestamp);
            }
        } else if (lifecycle === 'heartbeat') {
            if (activeTurnIds.size > 0 || lastWorkingAt > lastDoneAt) {
                lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            }
        } else if (status === 'working') {
            lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            lastDoneAt = 0; // working報告を優先化（done報告をリセット）
        } else {
            lastDoneAt = Math.max(lastDoneAt, timestamp);
        }

        const effectiveStatus = activeTurnIds.size > 0 || lastWorkingAt > lastDoneAt ? 'working' : 'done';
        const liveActivity = this._deriveLiveActivity({
            status: effectiveStatus,
            timestamp,
            metadata,
            currentHookData,
            eventType: lastEventType,
            activeTurnIds
        });

        const hookStatusData = {
            status: effectiveStatus,
            timestamp,
            lastWorkingAt,
            lastDoneAt,
            lastActivityAt,
            lastEventType,
            activeTurnIds: Array.from(activeTurnIds),
            liveActivity
        };

        this.hookStatus.set(sessionId, hookStatusData);
        this._persistHookStatus(sessionId, hookStatusData, timestamp);

        const reportedTaskBrief = typeof liveActivity?.taskBrief === 'string' ? liveActivity.taskBrief : null;
        const reportedAssistantSnippet = typeof liveActivity?.assistantSnippet === 'string' ? liveActivity.assistantSnippet : null;
        if (reportedTaskBrief || reportedAssistantSnippet) {
            this._persistSessionLiveSummary(sessionId, {
                taskBrief: reportedTaskBrief,
                assistantSnippet: reportedAssistantSnippet
            }, timestamp).catch((error) => {
                logger.warn(`[Hook] Failed to persist live summary for ${sessionId}: ${error.message}`);
            });
        }
    }

    /**
     * セッションの'done'ステータスをクリア（セッションが開かれたとき）
     * @param {string} sessionId - セッションID
     */
    clearDoneStatus(sessionId) {
        const normalized = this._normalizeHookData(this.hookStatus.get(sessionId));
        if (normalized &&
            normalized.activeTurnIds.length === 0 &&
            normalized.lastDoneAt >= normalized.lastWorkingAt &&
            normalized.lastDoneAt > 0) {
            this.hookStatus.delete(sessionId);
            this._persistHookStatus(sessionId, null);
        }
    }

    /**
     * セッションの'working'ステータスをクリア（セッション切り替え時等）
     * @param {string} sessionId - セッションID
     */
    clearWorking(sessionId) {
        const normalized = this._normalizeHookData(this.hookStatus.get(sessionId));
        if (normalized && (normalized.activeTurnIds.length > 0 || (normalized.lastWorkingAt > normalized.lastDoneAt && normalized.lastWorkingAt > 0))) {
            this.hookStatus.delete(sessionId);
            this._persistHookStatus(sessionId, null);
        }
    }

    _normalizeHookData(hookData) {
        if (!hookData) return null;

        const timestamp = Number.isFinite(hookData.timestamp) ? hookData.timestamp : 0;
        const status = hookData.status;
        const lastWorkingAt = Number.isFinite(hookData.lastWorkingAt)
            ? hookData.lastWorkingAt
            : status === 'working'
                ? timestamp
                : 0;
        const lastDoneAt = Number.isFinite(hookData.lastDoneAt)
            ? hookData.lastDoneAt
            : status === 'done'
                ? timestamp
                : 0;
        const lastActivityAt = Number.isFinite(hookData.lastActivityAt)
            ? hookData.lastActivityAt
            : Math.max(lastWorkingAt, lastDoneAt, timestamp);
        const lastEventType = typeof hookData.lastEventType === 'string' && hookData.lastEventType.trim()
            ? hookData.lastEventType
            : null;
        const activeTurnIds = Array.isArray(hookData.activeTurnIds)
            ? Array.from(new Set(
                hookData.activeTurnIds
                    .filter(turnId => typeof turnId === 'string')
                    .map(turnId => turnId.trim())
                    .filter(Boolean)
            ))
            : [];
        const liveActivity = this._normalizeLiveActivity(hookData.liveActivity);

        return {
            ...hookData,
            status,
            timestamp,
            lastWorkingAt,
            lastDoneAt,
            lastActivityAt,
            lastEventType,
            activeTurnIds,
            liveActivity
        };
    }

    _normalizeLiveActivity(liveActivity) {
        if (!liveActivity || typeof liveActivity !== 'object') return null;
        const normalizeString = (value) => {
            if (typeof value !== 'string') return null;
            const normalized = value.trim().replace(/\s+/g, ' ');
            return normalized || null;
        };
        const updatedAt = Number.isFinite(liveActivity.updatedAt) ? liveActivity.updatedAt : 0;

        const normalized = {
            activityKind: normalizeString(liveActivity.activityKind),
            taskBrief: normalizeString(liveActivity.taskBrief),
            assistantSnippet: normalizeString(liveActivity.assistantSnippet),
            currentStep: normalizeString(liveActivity.currentStep),
            latestEvidence: normalizeString(liveActivity.latestEvidence),
            statusTone: normalizeString(liveActivity.statusTone),
            updatedAt,
            assistantSnippetUpdatedAt: Number.isFinite(liveActivity.assistantSnippetUpdatedAt)
                ? liveActivity.assistantSnippetUpdatedAt
                : 0
        };

        if (!normalized.activityKind && !normalized.taskBrief && !normalized.assistantSnippet && !normalized.currentStep && !normalized.latestEvidence) {
            return null;
        }

        return normalized;
    }

    _deriveLiveActivity({ status, timestamp, metadata = {}, currentHookData = {}, eventType = '', activeTurnIds = new Set() }) {
        const normalizeString = (value) => {
            if (typeof value !== 'string') return null;
            const normalized = value.trim().replace(/\s+/g, ' ');
            return normalized || null;
        };
        const previous = this._normalizeLiveActivity(currentHookData.liveActivity);
        const activityKind = normalizeString(metadata.activityKind) || this._deriveActivityKind(eventType, status);
        const currentStep = normalizeString(metadata.currentStep) || this._deriveCurrentStep(activityKind, eventType, status);
        const latestEvidence = normalizeString(metadata.latestEvidence) || previous?.latestEvidence || null;
        const taskBrief = normalizeString(metadata.taskBrief) || previous?.taskBrief || null;
        const assistantSnippet = normalizeString(metadata.assistantSnippet) || previous?.assistantSnippet || null;

        if (!activityKind && !currentStep && !latestEvidence && !taskBrief && !assistantSnippet) {
            return previous;
        }

        let statusTone = 'idle';
        if (status === 'working' || activeTurnIds.size > 0) {
            statusTone = activityKind === 'waiting_input' ? 'waiting' : 'working';
        } else if (activityKind === 'waiting_input') {
            statusTone = 'waiting';
        } else if (status === 'done') {
            statusTone = 'done';
        }

        return {
            activityKind,
            taskBrief,
            assistantSnippet,
            currentStep,
            latestEvidence,
            statusTone,
            updatedAt: timestamp,
            assistantSnippetUpdatedAt: assistantSnippet ? timestamp : (previous?.assistantSnippetUpdatedAt || 0)
        };
    }

    _deriveActivityKind(eventType, status) {
        switch (eventType) {
        case 'item/fileChange/outputDelta':
            return 'editing_file';
        case 'item/commandExecution/outputDelta':
        case 'exec_command_output_delta':
            return 'running_command';
        case 'assistant-message':
        case 'assistant-response':
        case 'assistant-message-complete':
        case 'assistant-response-complete':
        case 'item/agentMessage/delta':
        case 'item/assistantMessage/delta':
        case 'agent_message_delta':
            return 'reasoning';
        case 'user-input-requested':
        case 'user_input_requested':
        case 'request-user-input':
        case 'request_input':
        case 'waiting-for-user-input':
        case 'waiting_for_user_input':
            return 'waiting_input';
        case 'agent-turn-start':
        case 'agent-turn-begin':
        case 'turn/started':
        case 'task_started':
            return 'task_started';
        case 'agent-turn-complete':
        case 'task_complete':
        case 'codex/event/task_complete':
        case 'turn/completed':
            return 'task_completed';
        default:
            return status === 'working' ? 'working' : status === 'done' ? 'done' : null;
        }
    }

    _deriveCurrentStep(activityKind, eventType, status) {
        switch (activityKind) {
        case 'editing_file':
            return 'ファイルを更新中';
        case 'running_command':
            return 'コマンドを実行中';
        case 'reasoning':
            return '回答と方針を組み立て中';
        case 'waiting_input':
            return '入力待ち';
        case 'task_started':
            return '依頼を受けて作業開始';
        case 'task_completed':
            return eventType === 'turn/completed' ? 'ターンが完了' : '作業が一区切り完了';
        case 'working':
            return '作業中';
        case 'done':
            return '完了';
        default:
            return status === 'working' ? '作業中' : status === 'done' ? '完了' : null;
        }
    }

    _persistHookStatus(sessionId, hookStatusData, timestamp = Date.now()) {
        const currentState = this.stateStore.get();
        const updatedAt = new Date(timestamp).toISOString();
        const updatedSessions = currentState.sessions.map(session => {
            if (session.id !== sessionId) {
                return session;
            }

            if (hookStatusData) {
                return {
                    ...session,
                    hookStatus: hookStatusData,
                    updatedAt
                };
            }

            const { hookStatus, ...rest } = session;
            return rest;
        });

        this.stateStore.update({
            ...currentState,
            sessions: updatedSessions
        });
    }

    _coerceTimestamp(value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }
        return Date.now();
    }

    /**
     * セッションがアクティブかチェック
     * @param {string} sessionId - セッションID
     * @returns {boolean}
     */
    isActive(sessionId) {
        return this.activeSessions.has(sessionId);
    }

    /**
     * activeSessionsの参照を取得（ttyd proxyで使用）
     * @returns {Map} activeSessions Map
     */
    getActiveSessions() {
        return this.activeSessions;
    }

    getSession(sessionId) {
        const state = this.stateStore.get();
        return (state.sessions || []).find(session => session.id === sessionId) || null;
    }

    _resolveScriptPath(scriptName) {
        const candidates = [
            path.join(this.serverDir, 'scripts', scriptName),
            path.join(this.serverDir, scriptName),
            path.join(this.serverDir, '..', 'scripts', scriptName),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return candidates[0];
    }

    /**
     * 起動準備完了フラグを設定
     */
    markReady() {
        if (this._isReady) {
            return;
        }
        this._isReady = true;
        if (this._readyResolver) {
            this._readyResolver(true);
        }
    }

    /**
     * 起動準備完了かどうか
     * @returns {boolean}
     */
    isReady() {
        return this._isReady;
    }

    /**
     * 起動準備完了を待機
     * @param {number} timeoutMs - タイムアウト（ms）
     * @returns {Promise<boolean>} 準備完了ならtrue
     */
    async waitUntilReady(timeoutMs = 10000) {
        if (this._isReady) {
            return true;
        }

        return await Promise.race([
            this._readyPromise.then(() => true),
            new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
        ]);
    }

    _isTmuxSessionRunningSync(sessionId) {
        if (!sessionId) return false;
        try {
            execSync(`tmux has-session -t "${sessionId}" 2>/dev/null`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * xterm-only mode: ttydをスキップしWebSocket直接接続のみ使用
     * @returns {boolean}
     */
    _isXtermOnlyMode() {
        return process.env.BRAINBASE_TERMINAL_TRANSPORT === 'xterm';
    }

    /**
     * セッションのランタイム状態を取得
     * @param {Object} session - セッション情報
     * @returns {{interactiveTransport: string, interactiveReady: boolean, interactiveUrl: string|null, needsRestart: boolean, port: number|null, ttydRunning: boolean, proxyPath: string|null}}
     */
    getRuntimeStatus(session) {
        if (this._isXtermOnlyMode()) {
            const sessionId = session?.id;
            const intendedState = session?.intendedState;
            const tmuxRunning = intendedState === 'active'
                ? this._isTmuxSessionRunningSync(sessionId)
                : false;
            return {
                interactiveTransport: tmuxRunning ? 'xterm' : 'none',
                interactiveReady: tmuxRunning,
                interactiveUrl: null,
                ttydRunning: false,
                needsRestart: intendedState === 'active' && !tmuxRunning,
                proxyPath: null,
                port: null
            };
        }
        const sessionId = session?.id;
        const intendedState = session?.intendedState;
        const activeEntry = this.activeSessions.get(session?.id);
        const activePid = activeEntry?.process?.pid || activeEntry?.pid;
        const persistedPid = session?.ttydProcess?.pid;
        const pidToCheck = activePid || persistedPid;
        const ttydRunning = pidToCheck ? this._isProcessRunning(pidToCheck) : false;
        const shouldCheckTmux = intendedState === 'active' && !ttydRunning;
        const tmuxRunning = shouldCheckTmux ? this._isTmuxSessionRunningSync(sessionId) : false;
        const needsRestart = intendedState === 'active' && !ttydRunning && !tmuxRunning;
        const port = activeEntry?.port || session?.ttydProcess?.port || null;
        const interactiveTransport = ttydRunning ? 'ttyd' : (tmuxRunning ? 'xterm' : 'none');
        const interactiveReady = ttydRunning || tmuxRunning;
        const interactiveUrl = ttydRunning && sessionId ? `/console/${sessionId}` : null;

        return {
            interactiveTransport,
            interactiveReady,
            interactiveUrl,
            ttydRunning,
            needsRestart,
            proxyPath: interactiveUrl,
            port
        };
    }

    /**
     * 単一セッションを取得（優先ロード用）
     * @param {string} sessionId - セッションID
     * @returns {Object|null} セッション情報（runtime status付き）
     */
    getSessionById(sessionId) {
        const state = this.stateStore.get();
        const session = (state.sessions || []).find(s => s.id === sessionId);
        if (!session) return null;
        const runtimeStatus = this.getRuntimeStatus(session);

        return {
            ...session,
            ttydRunning: runtimeStatus.ttydRunning,
            runtimeStatus
        };
    }

    async ensureSessionRuntime({ sessionId, cwd, initialCommand, engine = 'claude' }) {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error('sessionId is required');
        }
        if (!['claude', 'codex'].includes(engine)) {
            throw new Error('engine must be "claude" or "codex"');
        }

        if (await this._isTmuxSessionRunning(sessionId)) {
            return { startedExisting: true };
        }

        if (cwd && !fs.existsSync(cwd)) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }

        const scriptPath = this._resolveScriptPath('ensure_session_runtime.sh');
        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            }
        };
        const resolvedUiPort = this.uiPort ?? process.env.BRAINBASE_PORT;
        if (resolvedUiPort) {
            spawnOptions.env.BRAINBASE_PORT = String(resolvedUiPort);
        }
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        await new Promise((resolve, reject) => {
            const child = spawn('bash', [scriptPath, sessionId, initialCommand || '', engine], spawnOptions);
            let stderr = '';

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(stderr.trim() || `ensure_session_runtime exited with code ${code}`));
            });
        });

        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (await this._isTmuxSessionRunning(sessionId)) {
                return { startedExisting: false };
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        throw new Error(`tmux session did not become ready: ${sessionId}`);
    }

    /**
     * ttydプロセスを起動
     * @param {Object} options - 起動オプション
     * @param {string} options.sessionId - セッションID
     * @param {string} options.cwd - 作業ディレクトリ
     * @param {string} options.initialCommand - 初期コマンド
     * @param {string} options.engine - エンジン（'claude' | 'codex'）
     * @param {number} [options.preferredPort] - 優先ポート番号（再利用用）
     * @returns {Promise<{port: number, proxyPath: string}>}
     */
    async startTtyd({ sessionId, cwd, initialCommand, engine = 'claude', preferredPort, forceTtyd = false }) {
        await this.ensureSessionRuntime({ sessionId, cwd, initialCommand, engine });

        // xterm-only mode: tmuxだけ確保してttydはスキップ（モバイルのforceTtyd時は除外）
        if (this._isXtermOnlyMode() && !forceTtyd) {
            logger.info(`[startTtyd] xterm-only mode: skipping ttyd for ${sessionId}`);
            return { port: null, proxyPath: null, startedExisting: false, xtermOnly: true };
        }

        // 並行起動防止ロック: 同じセッションに対する同時呼び出しを防止
        if (this.startLocks.has(sessionId)) {
            logger.info(`[startTtyd] Lock active for ${sessionId}, waiting for existing start to complete`);
            return await this.startLocks.get(sessionId);
        }

        const promise = this._doStartTtyd({ sessionId, cwd, initialCommand, engine, preferredPort });
        this.startLocks.set(sessionId, promise);
        try {
            return await promise;
        } finally {
            this.startLocks.delete(sessionId);
        }
    }

    async _doStartTtyd({ sessionId, cwd, initialCommand, engine = 'claude', preferredPort }) {
        // Validate engine
        if (!['claude', 'codex'].includes(engine)) {
            throw new Error('engine must be "claude" or "codex"');
        }

        // Check if already running
        if (this.activeSessions.has(sessionId)) {
            const existing = this.activeSessions.get(sessionId);
            const pid = existing.process?.pid || existing.pid;
            if (pid && this._isProcessRunning(pid)) {
                return {
                    port: existing.port,
                    proxyPath: `/console/${sessionId}`
                };
            }
            // Process is dead but entry remains in map — clean up and proceed to new launch
            logger.warn(`[startTtyd] Stale entry for ${sessionId}: pid ${pid} is dead. Cleaning up and relaunching.`);
            this.activeSessions.delete(sessionId);
        }

        // Allocate port: prefer persisted port for reconnection stability
        let port;
        if (Number.isFinite(preferredPort) && preferredPort >= 40000) {
            // Try preferred port first (from state.json)
            port = await this.findFreePort(preferredPort);
            if (port !== preferredPort) {
                logger.info(`[startTtyd] Preferred port ${preferredPort} in use, allocated ${port} instead`);
            }
        } else {
            port = await this.findFreePort(this.nextPort);
            this.nextPort = port + 1;
        }

        logger.info(`Starting ttyd for session '${sessionId}' on port ${port} with engine '${engine}'...`);
        if (cwd) logger.info(`Working directory: ${cwd}`);

        // Validate working directory exists
        if (cwd && !fs.existsSync(cwd)) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }

        // Spawn ttyd with Base Path
        const scriptPath = this._resolveScriptPath('login_script.sh');
        const customIndexPath = fs.existsSync(path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html'))
            ? path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html')
            : path.join(this.serverDir, 'custom_ttyd_index.html');
        // IMPORTANT: ttyd base path must match the proxy route
        const basePath = `/console/${sessionId}`;

        const resolveBashPath = () => {
            const envPath = process.env.BASH_PATH;
            if (envPath && fs.existsSync(envPath)) return envPath;

            if (process.platform === 'win32') {
                const candidates = [
                    'C:\\msys64\\usr\\bin\\bash.exe',
                    'C:\\Program Files\\Git\\bin\\bash.exe',
                    'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
                ];
                for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) return candidate;
                }

                const userProfile = process.env.USERPROFILE;
                if (userProfile) {
                    const userGit = path.join(userProfile, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe');
                    if (fs.existsSync(userGit)) return userGit;
                }
            }

            return 'bash';
        };

        const bashPath = resolveBashPath();
        const toBashPath = (value) =>
            value
                .replace(/\\/g, '/')
                .replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
        const bashScriptPath = toBashPath(scriptPath);

        // Build ttyd arguments
        // Note: On Windows, -b (base-path) option doesn't work correctly, so we skip it
        // and handle path rewriting in the proxy instead
        const args = [
            '-p', port.toString(),
            '-W',
            // WebSocket ping interval to prevent timeout (especially over Cloudflare Zero Trust)
            '-P', '3',
            // Note: Removed '-o' (exit on disconnect) to allow reconnection on mobile/Cloudflare Zero Trust
            // PTY leak prevention is now handled by session lifecycle management
        ];

        // Only use base path on non-Windows platforms
        if (process.platform !== 'win32') {
            args.push('-b', basePath);
        }

        // On Windows, -w (working directory) is required to prevent crash
        // See: https://github.com/tsl0922/ttyd/issues/1292
        if (process.platform === 'win32') {
            const workingDir = cwd || 'C:/';
            args.push('-w', workingDir);
        }

        const fontFamily = process.platform === 'win32'
            ? 'Cascadia Code, Consolas, monospace'
            : (engine === 'codex' ? 'Menlo, Monaco, monospace' : 'Menlo');

        args.push(
            '-I', customIndexPath, // Custom HTML with keyboard shortcuts and mobile scroll support
            '-m', '1',                         // Max 1 client: prevent concurrent PTY allocation per session
            '-t', 'disableReconnect=true',   // Prevent PTY leak: disable ttyd built-in reconnect (brainbase TerminalReconnectManager handles it)
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
            '-t', 'enableClipboard=true',   // Enable clipboard access for copy/paste
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', `fontFamily=${fontFamily}`, // Engine/platform-specific monospace font
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            bashPath,
            bashScriptPath,
            sessionId,
            initialCommand || '',
            engine
        );

        // Options for spawn (server-managed)
        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],  // stdin無視、stdout/stderrはpipe
            env: {
                ...process.env,  // Inherit parent process environment
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8',
                TERM: 'tmux-256color'  // 絵文字・CJK文字幅を正しく処理
            }
        };

        const resolvedUiPort = this.uiPort ?? process.env.BRAINBASE_PORT;
        if (resolvedUiPort) {
            spawnOptions.env.BRAINBASE_PORT = String(resolvedUiPort);
        }

        // Set CWD if provided
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        const resolveTtydPath = () => {
            const envPath = process.env.TTYD_PATH;
            if (envPath && fs.existsSync(envPath)) return envPath;

            if (process.platform === 'win32') {
                const userProfile = process.env.USERPROFILE;
                if (userProfile) {
                    const userTtyd = path.join(userProfile, 'bin', 'ttyd.exe');
                    if (fs.existsSync(userTtyd)) return userTtyd;
                }
            }

            return 'ttyd';
        };

        const ttydPath = resolveTtydPath();
        logger.info(`[ttyd:${sessionId}] Command: ${ttydPath}`);
        logger.info(`[ttyd:${sessionId}] Args: ${JSON.stringify(args)}`);
        logger.info(`[ttyd:${sessionId}] CWD: ${spawnOptions.cwd || 'default'}`);
        const ttyd = spawn(ttydPath, args, spawnOptions);


        ttyd.stdout.on('data', (data) => {
            logger.info(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            logger.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            logger.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', async (code, signal) => {
            logger.info(`ttyd for ${sessionId} exited with code ${code}${signal ? ` signal ${signal}` : ''}`);

            // If a newer ttyd has been started for this session, ignore stale exits.
            const activeEntry = this.activeSessions.get(sessionId);
            const activePid = activeEntry?.process?.pid || activeEntry?.pid;
            if (activePid && ttyd.pid && activePid !== ttyd.pid) {
                logger.info(`[ttyd:${sessionId}] Ignoring exit for stale pid ${ttyd.pid} (active pid ${activePid})`);
                return;
            }

            // Preserve tmux on ttyd exit. tmux lifecycle is managed explicitly (archive/delete/TTL).
            await this._clearTtydProcessInfoIfMatches(sessionId, ttyd.pid);
            this.activeSessions.delete(sessionId);
            this.releaseTerminalOwnership(sessionId, null, { force: true });
        });

        // activeSessionsにpidも保存（復旧時の型統一のため）
        this.activeSessions.set(sessionId, { port, pid: ttyd.pid, process: ttyd });

        // state.jsonにttydProcess情報を永続化
        await this._saveTtydProcessInfo(sessionId, { port, pid: ttyd.pid, engine });

        // 起動直後に短時間だけ生存確認して即返す（固定500ms待機を回避）
        await new Promise((resolve, reject) => {
            const minStableMs = 120;
            const timeoutMs = 500;
            const stableAt = Date.now() + minStableMs;
            const deadline = Date.now() + timeoutMs;

            const check = () => {
                if (!this.activeSessions.has(sessionId)) {
                    reject(new Error('Session failed to start (process exited)'));
                    return;
                }
                if (Date.now() >= stableAt) {
                    resolve();
                    return;
                }
                if (Date.now() >= deadline) {
                    reject(new Error('Session start verification timeout'));
                    return;
                }
                setTimeout(check, 25);
            };

            check();
        });

        // Step 2: ttyd完全起動確認（ポートリッスン開始を待機）
        try {
            await this.waitForTtydReady(port, 10000, 100);
            logger.info(`[ttyd:${sessionId}] Port ${port} is ready for WebSocket connections`);
        } catch (error) {
            logger.error(`[ttyd:${sessionId}] Failed to wait for port ready:`, error);
            await this.stopTtyd(sessionId);
            throw new Error(`ttyd startup timeout: ${error.message}`);
        }

        return { port, proxyPath: basePath, startedExisting: false };
    }

    /**
     * 既存のtmuxセッションにttydを再接続（サーバー再起動後の復旧用）
     * tmuxセッションは生きてるけどttydが落ちた場合に使用
     *
     * @param {string} sessionId - セッションID
     * @param {number} preferredPort - 優先ポート番号（state.jsonから）
     * @param {string} engine - エンジン（'claude' | 'codex'）
     * @returns {Promise<{port: number, proxyPath: string}>}
     */
    async _restartTtydForExistingTmux(sessionId, preferredPort, engine = 'claude') {
        // tmuxセッションの存在確認
        const tmuxRunning = await this._isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            throw new Error(`TMUX session ${sessionId} not found. Cannot reconnect ttyd.`);
        }

        logger.info(`[_restartTtydForExistingTmux] Reconnecting ttyd to existing tmux: ${sessionId}`);

        // login_script.shは既存tmuxセッションを検出してattachする
        // initialCommandは空文字（既存セッションだから）
        return await this.startTtyd({
            sessionId,
            cwd: null,  // 既存セッションなのでCWD不要
            initialCommand: '',  // 初期コマンドなし
            engine,
            preferredPort
        });
    }

    /**
     * ttydプロセスを停止
     * @param {string} sessionId - セッションID
     * @param {Object} [options] - オプション
     * @param {boolean} [options.preserveTmux=false] - trueの場合、tmuxセッションを残してttydのみ再起動（PTYリーク修復用）
     * @returns {Promise<boolean>} 停止成功時true
     */
    async stopTtyd(sessionId, { preserveTmux = false } = {}) {
        if (!this.activeSessions.has(sessionId)) {
            return false;
        }

        this._clearPromptBuffer(sessionId);

        const sessionData = this.activeSessions.get(sessionId);
        const pid = sessionData.process?.pid || sessionData.pid;
        logger.info(`Stopping ttyd process for session ${sessionId} (port ${sessionData.port}, pid ${pid}, preserveTmux=${preserveTmux})`);

        // Graceful Partial Cleanup: 各ステップが失敗しても後続を続行
        const steps = [];

        // Step 1: ttydプロセスのkill
        if (pid) {
            steps.push({
                name: 'kill-ttyd-process',
                fn: async () => {
                    try {
                        process.kill(pid, 'SIGTERM');
                        await new Promise(resolve => setTimeout(resolve, 500));
                        if (this._isProcessRunning(pid)) {
                            process.kill(pid, 'SIGKILL');
                        }
                    } catch (err) {
                        if (err.code !== 'ESRCH') throw err;
                    }
                }
            });
        }

        // Step 2: TMUX/MCPクリーンアップ
        if (!preserveTmux) {
            steps.push({
                name: 'cleanup-session-resources',
                fn: () => this.cleanupSessionResources(sessionId)
            });
        }

        // Step 3: ttydProcess情報クリア
        steps.push({
            name: 'clear-ttyd-process-info',
            fn: async () => {
                if (pid) {
                    await this._clearTtydProcessInfoIfMatches(sessionId, pid);
                } else {
                    await this._clearTtydProcessInfo(sessionId);
                }
            }
        });

        // Step 4: activeSessionsから削除
        steps.push({
            name: 'delete-active-session',
            fn: () => { this.activeSessions.delete(sessionId); }
        });

        // Step 5: terminal ownershipリリース
        steps.push({
            name: 'release-terminal-ownership',
            fn: () => { this.releaseTerminalOwnership(sessionId, null, { force: true }); }
        });

        const result = await gracefulCleanup(sessionId, steps);
        if (result.warnings.length > 0) {
            logger.warn(`[stopTtyd] Partial cleanup for ${sessionId}:`, result.warnings);
        }

        return true;
    }

    /**
     * セッションのリソースをクリーンアップ（TMUX + MCPプロセス）
     * @param {string} sessionId - セッションID
     */
    async cleanupSessionResources(sessionId) {
        // Input validation
        if (!sessionId || typeof sessionId !== 'string') {
            logger.error('[Cleanup] Invalid sessionId:', sessionId);
            return;
        }

        logger.info(`[Cleanup] Starting cleanup for session ${sessionId}...`);

        let processesKilled = 0;

        // 1. 先にPID取得（tmuxが生きているうちに）
        let panePids = [];
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -s -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null || echo ""`
            );
            if (stdout.trim()) {
                panePids = stdout.trim().split('\n').filter(p => p.trim());
                logger.info(`[Cleanup] Collected ${panePids.length} pane PID(s) for ${sessionId}: ${panePids.join(', ')}`);
            }
        } catch (err) {
            logger.info(`[Cleanup] Could not collect pane PIDs for ${sessionId}:`, err.message);
        }

        // 2. 子プロセスツリーを全て取得（pgrep -P で再帰的に）
        const allPids = new Set();
        for (const pid of panePids) {
            allPids.add(pid);
            try {
                const { stdout } = await this.execPromise(`pgrep -P ${pid} 2>/dev/null`);
                if (stdout.trim()) {
                    stdout.trim().split('\n').forEach(p => allPids.add(p.trim()));
                }
            } catch (_) {}
        }

        // 3. TMUXセッション削除
        try {
            await this.execPromise(`tmux kill-session -t "${sessionId}" 2>/dev/null`);
            logger.info(`[Cleanup] TMUX session deleted: ${sessionId}`);
        } catch (err) {
            logger.info(`[Cleanup] TMUX session ${sessionId} already deleted or not found`);
        }

        // 4. 収集したプロセスを全てkill（SIGTERM → 待機 → SIGKILL）
        if (allPids.size > 0) {
            logger.info(`[Cleanup] Killing ${allPids.size} process(es) for ${sessionId}: ${[...allPids].join(', ')}`);
            for (const pid of allPids) {
                try {
                    await this.execPromise(`kill -TERM ${pid} 2>/dev/null`);
                } catch (_) {}
            }
            // SIGTERM後500ms待機
            await new Promise(resolve => setTimeout(resolve, 500));
            // まだ生きてるやつはSIGKILL
            for (const pid of allPids) {
                if (this._isProcessRunning(parseInt(pid))) {
                    try {
                        await this.execPromise(`kill -9 ${pid} 2>/dev/null`);
                        logger.info(`[Cleanup] Force killed PID ${pid}`);
                    } catch (_) {}
                }
            }
            processesKilled = allPids.size;
        }

        logger.info(`[Cleanup] Completed for ${sessionId} (Processes killed: ${processesKilled})`);
    }

    /**
     * Phase 2: Paused状態のセッションの24時間TTLクリーンアップ
     * 24時間以上経過したPausedセッションのTMUXを削除
     */
    async cleanupStalePausedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const PAUSED_TTL = 24 * 60 * 60 * 1000; // 24時間

        for (const session of state.sessions) {
            if (session.intendedState === 'paused' && session.pausedAt) {
                const pausedTime = new Date(session.pausedAt).getTime();

                if (now - pausedTime > PAUSED_TTL && !session.tmuxCleanedAt) {
                    // TMUX削除
                    try {
                        await this.execPromise(`tmux kill-session -t "${session.id}" 2>/dev/null`);
                        logger.info(`[Cleanup] Deleted TMUX for paused session ${session.id} (24h TTL)`);
                    } catch (err) {
                        // エラーは無視（TMUXが既に削除されている可能性がある）
                    }

                    // state.json更新
                    const updatedSessions = state.sessions.map(s =>
                        s.id === session.id
                            ? { ...s, tmuxCleanedAt: new Date().toISOString() }
                            : s
                    );

                    await this.stateStore.update({ ...state, sessions: updatedSessions });
                    logger.info(`[Cleanup] Marked TMUX cleaned for paused session ${session.id}`);
                }
            }
        }
    }

    /**
     * Phase 2: Archived状態のセッションの30日TTL自動削除
     * 30日以上経過したArchivedセッションを完全削除
     */
    async cleanupArchivedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const ARCHIVED_TTL = 30 * 24 * 60 * 60 * 1000; // 30日

        const sessionsToKeep = state.sessions.filter(session => {
            if (session.intendedState === 'archived' && session.archivedAt) {
                const archivedTime = new Date(session.archivedAt).getTime();

                if (now - archivedTime > ARCHIVED_TTL) {
                    logger.info(`[Cleanup] Deleting archived session ${session.id} (30d TTL)`);

                    // Worktreeがあれば削除（非同期、エラー無視）
                    if (session.worktree && this.worktreeService) {
                        this.worktreeService.remove(session.id, session.worktree.repo).catch(() => {});
                    }

                    return false; // 削除対象
                }
            }
            return true; // 保持
        });

        if (sessionsToKeep.length < state.sessions.length) {
            await this.stateStore.update({ ...state, sessions: sessionsToKeep });
            const deletedCount = state.sessions.length - sessionsToKeep.length;
            logger.info(`[Cleanup] Removed ${deletedCount} archived session(s) (30d TTL)`);
        }
    }

    /**
     * Phase 3: ttydProcess情報をstate.jsonに永続化
     * @param {string} sessionId - セッションID
     * @param {Object} processInfo - { port, pid, engine }
     */
    async _saveTtydProcessInfo(sessionId, { port, pid, engine }) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const hasSession = sessions.some(session => session.id === sessionId);
            if (!hasSession) {
                logger.warn(`[ttydProcess] Skip save: session ${sessionId} not found in state`);
                return;
            }

            const updatedSessions = sessions.map(session =>
                session.id === sessionId
                    ? {
                        ...session,
                        ttydProcess: {
                            port,
                            pid,
                            startedAt: new Date().toISOString(),
                            engine: engine || 'claude'
                        }
                    }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
            logger.info(`[ttydProcess] Saved for ${sessionId}: port=${port}, pid=${pid}`);
        } catch (err) {
            logger.error(`[ttydProcess] Failed to save for ${sessionId}:`, err.message);
        }
    }

    /**
     * Phase 3: ttydProcess情報をstate.jsonからクリア
     * @param {string} sessionId - セッションID
     */
    async _clearTtydProcessInfo(sessionId) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const updatedSessions = sessions.map(session =>
                session.id === sessionId
                    ? { ...session, ttydProcess: null }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
            logger.info(`[ttydProcess] Cleared for ${sessionId}`);
        } catch (err) {
            logger.error(`[ttydProcess] Failed to clear for ${sessionId}:`, err.message);
        }
    }


    /**
     * Phase 3: ttydProcess情報をstate.jsonからクリア（PID一致時のみ）
     * 重複ttydがいる状態でstaleプロセスがexitしても、正しいPIDを消さないためのガード。
     * @param {string} sessionId - セッションID
     * @param {number|undefined|null} pid - ttyd PID
     * @returns {Promise<boolean>} クリアしたらtrue
     */
    async _clearTtydProcessInfoIfMatches(sessionId, pid) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];

            let changed = false;
            const updatedSessions = sessions.map(session => {
                if (session.id !== sessionId) return session;
                if (!session.ttydProcess) return session;

                const currentPid = session.ttydProcess?.pid;
                // If both are valid pids and don't match, don't clear.
                if (Number.isFinite(currentPid) && Number.isFinite(pid) && currentPid !== pid) {
                    return session;
                }

                changed = true;
                return { ...session, ttydProcess: null };
            });

            if (!changed) return false;

            await this.stateStore.update({ ...state, sessions: updatedSessions });
            logger.info(`[ttydProcess] Cleared for ${sessionId}${Number.isFinite(pid) ? ` (pid=${pid})` : ''}`);
            return true;
        } catch (err) {
            logger.error(`[ttydProcess] Failed to clear for ${sessionId}:`, err.message);
            return false;
        }
    }

    /**
     * Phase 3: プロセスが実行中かどうかを確認
     * @param {number} pid - プロセスID
     * @returns {boolean} 実行中ならtrue
     */
    _isProcessRunning(pid) {
        try {
            process.kill(pid, 0);  // シグナル0 = 存在確認のみ
            // ゾンビ検出: psコマンドでプロセス状態を確認
            const status = execSync(`ps -o state= -p ${pid} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            // 'Z' = zombie, 'Z+' = zombie (foreground)
            return !status.startsWith('Z');
        } catch (e) {
            return false;
        }
    }

    /**
     * tmuxセッションが存在するか確認
     * @param {string} sessionId - セッションID
     * @returns {Promise<boolean>} 存在すればtrue
     */
    async _isTmuxSessionRunning(sessionId) {
        try {
            await this.execPromise(`tmux has-session -t "${sessionId}" 2>/dev/null`);
            return true;
        } catch {
            return false;
        }
    }

    async isTmuxSessionRunning(sessionId) {
        return await this._isTmuxSessionRunning(sessionId);
    }

    async getPaneMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const { stdout } = await this.execPromise(`tmux display-message -p -t "${sessionId}" "#{pane_in_mode}" 2>/dev/null || echo "0"`);
        return stdout.trim() === '1';
    }

    async resizeSessionWindow(sessionId, cols, rows) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const safeCols = Math.max(40, Math.min(300, Number(cols) || 0));
        const safeRows = Math.max(12, Math.min(120, Number(rows) || 0));
        if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
            throw new Error('Invalid terminal size');
        }

        await this.execPromise(`tmux resize-window -t "${sessionId}" -x ${safeCols} -y ${safeRows}`);
    }

    /**
     * tmux copy-mode scroll
     * @param {string} sessionId - セッションID
     * @param {string} direction - 'up' | 'down'
     * @param {number} steps - スクロール量
     */
    async scrollSession(sessionId, direction, steps = 1) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const dir = direction === 'down' ? 'scroll-down' : direction === 'up' ? 'scroll-up' : null;
        if (!dir) {
            throw new Error('Invalid scroll direction');
        }

        const count = Math.min(10, Math.max(1, Number(steps) || 1));
        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\"${target}\\" -X -N ${count} ${dir}" "copy-mode -t \\"${target}\\"; send-keys -t \\"${target}\\" -X -N ${count} ${dir}"`;

        await this.execPromise(cmd);
    }

    /**
     * tmux select-pane
     * @param {string} sessionId - セッションID
     * @param {string} direction - U/D/L/R
     */
    async selectPane(sessionId, direction) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const validDirections = ['U', 'D', 'L', 'R'];
        if (!validDirections.includes(direction)) {
            throw new Error('Invalid direction. Must be U, D, L, or R');
        }

        const target = sessionId.replace(/"/g, '\\"');
        await this.execPromise(`tmux select-pane -t "${target}" -${direction}`);
    }

    /**
     * tmux copy-mode exit
     * @param {string} sessionId - セッションID
     */
    async exitCopyMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\\"${target}\\\" -X cancel" ""`;

        await this.execPromise(cmd);
    }

    /**
     * ターミナルに入力を送信
     * @param {string} sessionId - セッションID
     * @param {string} input - 入力内容
     * @param {string} type - 'key' | 'text'
     */
    async sendInput(sessionId, input, type) {
        if (!input) {
            throw new Error('Input required');
        }

        const inputBytes = Buffer.byteLength(input, 'utf8');
        const preview = input.length > 120
            ? `${input.slice(0, 120)}...`
            : input;
        logger.info(
            `[session-manager] sendInput: sessionId="${sessionId}", type="${type}", bytes=${inputBytes}, preview=${JSON.stringify(preview)}`
        );
        await this._capturePromptInput(sessionId, input, type);

        if (type === 'key') {
            if (this.ALLOWED_KEYS.includes(input)) {
                logger.info(`[session-manager] Executing named key: sessionId="${sessionId}", key="${input}"`);
                await this._sendNamedKey(sessionId, input);
                return;
            }

            logger.warn('[session-manager] Non-allowlisted key payload received; treating as text', {
                sessionId,
                inputPreview: preview
            });
        } else if (type !== 'text') {
            throw new Error('Type must be key or text');
        }

        await this._pasteInputFromTempFile(sessionId, input);
    }

    async _runTmux(args) {
        return await new Promise((resolve, reject) => {
            const child = spawn('tmux', args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }

                const detail = stderr.trim() || stdout.trim() || `tmux exited with code ${code}`;
                const error = new Error(detail);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            });
        });
    }

    async _sendNamedKey(sessionId, key) {
        await this._runTmux(['send-keys', '-t', sessionId, key]);
    }

    async _pasteInputFromTempFile(sessionId, input) {
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brainbase-input-'));
        const tempFile = path.join(tempDir, 'paste.txt');
        const bufferName = `brainbase-${sessionId}-${Date.now()}`;

        try {
            await fs.promises.writeFile(tempFile, input, 'utf8');

            logger.info(`[session-manager] Executing large paste via temp file: ${tempFile}`);
            await this._runTmux(['load-buffer', '-b', bufferName, tempFile]);
            await this._runTmux(['paste-buffer', '-d', '-b', bufferName, '-t', sessionId]);
        } finally {
            await this._runTmux(['delete-buffer', '-b', bufferName]).catch(() => {});
            await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    /**
     * ターミナルコンテンツを取得（履歴）
     * @param {string} sessionId - セッションID
     * @param {number} lines - 取得行数（デフォルト: 500）
     * @returns {Promise<string>} ターミナルコンテンツ
     */
    async getContent(sessionId, lines = 500) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -S -${lines}`);
        return stdout;
    }

    /**
     * ANSI色情報付きでターミナル出力を取得
     * tmux capture-pane -e でエスケープシーケンスを保持したまま取得
     * @param {string} sessionId - セッションID
     * @param {number} lines - 取得行数
     * @returns {Promise<string>} ANSI色付きテキスト
     */
    async getContentWithColors(sessionId, lines = 10) {
        const { stdout } = await this.execPromise(
            `tmux capture-pane -e -t "${sessionId}" -p -S -${lines}`
        );
        return stdout;
    }

    /**
     * ターミナル出力と選択肢を取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<{output: string, choices: Array, hasChoices: boolean}>}
     */
    async getOutput(sessionId) {
        // -S -100: 最後100行の履歴を取得（選択肢がスクロールで上に行っても検出可能）
        // -J: 行の継続を結合
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -J -S -100`);
        const choices = this.outputParser.detectChoices(stdout);

        return {
            output: stdout,
            choices: choices,
            hasChoices: choices.length > 0
        };
    }

    /**
     * PTY Watchdog: 定期的にPTY使用状況を監視し、閾値超過時に警告
     * @param {number} intervalMs - 監視間隔（デフォルト: 600000ms = 10分）
     */
    startPtyWatchdog(intervalMs = 600000) {
        if (this._ptyWatchdogTimer) return;
        logger.info(`[PTY Watchdog] Starting (interval: ${intervalMs / 1000}s)`);

        // Session health monitor (CommandMate pattern): detect dead tmux sessions
        this._healthMonitor = new SessionHealthMonitor(this, {
            onDeadSession: (sessionId) => {
                logger.warn(`[PTY Watchdog] Dead session detected: ${sessionId}, cleaning up...`);
                this.stopTtyd(sessionId).catch(err => {
                    logger.error(`[PTY Watchdog] Cleanup failed for ${sessionId}:`, err.message);
                });
            }
        });
        this._healthMonitor.start(intervalMs);

        this._ptyWatchdogTimer = setInterval(async () => {
            try {
                // macOS: sysctl kern.tty.ptmx_max でPTY上限取得
                const { stdout: maxOut } = await this.execPromise('sysctl -n kern.tty.ptmx_max 2>/dev/null || echo 512');
                const maxPty = parseInt(maxOut.trim()) || 512;

                // 現在のPTY使用数
                const { stdout: countOut } = await this.execPromise('ls /dev/pty* 2>/dev/null | wc -l');
                const usedPty = parseInt(countOut.trim()) || 0;

                const usage = (usedPty / maxPty * 100).toFixed(1);
                const level = usedPty > maxPty * 0.8 ? 'CRITICAL' : usedPty > maxPty * 0.6 ? 'WARNING' : 'OK';

                logger.info(`[PTY Watchdog] ${level}: ${usedPty}/${maxPty} PTYs used (${usage}%)`);

                if (level === 'CRITICAL') {
                    logger.error(`[PTY Watchdog] CRITICAL: PTY usage at ${usage}%! Running orphan cleanup...`);
                    await this.cleanupOrphans();
                }
            } catch (err) {
                logger.error('[PTY Watchdog] Error:', err.message);
            }
        }, intervalMs);
    }

    /**
     * PTY Watchdogを停止
     */
    stopPtyWatchdog() {
        if (this._healthMonitor) {
            this._healthMonitor.stop();
            this._healthMonitor = null;
        }
        if (this._ptyWatchdogTimer) {
            clearInterval(this._ptyWatchdogTimer);
            this._ptyWatchdogTimer = null;
            logger.info('[PTY Watchdog] Stopped');
        }
    }

    /**
     * Graceful shutdown: 全セッションのリソースをクリーンアップ
     * server.jsのSIGTERM/SIGINTハンドラから呼ばれる
     */
    async cleanup() {
        this.stopPtyWatchdog();
        logger.info('[SessionManager] Starting graceful cleanup (preserve tmux)...');
        const sessionIds = [...this.activeSessions.keys()];
        for (const sessionId of sessionIds) {
            logger.info(`[SessionManager] Stopping ttyd for session: ${sessionId}`);
            await this.stopTtyd(sessionId, { preserveTmux: true });
        }
        logger.info(`[SessionManager] Graceful cleanup complete (${sessionIds.length} session(s))`);
    }
}

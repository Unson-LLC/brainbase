import { execFileSync } from 'child_process';

import { logger } from '../../utils/logger.js';
import { deriveTaskBriefFromPrompt } from '../../utils/task-brief.js';

const PROMPT_BUFFER_MAX_LENGTH = 4000;
const MAX_SESSION_ACTIVITY_HISTORY = 40;
const PANE_TITLE_SPINNER_CHARS = new Set(Array.from('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠁⠂⠄⡀⢀⠠⠐⠈⠉⠛⠿⣿'));
const PANE_TITLE_SPINNER_STALE_TIMEOUT = 30 * 1000;
const PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT = 30 * 1000;
const PANE_TITLE_SUPPRESSION_TIMEOUT = 5 * 60 * 1000;
const TMUX_PANE_TITLE_ROWS_CACHE_TTL = 1000;

function trimPromptBuffer(value) {
    if (typeof value !== 'string') return '';
    return value.length > PROMPT_BUFFER_MAX_LENGTH
        ? value.slice(value.length - PROMPT_BUFFER_MAX_LENGTH)
        : value;
}

function stableHash(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
}

function normalizePromptExcerpt(prompt) {
    if (typeof prompt !== 'string') return '';
    const normalized = prompt
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
    if (!normalized) return '';
    return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized;
}

export const activityServiceMethods = {
    _appendPromptBuffer(sessionId, chunk) {
        if (!sessionId || typeof chunk !== 'string' || !chunk) return;
        const previous = this.promptBuffers.get(sessionId) || '';
        this.promptBuffers.set(sessionId, trimPromptBuffer(`${previous}${chunk}`));
    },

    _backspacePromptBuffer(sessionId) {
        const previous = this.promptBuffers.get(sessionId) || '';
        if (!previous) return;
        const next = Array.from(previous).slice(0, -1).join('');
        if (next) {
            this.promptBuffers.set(sessionId, next);
            return;
        }
        this.promptBuffers.delete(sessionId);
    },

    _clearPromptBuffer(sessionId) {
        this.promptBuffers.delete(sessionId);
    },

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
    },

    async _persistSessionTaskBrief(sessionId, taskBrief, timestamp = Date.now()) {
        if (!sessionId || !taskBrief) return false;
        return this._persistSessionLiveSummary(sessionId, { taskBrief }, timestamp);
    },

    async _persistAssistantSnippet(sessionId, assistantSnippet, timestamp = Date.now()) {
        if (!sessionId || !assistantSnippet) return false;
        return this._persistSessionLiveSummary(sessionId, { assistantSnippet }, timestamp);
    },

    async _appendSessionActivityHistoryEvent(sessionId, event, timestamp = Date.now()) {
        if (!sessionId || !event?.text) return false;
        const currentState = this.stateStore.get();
        const occurredAt = event.occurredAt || new Date(timestamp).toISOString();
        const dedupeKey = event.dedupeKey || `${event.kind || 'event'}:${stableHash(`${event.text}:${occurredAt}`)}`;
        const id = event.id || `${event.kind || 'event'}-${stableHash(`${sessionId}:${dedupeKey}`)}`;
        let changed = false;

        const updatedSessions = (currentState.sessions || []).map((session) => {
            if (session.id !== sessionId) return session;
            const previousHistory = Array.isArray(session.activityHistory) ? session.activityHistory : [];
            if (previousHistory.some((item) => item?.dedupeKey === dedupeKey || item?.id === id)) {
                return session;
            }
            changed = true;
            return {
                ...session,
                activityHistory: [
                    ...previousHistory,
                    {
                        id,
                        actor: event.actor || 'user',
                        kind: event.kind || 'user_prompt',
                        text: event.text,
                        textSource: event.textSource || 'raw_prompt',
                        evidenceSource: event.evidenceSource || 'terminal_input',
                        occurredAt,
                        dedupeKey
                    }
                ].slice(-MAX_SESSION_ACTIVITY_HISTORY),
                updatedAt: occurredAt
            };
        });

        if (changed) {
            await this.stateStore.update({ ...currentState, sessions: updatedSessions });
        }
        return changed;
    },

    async _finalizePromptBuffer(sessionId, timestamp = Date.now()) {
        const prompt = (this.promptBuffers.get(sessionId) || '').trim();
        this.promptBuffers.delete(sessionId);
        if (!prompt) return null;

        const taskBrief = deriveTaskBriefFromPrompt(prompt);
        const promptExcerpt = normalizePromptExcerpt(prompt);
        if (promptExcerpt) {
            await this._appendSessionActivityHistoryEvent(sessionId, {
                actor: 'user',
                kind: 'user_prompt',
                text: promptExcerpt,
                textSource: 'raw_prompt',
                evidenceSource: 'terminal_input',
                dedupeKey: `user_prompt:${stableHash(promptExcerpt)}:${timestamp}`
            }, timestamp);
        }
        if (!taskBrief) return null;

        await this._persistSessionTaskBrief(sessionId, taskBrief, timestamp);
        this.reportActivity(sessionId, 'working', timestamp, {
            lifecycle: 'turn_started',
            eventType: 'brainbase/input-submit',
            activityKind: 'task_started',
            taskBrief,
            currentStep: '依頼を送信済み',
            latestEvidence: 'terminal input submitted'
        });
        return taskBrief;
    },

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
    },

    async restoreHookStatus() {
        const state = this.stateStore.get();
        if (state.sessions) {
            for (const session of state.sessions) {
                if (!session.hookStatus) continue;

                const normalized = this._normalizeHookData(session.hookStatus);
                if (!normalized) {
                    this.hookStatus.delete(session.id);
                    await this._persistHookStatus(session.id, null);
                    continue;
                }

                const STALE_TURN_TIMEOUT = 30 * 60 * 1000;
                const now = Date.now();
                const originalActiveTurnIds = normalized.activeTurnIds || [];
                const cleanedActiveTurnIds = originalActiveTurnIds.filter((tid) => {
                    const tidTs = this._extractTurnTimestamp(tid);
                    if (tidTs > 0 && (now - tidTs) > STALE_TURN_TIMEOUT) {
                        logger.info(`[Hook] restoreHookStatus: clearing stale turn ${tid} for ${session.id}`);
                        return false;
                    }
                    return true;
                });
                normalized.activeTurnIds = cleanedActiveTurnIds;
                let needsPersistHookStatus = cleanedActiveTurnIds.length !== originalActiveTurnIds.length;

                let hasActiveTurns = normalized.activeTurnIds.length > 0;
                const hasExplicitDone = (normalized?.lastDoneAt || 0) > 0;
                if (
                    hasActiveTurns
                    && this._isTerminalDoneEvent(normalized.lastEventType)
                    && hasExplicitDone
                    && normalized.lastDoneAt >= normalized.lastWorkingAt
                ) {
                    logger.info(`[Hook] restoreHookStatus: clearing ${normalized.activeTurnIds.length} completed turn(s) for ${session.id}`);
                    normalized.activeTurnIds = [];
                    normalized.status = 'done';
                    normalized.liveActivity = this._deriveLiveActivity({
                        status: 'done',
                        timestamp: normalized.lastDoneAt,
                        metadata: { activityKind: 'done', currentStep: '完了' },
                        currentHookData: normalized,
                        eventType: normalized.lastEventType,
                        activeTurnIds: new Set()
                    });
                    hasActiveTurns = false;
                    needsPersistHookStatus = true;
                }
                const lastActiveAt = Math.max(normalized?.lastActivityAt || 0, normalized?.lastWorkingAt || 0);
                const isStaleWorking = !hasActiveTurns
                    && !hasExplicitDone
                    && lastActiveAt > 0
                    && (Date.now() - lastActiveAt > 60 * 60 * 1000);

                if (!isStaleWorking) {
                    this.hookStatus.set(session.id, normalized);
                    if (needsPersistHookStatus) {
                        await this._persistHookStatus(session.id, normalized);
                    }
                    continue;
                }

                this.hookStatus.delete(session.id);
                await this._persistHookStatus(session.id, null);
            }
        }
    },

    _buildStatusForSession(hookData) {
        const WORKING_TIMEOUT = 5 * 60 * 1000;
        const now = Date.now();
        const normalized = this._normalizeHookData(hookData);
        if (!normalized) return null;

        this._normalizeCompletedActiveTurns(normalized);

        const activeTurnCount = normalized.activeTurnIds.length;
        const hasWorking = normalized.lastWorkingAt > 0;
        const hasDone = normalized.lastDoneAt > 0;
        if (!hasWorking && !hasDone && activeTurnCount === 0) return null;

        const lastActiveAt = Math.max(normalized.lastActivityAt, normalized.lastWorkingAt);
        const isWorkingStale = lastActiveAt > 0 && (now - lastActiveAt > WORKING_TIMEOUT);
        if (isWorkingStale && activeTurnCount === 0 && !hasDone) return null;
        const hasOpenWorking = normalized.lastWorkingAt > normalized.lastDoneAt;
        if (this._isTransportReadyEvent(normalized.lastEventType) && activeTurnCount === 0 && !hasOpenWorking) {
            return null;
        }
        if (isWorkingStale && (activeTurnCount > 0 || hasOpenWorking)) return null;
        const isWorking = (
            activeTurnCount > 0
            || hasOpenWorking
        );
        // done状態はタイムアウトしない（明示的にclearDoneStatusで消す）
        const isDone = !isWorking && activeTurnCount === 0 && hasDone;

        if (!isWorking && !isDone) return null;

        const snapshot = this._deriveSnapshotFields({
            hookData: normalized,
            isWorking,
            isDone,
            activeTurnCount
        });

        return {
            state: snapshot.state,
            confidence: snapshot.confidence,
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
    },

    getSessionStatus() {
        const status = {};
        for (const [sessionId, hookData] of this.hookStatus) {
            const entry = this._buildStatusForSession(hookData);
            if (entry) status[sessionId] = entry;
        }
        for (const [sessionId, entry] of Object.entries(this._getPaneTitleActivityStatuses())) {
            if (this._shouldSuppressPaneTitleActivity(sessionId)) {
                continue;
            }
            if (!status[sessionId]) {
                status[sessionId] = entry;
            }
        }
        return status;
    },

    _getPaneTitleActivityStatuses() {
        const rows = this._listTmuxPaneTitles();
        const now = this._now();
        const cache = this._getPaneTitleActivityCache();
        const seenSessionIds = new Set();
        const status = {};

        for (const row of rows) {
            const [sessionId, paneTitle = ''] = row.split('\t');
            if (!sessionId?.startsWith('session-')) continue;
            seenSessionIds.add(sessionId);
            const firstTitleChar = Array.from(paneTitle.trim())[0] || '';
            if (!PANE_TITLE_SPINNER_CHARS.has(firstTitleChar)) {
                cache.delete(sessionId);
                continue;
            }

            const previous = cache.get(sessionId);
            const titleChanged = !previous || previous.paneTitle !== paneTitle;
            const entry = {
                paneTitle,
                firstSeenAt: previous?.firstSeenAt || now,
                lastChangedAt: titleChanged ? now : previous.lastChangedAt,
                observedAt: now
            };
            cache.set(sessionId, entry);

            if (!titleChanged && now - entry.lastChangedAt > PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT) {
                continue;
            }

            const activityAt = entry.lastChangedAt;
            status[sessionId] = {
                state: 'running',
                confidence: 'fallback',
                isWorking: true,
                isDone: false,
                lastWorkingAt: activityAt,
                lastDoneAt: 0,
                lastActivityAt: activityAt,
                lastEventType: 'tmux-pane-title-spinner',
                liveActivity: {
                    activityKind: 'reasoning',
                    taskBrief: null,
                    assistantSnippet: null,
                    currentStep: '処理中',
                    latestEvidence: null,
                    statusTone: 'working',
                    updatedAt: activityAt,
                    assistantSnippetUpdatedAt: 0
                },
                activeTurnCount: 1,
                timestamp: activityAt
            };
        }

        for (const [sessionId, entry] of cache) {
            if (!seenSessionIds.has(sessionId) || now - entry.observedAt > PANE_TITLE_SPINNER_STALE_TIMEOUT) {
                cache.delete(sessionId);
            }
        }

        return status;
    },

    _listTmuxPaneTitles() {
        const now = this._now();
        if (this.tmuxPaneTitleRowsCache?.expiresAt > now) {
            return this.tmuxPaneTitleRowsCache.rows;
        }

        const rows = this._readTmuxPaneTitles();
        this.tmuxPaneTitleRowsCache = {
            rows,
            expiresAt: now + TMUX_PANE_TITLE_ROWS_CACHE_TTL
        };
        return rows;
    },

    _readTmuxPaneTitles() {
        const candidates = [
            process.env.BRAINBASE_TMUX_BIN,
            process.env.TMUX_BIN,
            '/usr/local/bin/tmux',
            '/opt/homebrew/bin/tmux',
            'tmux'
        ].filter(Boolean);

        const seen = new Set();
        const tmuxBins = candidates.filter((candidate) => {
            if (seen.has(candidate)) return false;
            seen.add(candidate);
            return true;
        });

        for (const tmuxBin of tmuxBins) {
            try {
                const output = execFileSync(tmuxBin, ['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}'], {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        LANG: process.env.LANG || 'en_US.UTF-8',
                        LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
                        LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8'
                    },
                    timeout: 2000
                });
                return output.split('\n').filter(Boolean);
            } catch {
                // Try the next tmux binary candidate.
            }
        }

        return [];
    },

    _getPaneTitleActivityCache() {
        if (!this.paneTitleActivityCache) {
            this.paneTitleActivityCache = new Map();
        }
        return this.paneTitleActivityCache;
    },

    _now() {
        return Date.now();
    },

    reportActivity(sessionId, status, reportedAt, metadata = {}) {
        if (status !== 'working' && status !== 'done') {
            logger.warn(`[Hook] Ignoring invalid status for ${sessionId}: ${status}`);
            return;
        }

        const timestamp = this._coerceTimestamp(reportedAt);
        const lifecycle = typeof metadata.lifecycle === 'string' ? metadata.lifecycle : '';
        const eventType = typeof metadata.eventType === 'string' ? metadata.eventType : '';
        const turnId = typeof metadata.turnId === 'string' ? metadata.turnId.trim() : '';
        logger.debug(`[Hook] Received status update from ${sessionId}: ${status} @ ${timestamp} (${lifecycle || 'legacy'}${turnId ? `:${turnId}` : ''})`);

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
        const previousEventType = currentHookData.lastEventType || null;
        let lastEventType = eventType || currentHookData.lastEventType || null;
        const activeTurnIds = new Set(currentHookData.activeTurnIds);
        const staleCodexPtyTurn = this._isStaleCodexPtyTurn(turnId, timestamp);
        const strongWorkingSignal = this._isStrongWorkingSignal({ status, lifecycle, eventType, metadata });
        let ignoredStaleDoneHeartbeat = false;
        if (strongWorkingSignal || (lifecycle === 'turn_started' && !staleCodexPtyTurn)) {
            this.paneTitleSuppressedSessionIds?.delete(sessionId);
        }
        const isExplicitTerminalDone = lifecycle === 'terminal_done' || lifecycle === 'session_completed';

        if (lifecycle === 'turn_started') {
            const isOutOfOrderStartAfterDone = lastDoneAt > 0
                && timestamp < lastDoneAt
                && lastDoneAt >= lastWorkingAt;
            if (isOutOfOrderStartAfterDone) {
                logger.info(`[Hook] Ignoring out-of-order turn_started ${turnId || '(no turnId)'} for ${sessionId}; done=${lastDoneAt}, started=${timestamp}`);
                return;
            }
            if (turnId && !staleCodexPtyTurn) {
                activeTurnIds.add(turnId);
            }
            if (!staleCodexPtyTurn) {
                lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            } else {
                logger.info(`[Hook] Ignoring stale Codex PTY turn_started ${turnId} for ${sessionId}`);
                if (lastDoneAt > 0 && activeTurnIds.size === 0 && this._canStaleCodexPtyDemote(currentHookData)) {
                    ignoredStaleDoneHeartbeat = true;
                    lastEventType = currentHookData.lastEventType || lastEventType;
                    lastActivityAt = currentHookData.lastActivityAt || lastActivityAt;
                    lastWorkingAt = Math.min(lastWorkingAt, lastDoneAt);
                }
            }
        } else if (isExplicitTerminalDone) {
            if (activeTurnIds.size > 0) {
                logger.info(`[Hook] terminal done for ${sessionId}; clearing ${activeTurnIds.size} active turn(s)`);
                activeTurnIds.clear();
            }
            lastDoneAt = Math.max(lastDoneAt, timestamp);
        } else if (lifecycle === 'turn_completed') {
            if (turnId) {
                const hadTurnId = activeTurnIds.delete(turnId);
                // 残留turnのクリア: Claudeフォーマット(claude-{ts}-{random})はタイムスタンプ比較する。
                // それ以外は明示されたturnIdだけ閉じ、未知IDの場合だけ残留turnを安全側で全クリアする。
                const completedTs = this._extractTurnTimestamp(turnId);
                if (completedTs > 0) {
                    for (const tid of [...activeTurnIds]) {
                        const tidTs = this._extractTurnTimestamp(tid);
                        if ((tidTs > 0 && tidTs <= completedTs) || tidTs <= 0) {
                            logger.info(`[Hook] Clearing stale turn ${tid} (older than completed ${turnId}) for ${sessionId}`);
                            activeTurnIds.delete(tid);
                        }
                    }
                } else if (!hadTurnId && activeTurnIds.size > 0) {
                    logger.info(`[Hook] turn_completed for unknown non-claude turnId ${turnId} on ${sessionId}; clearing ${activeTurnIds.size} stale turn(s)`);
                    activeTurnIds.clear();
                }
            } else {
                const ptyTurnIds = [...activeTurnIds].filter((tid) => tid.startsWith('codex-pty-'));
                for (const tid of ptyTurnIds) {
                    logger.info(`[Hook] turn_completed without turnId for ${sessionId}; clearing Codex PTY fallback turn ${tid}`);
                    activeTurnIds.delete(tid);
                }
            }

            if (!turnId && activeTurnIds.size === 1) {
                logger.info(`[Hook] turn_completed without turnId for ${sessionId}; clearing the only active turn`);
                activeTurnIds.clear();
            } else if (!turnId && activeTurnIds.size > 1) {
                logger.info(`[Hook] turn_completed without turnId for ${sessionId}; keeping ${activeTurnIds.size} active turns to avoid premature done`);
            }

            lastDoneAt = Math.max(lastDoneAt, timestamp);
        } else if (lifecycle === 'heartbeat') {
            // heartbeat時に30分以上古い残留turnをクリア
            const STALE_TURN_TIMEOUT = 30 * 60 * 1000;
            let clearedStaleTurn = false;
            for (const tid of [...activeTurnIds]) {
                const tidTs = this._extractTurnTimestamp(tid);
                if (tidTs > 0 && (timestamp - tidTs) > STALE_TURN_TIMEOUT) {
                    logger.info(`[Hook] Clearing stale turn ${tid} (${Math.round((timestamp - tidTs) / 60000)}min old) for ${sessionId}`);
                    activeTurnIds.delete(tid);
                    clearedStaleTurn = true;
                }
            }
            const canStaleCodexPtyDemote = this._canStaleCodexPtyDemote({ ...currentHookData, lastEventType: previousEventType });
            if (staleCodexPtyTurn && activeTurnIds.size === 0 && lastDoneAt > 0 && canStaleCodexPtyDemote) {
                ignoredStaleDoneHeartbeat = true;
                lastEventType = currentHookData.lastEventType || lastEventType;
                lastActivityAt = currentHookData.lastActivityAt || lastActivityAt;
                lastWorkingAt = Math.min(lastWorkingAt, lastDoneAt);
            } else if (strongWorkingSignal) {
                lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            } else if ((clearedStaleTurn || staleCodexPtyTurn) && !canStaleCodexPtyDemote) {
                lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            } else if (activeTurnIds.size > 0 || (!clearedStaleTurn && !staleCodexPtyTurn && lastWorkingAt > lastDoneAt)) {
                lastWorkingAt = Math.max(lastWorkingAt, timestamp);
            } else if (
                (clearedStaleTurn || staleCodexPtyTurn)
                && lastDoneAt > 0
                && activeTurnIds.size === 0
                && canStaleCodexPtyDemote
            ) {
                lastWorkingAt = Math.min(lastWorkingAt, lastDoneAt);
            }
        } else if (status === 'working') {
            lastWorkingAt = Math.max(lastWorkingAt, timestamp);
        } else {
            lastDoneAt = Math.max(lastDoneAt, timestamp);
            if (this._isTerminalDoneEvent(lastEventType) && activeTurnIds.size > 0) {
                const completedTs = this._extractTurnTimestamp(turnId) || timestamp;
                for (const tid of [...activeTurnIds]) {
                    if (!this._isCodexPtyTurnId(tid)) continue;
                    const tidTs = this._extractTurnTimestamp(tid);
                    if (tidTs <= 0 || tidTs <= completedTs) {
                        logger.info(`[Hook] Clearing active turn ${tid} for terminal done event ${lastEventType} on ${sessionId}`);
                        activeTurnIds.delete(tid);
                    }
                }
            }
        }

        const effectiveStatus = activeTurnIds.size > 0 || lastWorkingAt > lastDoneAt ? 'working' : 'done';
        const liveActivity = ignoredStaleDoneHeartbeat
            ? this._deriveLiveActivity({
                status: effectiveStatus,
                timestamp,
                metadata: { activityKind: 'done', currentStep: '完了' },
                currentHookData,
                eventType: lastEventType,
                activeTurnIds
            })
            : this._deriveLiveActivity({
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

        if (typeof this._activityWsBroadcast === 'function') {
            const statusForClient = this.getSessionStatus()[sessionId] || null;
            this._activityWsBroadcast(sessionId, statusForClient);
        }

        const reportedTaskBrief = typeof liveActivity?.taskBrief === 'string' ? liveActivity.taskBrief : null;
        const reportedAssistantSnippet = typeof liveActivity?.assistantSnippet === 'string' ? liveActivity.assistantSnippet : null;
        if (reportedTaskBrief || reportedAssistantSnippet) {
            this._persistSessionLiveSummary(sessionId, {
                taskBrief: reportedTaskBrief,
                assistantSnippet: reportedAssistantSnippet
            }, timestamp).catch((error) => {
                logger.warn(`[Hook] Failed to persist live summary for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    },

    clearDoneStatus(sessionId) {
        const hadHookStatus = this.hookStatus.has(sessionId);
        const timestamp = Date.now();
        const suppressedStatus = {
            status: 'idle',
            timestamp,
            lastWorkingAt: 0,
            lastDoneAt: 0,
            lastActivityAt: 0,
            lastEventType: 'done-read',
            activeTurnIds: [],
            paneTitleSuppressed: true,
            liveActivity: null
        };
        this.paneTitleSuppressedSessionIds?.add(sessionId);
        this.hookStatus.set(sessionId, suppressedStatus);
        this._persistHookStatus(sessionId, suppressedStatus, timestamp);
        if (hadHookStatus && typeof this._activityWsBroadcast === 'function') {
            const statusForClient = this.getSessionStatus()[sessionId] || null;
            this._activityWsBroadcast(sessionId, statusForClient);
        }
    },

    clearWorking(sessionId) {
        const normalized = this._normalizeHookData(this.hookStatus.get(sessionId));
        if (normalized && (normalized.activeTurnIds.length > 0 || (normalized.lastWorkingAt > normalized.lastDoneAt && normalized.lastWorkingAt > 0))) {
            this.hookStatus.delete(sessionId);
            this._persistHookStatus(sessionId, null);
        }
    },

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
            paneTitleSuppressed: hookData.paneTitleSuppressed === true,
            liveActivity
        };
    },

    _deriveSnapshotFields({ hookData, isWorking, isDone, activeTurnCount }) {
        if (isDone) {
            return { state: 'done-unread', confidence: 'explicit' };
        }

        if (!isWorking) {
            return { state: 'idle', confidence: 'explicit' };
        }

        const liveActivity = hookData?.liveActivity || {};
        const activityKind = liveActivity.activityKind || '';
        const statusTone = liveActivity.statusTone || '';

        if (activityKind === 'waiting_input' || statusTone === 'waiting') {
            return { state: 'waiting', confidence: 'explicit' };
        }

        if (activityKind === 'task_started' && activeTurnCount > 0) {
            return { state: 'starting', confidence: 'explicit' };
        }

        return { state: 'running', confidence: 'explicit' };
    },

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
    },

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
    },

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
    },

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
    },

    async _persistHookStatus(sessionId, hookStatusData, timestamp = Date.now()) {
        const MAX_RETRIES = 3;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const updatedAt = new Date(timestamp).toISOString();
                if (typeof this.stateStore.patchSession === 'function') {
                    await this.stateStore.patchSession(sessionId, hookStatusData
                        ? { hookStatus: hookStatusData, updatedAt }
                        : { hookStatus: null, updatedAt });
                    return;
                }

                const currentState = this.stateStore.get();
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

                    return {
                        ...session,
                        hookStatus: null,
                        updatedAt
                    };
                });

                await this.stateStore.update({ ...currentState, sessions: updatedSessions });
                return;
            } catch (err) {
                if (attempt < MAX_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, 50 * (attempt + 1)));
                    continue;
                }
                logger.warn(`[Hook] _persistHookStatus failed after ${MAX_RETRIES} retries for ${sessionId}: ${err.message}`);
            }
        }
    },

    _shouldSuppressPaneTitleActivity(sessionId) {
        if (!sessionId) return false;

        const hookData = this._normalizeHookData(this.hookStatus.get(sessionId));
        if (this.paneTitleSuppressedSessionIds?.has(sessionId)) {
            if (!hookData || this._isPaneTitleSuppressionFresh(hookData)) return true;
            this.paneTitleSuppressedSessionIds.delete(sessionId);
        }

        if (this._isPaneTitleSuppressionFresh(hookData)) return true;

        const state = this.stateStore?.get?.() || {};
        const session = (state.sessions || []).find((entry) => entry.id === sessionId);
        const storedHookData = this._normalizeHookData(session?.hookStatus);
        return this._isPaneTitleSuppressionFresh(storedHookData);
    },

    _isPaneTitleSuppressionFresh(hookData) {
        if (hookData?.paneTitleSuppressed !== true) return false;
        const timestamp = Number.isFinite(hookData.timestamp) ? hookData.timestamp : 0;
        if (timestamp <= 0) return true;
        return this._now() - timestamp < PANE_TITLE_SUPPRESSION_TIMEOUT;
    },

    _normalizeCompletedActiveTurns(hookData) {
        if (!hookData || !Array.isArray(hookData.activeTurnIds) || hookData.activeTurnIds.length === 0) return hookData;
        if (!this._isTerminalDoneEvent(hookData.lastEventType)) return hookData;
        if ((hookData.lastDoneAt || 0) <= 0 || hookData.lastDoneAt < (hookData.lastWorkingAt || 0)) return hookData;
        if (!hookData.activeTurnIds.every((turnId) => this._isCodexPtyTurnId(turnId))) return hookData;

        hookData.activeTurnIds = [];
        hookData.status = 'done';
        hookData.liveActivity = this._deriveLiveActivity({
            status: 'done',
            timestamp: hookData.lastDoneAt,
            metadata: { activityKind: 'done', currentStep: '完了' },
            currentHookData: hookData,
            eventType: hookData.lastEventType,
            activeTurnIds: new Set()
        });
        return hookData;
    },

    _isCodexPtyTurnId(turnId) {
        return typeof turnId === 'string'
            && (turnId.startsWith('codex-pty-turn-') || turnId.startsWith('codex-pty-session-'));
    },

    _isTerminalDoneEvent(eventType) {
        return [
            'agent-turn-complete',
            'assistant-message-complete',
            'assistant-response-complete',
            'task_complete',
            'codex/event/task_complete',
            'codex/hook/Stop',
            'turn/completed'
        ].includes(eventType);
    },

    _isTransportReadyEvent(eventType) {
        return eventType === 'codex/pty-shim-ready';
    },

    _coerceTimestamp(reportedAt) {
        const value = Number(reportedAt);
        return Number.isFinite(value) && value > 0 ? value : Date.now();
    },

    _extractTurnTimestamp(turnId) {
        if (typeof turnId !== 'string') return 0;
        // turnId formats: "claude-{timestamp}-{random}", "codex-pty-session-{timestamp}-{pid}"
        const match = turnId.match(/^claude-(\d+)-/)
            || turnId.match(/^codex-pty-turn-(\d{13})-/)
            || turnId.match(/^codex-pty-session-(\d{13})-/);
        return match ? Number(match[1]) : 0;
    },

    _isStaleCodexPtyTurn(turnId, timestamp = Date.now()) {
        if (typeof turnId !== 'string' || !turnId.startsWith('codex-pty-session-')) return false;
        const turnTimestamp = this._extractTurnTimestamp(turnId);
        if (turnTimestamp <= 0) return false;
        return timestamp - turnTimestamp > 30 * 60 * 1000;
    },

    _isStrongWorkingSignal({ status, lifecycle, eventType, metadata = {} } = {}) {
        if (status !== 'working') return false;
        const normalizedEventType = typeof eventType === 'string' ? eventType : '';
        const activityKind = typeof metadata.activityKind === 'string' ? metadata.activityKind : '';
        if (normalizedEventType.startsWith('codex/hook/')) {
            return lifecycle === 'turn_started' || lifecycle === 'heartbeat';
        }
        return [
            'task_started',
            'running_command',
            'editing_file'
        ].includes(activityKind);
    },

    _canStaleCodexPtyDemote(hookData = {}) {
        const previousEventType = typeof hookData.lastEventType === 'string' ? hookData.lastEventType : '';
        if (previousEventType.startsWith('codex/hook/')) return false;
        if (hookData.status === 'done' || (hookData.lastDoneAt || 0) >= (hookData.lastWorkingAt || 0)) return true;
        const activityKind = hookData.liveActivity?.activityKind || '';
        const latestEvidence = hookData.liveActivity?.latestEvidence || '';
        const currentStep = hookData.liveActivity?.currentStep || '';
        if (latestEvidence && (activityKind === 'reasoning' || currentStep === '処理中')) return false;
        return ![
            'task_started',
            'running_command',
            'editing_file'
        ].includes(activityKind);
    }
};

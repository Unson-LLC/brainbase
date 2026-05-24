/**
 * ConversationLinker
 * Claude Code / Codex CLI の会話ログを brainbase セッションに紐付ける
 *
 * 処理フロー:
 * 1. state.json の全セッションを取得
 * 2. 各セッションの worktree.path から Claude Code / Codex のログディレクトリを算出
 * 3. sessions-index.json / codex history.jsonl を走査してマッチング
 * 4. state.json の conversationSummary フィールドを更新
 */
import fs from 'fs/promises';
import { existsSync, readFileSync, createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { logger } from '../utils/logger.js';

const JAPANESE_TEXT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;

function sanitizeSnippet(value, maxLength = 120) {
    if (typeof value !== 'string') return null;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || !JAPANESE_TEXT_PATTERN.test(normalized)) return null;
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength - 1)}…`
        : normalized;
}

function asFiniteNumber(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeCodexTokenUsage(info, updatedAt = null) {
    const contextWindow = asFiniteNumber(info?.model_context_window);
    const lastTotalTokens = asFiniteNumber(info?.last_token_usage?.total_tokens);
    if (!contextWindow || !lastTotalTokens) return null;

    const remainingTokens = Math.max(0, contextWindow - lastTotalTokens);
    const usedPercent = Math.min(100, Math.max(0, (lastTotalTokens / contextWindow) * 100));
    const remainingPercent = Math.max(0, 100 - usedPercent);

    return {
        source: 'codex',
        contextWindow,
        usedTokens: lastTotalTokens,
        remainingTokens,
        usedPercent,
        remainingPercent,
        updatedAt,
        lastTokenUsage: info.last_token_usage || null,
        totalTokenUsage: info.total_token_usage || null
    };
}

function normalizePath(value) {
    return typeof value === 'string' && value.trim()
        ? value.replace(/\/+$/, '')
        : null;
}

function extractCodexResumeId(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return match ? match[1] : null;
}

export class ConversationLinker {
    /**
     * @param {Object} options
     * @param {Object} options.stateStore - StateStore インスタンス
     * @param {Object} [options.sessionManager] - 互換用 SessionManager インスタンス
     * @param {Object} [options.workspaceService] - workspace service
     */
    constructor({ stateStore, sessionManager = null, workspaceService = null }) {
        this.stateStore = stateStore;
        this.sessionManager = sessionManager;
        this.workspaceService = workspaceService || sessionManager;
        this.homeDir = os.homedir();
        this.claudeProjectsDir = path.join(this.homeDir, '.claude', 'projects');
        this.codexSessionsDir = path.join(this.homeDir, '.codex', 'sessions');
        this._intervalTimer = null;
        this._isLinking = false;
        this._codexIndexCache = null;
        this._codexIndexCacheTime = 0;
        this._codexFileMetaCache = new Map();
        this._codexFileBySessionId = new Map();
        this._linkCursor = 0;
    }

    /**
     * worktree パスから Claude Code のプロジェクトディレクトリ名を算出
     * /workspace/.worktrees/session-XXX-brainbase/
     * → -workspace--worktrees-session-XXX-brainbase
     *
     * Claude Code のエンコーディング: / → - 、先頭 / は - に置換
     * 連続の - はそのまま（例: .worktrees → --worktrees は正常）
     *
     * @param {string} worktreePath - worktree パス
     * @returns {string} エンコードされたディレクトリ名
     */
    encodePathForClaude(worktreePath) {
        if (!worktreePath) return null;
        // Remove trailing slash
        const normalized = worktreePath.replace(/\/+$/, '');
        // Claude Code encodes paths by replacing both / and . with -
        return normalized.replace(/[/.]/g, '-');
    }

    /**
     * Claude Code の sessions-index.json を読み込む
     * @param {string} claudeProjectDir - プロジェクトディレクトリのフルパス
     * @returns {Promise<Array>} セッション一覧
     */
    async readClaudeSessionsIndex(claudeProjectDir) {
        const indexPath = path.join(claudeProjectDir, 'sessions-index.json');
        try {
            const content = await fs.readFile(indexPath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return [];
        }
    }

    /**
     * Claude Code の jsonl ファイルからメッセージ数を数える（軽量版）
     * 全行読まず、行数のみカウント
     * @param {string} jsonlPath - jsonl ファイルパス
     * @returns {Promise<{messageCount: number, sizeBytes: number, lastActivity: string|null}>}
     */
    async getClaudeConversationStats(jsonlPath) {
        let stream;
        try {
            const stat = await fs.stat(jsonlPath);
            const sizeBytes = stat.size;
            const lastActivity = stat.mtime.toISOString();

            // Count lines (each line = one message/event)
            let messageCount = 0;
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            try {
                for await (const _line of rl) {
                    messageCount++;
                }
            } finally {
                rl.close();
                stream.destroy();
            }

            return { messageCount, sizeBytes, lastActivity };
        } catch {
            return { messageCount: 0, sizeBytes: 0, lastActivity: null };
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    /**
     * Claude Code の jsonl ファイルから最初のユーザーメッセージ（firstPrompt）を取得
     * @param {string} jsonlPath - jsonl ファイルパス
     * @returns {Promise<string|null>}
     */
    async getFirstPrompt(jsonlPath) {
        let stream;
        try {
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            try {
                for await (const line of rl) {
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'user' && data.message?.content) {
                            const content = data.message.content;
                            const text = typeof content === 'string'
                                ? content
                                : Array.isArray(content)
                                    ? content.find(c => typeof c === 'string' || c?.text)?.text || content[0]?.text || ''
                                    : '';
                            return text.substring(0, 100);
                        }
                    } catch {
                        // Skip malformed lines
                    }
                }
                return null;
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return null;
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    async getLastClaudeAssistantSnippet(jsonlPath) {
        let stream;
        let lastSnippet = null;
        try {
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            try {
                for await (const line of rl) {
                    try {
                        const data = JSON.parse(line);
                        if (!['assistant', 'assistant_message'].includes(data.type)) continue;
                        const content = data.message?.content ?? data.content;
                        const text = typeof content === 'string'
                            ? content
                            : Array.isArray(content)
                                ? content
                                    .map((item) => typeof item === 'string' ? item : item?.text)
                                    .filter(Boolean)
                                    .join(' ')
                                : '';
                        const snippet = sanitizeSnippet(text);
                        if (snippet) lastSnippet = snippet;
                    } catch {
                        // Skip malformed lines
                    }
                }
                return lastSnippet;
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return null;
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    async getLastCodexAssistantSnippet(jsonlPath) {
        let stream;
        let lastSnippet = null;
        try {
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            const extractText = (node) => {
                if (typeof node === 'string') return node;
                if (Array.isArray(node)) {
                    return node
                        .map((item) => extractText(item))
                        .filter(Boolean)
                        .join(' ');
                }
                if (node && typeof node === 'object') {
                    for (const key of ['text', 'delta', 'message', 'summary']) {
                        const snippet = extractText(node[key]);
                        if (snippet) return snippet;
                    }
                    return extractText(node.content);
                }
                return '';
            };

            try {
                for await (const line of rl) {
                    try {
                        const data = JSON.parse(line);
                        const eventType = data.type || data.method || data.event?.type || data.notification?.type || data.params?.type;
                        if (![
                            'assistant-message',
                            'assistant-response',
                            'assistant-message-complete',
                            'assistant-response-complete',
                            'item/agentMessage/delta',
                            'item/assistantMessage/delta',
                            'agent_message_delta'
                        ].includes(eventType)) {
                            continue;
                        }
                        const snippet = sanitizeSnippet(extractText(data));
                        if (snippet) lastSnippet = snippet;
                    } catch {
                        // Skip malformed lines
                    }
                }
                return lastSnippet;
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return null;
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    /**
     * Codex CLI のセッションファイルから cwd を読み取る
     * jsonl の最初の行に session_meta があり、cwd が含まれる
     * @param {string} jsonlPath - jsonl ファイルパス
     * @returns {Promise<string|null>} cwd
     */
    async getCodexSessionCwd(jsonlPath) {
        const meta = await this.getCodexSessionMeta(jsonlPath);
        return meta.cwd || null;
    }

    async getCodexSessionMeta(jsonlPath) {
        let stream;
        try {
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            try {
                for await (const line of rl) {
                    try {
                        const data = JSON.parse(line);
                        if (data.type === 'session_meta' || data.session_meta) {
                            const meta = data.session_meta || data.payload || data;
                            const source = meta.source;
                            const subagent = source && typeof source === 'object'
                                ? source.subagent
                                : null;
                            return {
                                id: meta.id || meta.session_id || extractCodexResumeId(path.basename(jsonlPath, '.jsonl')),
                                cwd: meta.cwd || null,
                                threadSource: meta.thread_source || null,
                                agentRole: meta.agent_role || null,
                                agentNickname: meta.agent_nickname || null,
                                parentThreadId: subagent?.thread_spawn?.parent_thread_id || null
                            };
                        }
                    } catch {
                        // Skip malformed lines
                    }
                    // Only check first few lines
                    break;
                }
                return {
                    id: extractCodexResumeId(path.basename(jsonlPath, '.jsonl')),
                    cwd: null,
                    threadSource: null,
                    agentRole: null,
                    agentNickname: null,
                    parentThreadId: null
                };
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return {
                id: extractCodexResumeId(path.basename(jsonlPath, '.jsonl')),
                cwd: null,
                threadSource: null,
                agentRole: null,
                agentNickname: null,
                parentThreadId: null
            };
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    /**
     * Codex CLI の token_count イベントから現在のコンテキスト残量を取得する
     * @param {string} jsonlPath - jsonl ファイルパス
     * @returns {Promise<Object|null>} token usage summary
     */
    async getCodexTokenUsage(jsonlPath) {
        let stream;
        let latestTokenUsage = null;
        try {
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

            try {
                for await (const line of rl) {
                    try {
                        const data = JSON.parse(line);
                        if (data.type !== 'event_msg' || data.payload?.type !== 'token_count') continue;

                        const tokenUsage = normalizeCodexTokenUsage(data.payload.info || {}, data.timestamp || null);
                        if (tokenUsage) latestTokenUsage = tokenUsage;
                    } catch {
                        // Skip malformed lines
                    }
                }
                return latestTokenUsage;
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return null;
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    async getCodexSessionId(jsonlPath) {
        const meta = await this.getCodexSessionMeta(jsonlPath);
        return meta.id || extractCodexResumeId(path.basename(jsonlPath, '.jsonl'));
    }

    async getCodexConversationStats(jsonlPath) {
        let stream;
        try {
            const stat = await fs.stat(jsonlPath);
            stream = createReadStream(jsonlPath);
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            let messageCount = 0;

            try {
                for await (const line of rl) {
                    if (line.trim()) messageCount++;
                }
                return { messageCount, sizeBytes: stat.size, lastActivity: stat.mtime.toISOString() };
            } finally {
                rl.close();
                stream.destroy();
            }
        } catch {
            return { messageCount: 0, sizeBytes: 0, lastActivity: null };
        } finally {
            if (stream && !stream.destroyed) stream.destroy();
        }
    }

    async _buildCodexConversationFromFile(codexFile) {
        const uuid = path.basename(codexFile, '.jsonl').replace(/^rollout-/, '');
        const stats = await this.getCodexConversationStats(codexFile);
        const meta = await this.getCodexSessionMeta(codexFile);
        const tokenUsage = await this.getCodexTokenUsage(codexFile);
        return {
            engine: 'codex',
            conversationId: uuid,
            resumeId: meta.id || extractCodexResumeId(uuid),
            firstPrompt: null,
            lastActivity: stats.lastActivity,
            messageCount: stats.messageCount,
            tokenUsage,
            threadSource: meta.threadSource,
            agentRole: meta.agentRole,
            agentNickname: meta.agentNickname,
            parentThreadId: meta.parentThreadId,
            _filePath: codexFile
        };
    }

    async _resolveCodexMainConversation(conversation, codexConversations = []) {
        if (!conversation || conversation.engine !== 'codex') return conversation;
        if (conversation.threadSource !== 'subagent' || !conversation.parentThreadId) return conversation;

        const inScopeParent = codexConversations.find((candidate) =>
            candidate.resumeId === conversation.parentThreadId
            || extractCodexResumeId(candidate.conversationId) === conversation.parentThreadId
        );
        if (inScopeParent) return inScopeParent;

        const parentFile = this._codexFileBySessionId.get(conversation.parentThreadId);
        if (!parentFile || !existsSync(parentFile)) return conversation;
        try {
            return await this._buildCodexConversationFromFile(parentFile);
        } catch {
            return conversation;
        }
    }

    async _getSessionWorkspacePaths(session) {
        const paths = [];
        const addPath = (candidate) => {
            const normalized = normalizePath(candidate);
            if (normalized && !paths.includes(normalized)) {
                paths.push(normalized);
            }
        };

        const activePath = this.workspaceService
            ? await this.workspaceService.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            : null;
        addPath(activePath);
        addPath(session.worktree?.path);
        addPath(session.path);

        for (const entry of session.workspaceHistory || []) {
            addPath(entry?.path);
        }

        return paths;
    }

    /**
     * 全セッションの会話ログ紐付けを実行
     * @returns {Promise<{updated: number, total: number, errors: string[]}>}
     */
    async linkAll(options = {}) {
        const { limit = Infinity } = options;
        if (this._isLinking) {
            logger.warn('[ConversationLinker] linkAll already in progress, skipping');
            return { updated: 0, total: 0, errors: [], skipped: true };
        }
        this._isLinking = true;
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            const errors = [];
            let updated = 0;
            const startIndex = Number.isFinite(limit) && sessions.length > 0
                ? Math.min(this._linkCursor, sessions.length - 1)
                : 0;
            const targetSessions = Number.isFinite(limit)
                ? [
                    ...sessions.slice(startIndex, startIndex + limit),
                    ...sessions.slice(0, Math.max(0, startIndex + limit - sessions.length))
                ].slice(0, limit)
                : sessions;

            logger.info(`[ConversationLinker] Starting linkAll for ${targetSessions.length}/${sessions.length} session(s)...`);

            // Build Codex session index (cwd → files) once
            const codexIndex = await this._buildCodexIndex();

            const updatedSessions = [];

            for (const session of targetSessions) {
                try {
                    const summary = await this._linkSession(session, codexIndex);
                    if (summary) {
                        updatedSessions.push({
                            ...session,
                            ...(summary.lastAssistantSnippet ? { lastAssistantSnippet: summary.lastAssistantSnippet } : {}),
                            ...(summary.lastAssistantSnippetAt ? { lastAssistantSnippetAt: summary.lastAssistantSnippetAt } : {}),
                            ...(summary.codexThreadId ? { codexThreadId: summary.codexThreadId } : {}),
                            ...(summary.codexThreadId ? { bindingSource: 'conversation-linker', bindingUpdatedAt: summary.linkedAt } : {}),
                            conversationSummary: summary
                        });
                        updated++;
                    } else {
                        updatedSessions.push(session);
                    }
                } catch (err) {
                    errors.push(`${session.id}: ${err.message}`);
                    updatedSessions.push(session);
                }
            }

            // Save updated state against the latest authoritative session list.
            // linkAll can run for several seconds; if we write back the stale
            // snapshot captured at the beginning, newer sessions disappear.
            if (updated > 0) {
                const updatedMap = new Map(updatedSessions.map((session) => [session.id, session]));
                await this.stateStore.mutateSessions((latestSessions) => {
                    const mergedSessions = latestSessions.map((session) => updatedMap.get(session.id) || session);

                    for (const session of updatedSessions) {
                        if (!latestSessions.some((existing) => existing.id === session.id)) {
                            mergedSessions.push(session);
                        }
                    }

                    return mergedSessions;
                });
                logger.info(`[ConversationLinker] Updated ${updated}/${targetSessions.length} session(s)`);
            } else {
                logger.info(`[ConversationLinker] No updates needed`);
            }

            if (errors.length > 0) {
                logger.warn(`[ConversationLinker] ${errors.length} error(s):`, errors.slice(0, 5));
            }

            if (Number.isFinite(limit) && sessions.length > 0) {
                this._linkCursor = (startIndex + targetSessions.length) % sessions.length;
            }

            return { updated, total: sessions.length, processed: targetSessions.length, errors };
        } finally {
            this._isLinking = false;
        }
    }

    /**
     * 単一セッションの会話ログを紐付け
     * @param {Object} session - セッション情報
     * @param {Map} codexIndex - Codex cwd → files マップ
     * @returns {Promise<Object|null>} conversationSummary or null (no change)
     */
    async _linkSession(session, codexIndex) {
        const workspacePaths = await this._getSessionWorkspacePaths(session);
        if (workspacePaths.length === 0) return null;
        const activeWorktreePath = workspacePaths[0];

        // Claude Code ログ
        let claudeConversations = [];
        let totalConversations = 0;
        const claudeLogDirs = [];

        for (const worktreePath of workspacePaths) {
            const claudeLogDir = this._getClaudeLogDir(worktreePath);
            if (!claudeLogDir || !existsSync(claudeLogDir)) continue;
            claudeLogDirs.push(claudeLogDir);
            const indexEntries = await this.readClaudeSessionsIndex(claudeLogDir);

            // sessions-index.json がある場合はそこから取得
            if (indexEntries.length > 0) {
                claudeConversations.push(...indexEntries.map(entry => ({
                    engine: 'claude',
                    conversationId: entry.sessionId,
                    firstPrompt: entry.firstPrompt || entry.summary || null,
                    lastActivity: entry.lastActivity || entry.lastModified || null,
                    messageCount: entry.numTurns || 0
                })));
            } else {
                // sessions-index.json がない場合は jsonl ファイルを直接走査
                const existingConversations = session.conversationSummary?.lastConversation
                    ? [session.conversationSummary.lastConversation,
                       ...(session.conversationSummary._cachedConversations || [])]
                    : [];
                try {
                    const files = await fs.readdir(claudeLogDir);
                    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
                    for (const file of jsonlFiles) {
                        const filePath = path.join(claudeLogDir, file);
                        const uuid = path.basename(file, '.jsonl');
                        const stat = await fs.stat(filePath);
                        const mtime = stat.mtime.toISOString();

                        // 前回のlinkAt以降に変更がなければスキップ
                        const existingConv = existingConversations.find(c => c.conversationId === uuid);
                        if (existingConv && existingConv.lastActivity === mtime) {
                            claudeConversations.push(existingConv);
                            continue;
                        }

                        // 変更があった場合のみストリームを開く
                        const stats = await this.getClaudeConversationStats(filePath);
                        const firstPrompt = await this.getFirstPrompt(filePath);
                        claudeConversations.push({
                            engine: 'claude',
                            conversationId: uuid,
                            firstPrompt,
                            lastActivity: stats.lastActivity,
                            messageCount: stats.messageCount
                        });
                    }
                } catch {
                    // Directory read error, skip
                }
            }
        }
        totalConversations += claudeConversations.length;

        // Codex CLI ログ
        const codexFiles = [];
        const codexFileSet = new Set();
        for (const worktreePath of workspacePaths) {
            for (const codexFile of codexIndex.get(worktreePath) || []) {
                if (!codexFileSet.has(codexFile)) {
                    codexFileSet.add(codexFile);
                    codexFiles.push(codexFile);
                }
            }
        }
        const codexConversations = [];
        for (const codexFile of codexFiles) {
            try {
                codexConversations.push(await this._buildCodexConversationFromFile(codexFile));
            } catch {
                // File stat error, skip
            }
        }
        totalConversations += codexConversations.length;

        // 最新の会話を特定
        const allConversations = [...claudeConversations, ...codexConversations];
        allConversations.sort((a, b) => {
            const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
            const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
            return bTime - aTime;
        });

        let lastConversation = allConversations[0] || null;
        lastConversation = await this._resolveCodexMainConversation(lastConversation, codexConversations);
        const engines = [...new Set(allConversations.map(c => c.engine))];
        const tokenUsage = lastConversation?.tokenUsage || session.conversationSummary?.tokenUsage || null;
        let lastAssistantSnippet = session.lastAssistantSnippet || null;
        let lastAssistantSnippetAt = session.lastAssistantSnippetAt || null;
        const codexThreadId = lastConversation?.engine === 'codex'
            ? (lastConversation.resumeId || extractCodexResumeId(lastConversation.conversationId))
            : (session.codexThreadId || null);

        if (lastConversation?.engine === 'claude' && claudeLogDirs.length > 0) {
            const claudeLogDir = claudeLogDirs.find((dir) => existsSync(path.join(dir, `${lastConversation.conversationId}.jsonl`)));
            const claudeJsonl = claudeLogDir ? path.join(claudeLogDir, `${lastConversation.conversationId}.jsonl`) : null;
            if (claudeJsonl && existsSync(claudeJsonl)) {
                lastAssistantSnippet = await this.getLastClaudeAssistantSnippet(claudeJsonl);
                lastAssistantSnippetAt = lastConversation.lastActivity || null;
            }
        } else if (lastConversation?.engine === 'codex') {
            const codexFile = lastConversation._filePath
                || codexFiles.find((filePath) => path.basename(filePath, '.jsonl').replace(/^rollout-/, '') === lastConversation.conversationId);
            if (codexFile) {
                lastAssistantSnippet = await this.getLastCodexAssistantSnippet(codexFile);
                lastAssistantSnippetAt = lastConversation.lastActivity || null;
            }
        }

        // 変更がない場合はスキップ
        const existing = session.conversationSummary;
        if (
            existing
            && existing.totalConversations === totalConversations
            && JSON.stringify(existing.tokenUsage || null) === JSON.stringify(tokenUsage || null)
            && (existing.codexThreadId || null) === (codexThreadId || null)
            && (session.lastAssistantSnippet || null) === (lastAssistantSnippet || null)
            && (session.lastAssistantSnippetAt || null) === (lastAssistantSnippetAt || null)
        ) {
            return null; // No change
        }

        return {
            totalConversations,
            engines,
            lastConversation: this._serializeConversation(lastConversation),
            tokenUsage,
            codexThreadId,
            lastAssistantSnippet,
            lastAssistantSnippetAt,
            claudeLogDir: this._getClaudeLogDir(activeWorktreePath) || null,
            claudeLogDirs: claudeLogDirs.length > 0 ? claudeLogDirs : null,
            codexLogFiles: codexFiles.length > 0 ? codexFiles : null,
            linkedAt: new Date().toISOString()
        };
    }

    /**
     * worktree パスから Claude Code のログディレクトリパスを取得
     * @param {string} worktreePath
     * @returns {string|null}
     */
    _getClaudeLogDir(worktreePath) {
        const encoded = this.encodePathForClaude(worktreePath);
        if (!encoded) return null;
        return path.join(this.claudeProjectsDir, encoded);
    }

    /**
     * Codex CLI のセッション全ファイルから cwd → files のインデックスを構築
     * @returns {Promise<Map<string, string[]>>} cwd → ファイルパスの配列
     */
    async _buildCodexIndex() {
        // 1分以内の再リクエストはキャッシュ返却
        const now = Date.now();
        if (this._codexIndexCache && (now - this._codexIndexCacheTime) < 60_000) {
            return this._codexIndexCache;
        }

        const index = new Map();

        if (!existsSync(this.codexSessionsDir)) {
            this._codexFileMetaCache.clear();
            return index;
        }

        const seenFiles = new Set();
        this._codexFileBySessionId = new Map();

        try {
            // ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl を再帰走査
            const years = await fs.readdir(this.codexSessionsDir).catch(() => []);
            for (const year of years) {
                const yearDir = path.join(this.codexSessionsDir, year);
                const months = await fs.readdir(yearDir).catch(() => []);
                for (const month of months) {
                    const monthDir = path.join(yearDir, month);
                    const days = await fs.readdir(monthDir).catch(() => []);
                    for (const day of days) {
                        const dayDir = path.join(monthDir, day);
                        const files = await fs.readdir(dayDir).catch(() => []);
                        for (const file of files) {
                            if (!file.endsWith('.jsonl')) continue;
                            const filePath = path.join(dayDir, file);
                            seenFiles.add(filePath);
                            const cwd = await this._getCodexSessionCwdForIndex(filePath);
                            const meta = await this._getCodexSessionMetaForIndex(filePath);
                            if (meta?.id) {
                                this._codexFileBySessionId.set(meta.id, filePath);
                            }
                            if (cwd) {
                                const normalized = cwd.replace(/\/+$/, '');
                                const existing = index.get(normalized) || [];
                                existing.push(filePath);
                                index.set(normalized, existing);
                            }
                        }
                    }
                }
            }
        } catch (err) {
            logger.warn('[ConversationLinker] Error building Codex index:', err.message);
        }

        for (const filePath of this._codexFileMetaCache.keys()) {
            if (!seenFiles.has(filePath)) {
                this._codexFileMetaCache.delete(filePath);
            }
        }

        logger.info(`[ConversationLinker] Codex index: ${index.size} unique cwd(s)`);
        this._codexIndexCache = index;
        this._codexIndexCacheTime = Date.now();
        return index;
    }

    _serializeConversation(conversation) {
        if (!conversation) return null;
        const { _filePath, ...serializable } = conversation;
        return serializable;
    }

    async _getCodexSessionCwdForIndex(filePath) {
        let stat;
        try {
            stat = await fs.stat(filePath);
        } catch {
            this._codexFileMetaCache.delete(filePath);
            return null;
        }

        const cached = this._codexFileMetaCache.get(filePath);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
            return cached.cwd;
        }

        const cwd = await this.getCodexSessionCwd(filePath);
        this._codexFileMetaCache.set(filePath, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            cwd,
            meta: { cwd }
        });
        return cwd;
    }

    async _getCodexSessionMetaForIndex(filePath) {
        let stat;
        try {
            stat = await fs.stat(filePath);
        } catch {
            this._codexFileMetaCache.delete(filePath);
            return null;
        }

        const cached = this._codexFileMetaCache.get(filePath);
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.meta?.id) {
            return cached.meta;
        }

        const meta = await this.getCodexSessionMeta(filePath);
        this._codexFileMetaCache.set(filePath, {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            cwd: meta.cwd || null,
            meta
        });
        return meta;
    }

    /**
     * 単一セッションの会話一覧を詳細取得（API用）
     * @param {string} sessionId - セッション ID
     * @returns {Promise<Object>} { conversations: [...] }
     */
    async getConversationsForSession(sessionId) {
        const state = this.stateStore.get();
        const session = (state.sessions || []).find(s => s.id === sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        const workspacePaths = await this._getSessionWorkspacePaths(session);
        if (workspacePaths.length === 0) {
            return { conversations: [] };
        }

        const conversations = [];

        // Claude Code
        for (const worktreePath of workspacePaths) {
            const claudeLogDir = this._getClaudeLogDir(worktreePath);
            if (!claudeLogDir || !existsSync(claudeLogDir)) continue;
            try {
                const files = await fs.readdir(claudeLogDir);
                const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

                for (const file of jsonlFiles) {
                    const filePath = path.join(claudeLogDir, file);
                    const uuid = path.basename(file, '.jsonl');
                    const stats = await this.getClaudeConversationStats(filePath);
                    const firstPrompt = await this.getFirstPrompt(filePath);

                    conversations.push({
                        engine: 'claude',
                        id: uuid,
                        workspacePath: worktreePath,
                        firstPrompt,
                        lastActivity: stats.lastActivity,
                        messageCount: stats.messageCount,
                        sizeBytes: stats.sizeBytes
                    });
                }
            } catch {
                // Skip
            }
        }

        // Codex CLI
        const codexIndex = await this._buildCodexIndex();
        const codexFileSet = new Set();
        for (const worktreePath of workspacePaths) {
            for (const filePath of codexIndex.get(worktreePath) || []) {
                codexFileSet.add(filePath);
            }
        }

        for (const filePath of codexFileSet) {
            const uuid = path.basename(filePath, '.jsonl').replace(/^rollout-/, '');
            try {
                const stat = await fs.stat(filePath);
                const resumeId = await this.getCodexSessionId(filePath);
                const workspacePath = await this.getCodexSessionCwd(filePath);
                const stats = await this.getCodexConversationStats(filePath);
                conversations.push({
                    engine: 'codex',
                    id: uuid,
                    resumeId,
                    workspacePath,
                    firstPrompt: null,
                    lastActivity: stats.lastActivity || stat.mtime.toISOString(),
                    messageCount: stats.messageCount,
                    sizeBytes: stat.size
                });
            } catch {
                // Skip
            }
        }

        // Sort by lastActivity descending
        conversations.sort((a, b) => {
            const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
            const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
            return bTime - aTime;
        });

        return { conversations };
    }

    /**
     * 定期実行を開始
     * @param {number} intervalMs - 実行間隔（デフォルト: 5分）
     */
    startPeriodicLink(intervalMs = 5 * 60 * 1000) {
        if (this._intervalTimer) return;

        logger.info(`[ConversationLinker] Starting periodic link (interval: ${intervalMs / 1000}s)`);

        this._intervalTimer = setInterval(async () => {
            try {
                await this.linkAll({ limit: 25 });
            } catch (err) {
                logger.error('[ConversationLinker] Periodic link error:', err.message);
            }
        }, intervalMs);
    }

    /**
     * 定期実行を停止
     */
    stopPeriodicLink() {
        if (this._intervalTimer) {
            clearInterval(this._intervalTimer);
            this._intervalTimer = null;
            logger.info('[ConversationLinker] Periodic link stopped');
        }
    }
}

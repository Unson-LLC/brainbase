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

export class ConversationLinker {
    /**
     * @param {Object} options
     * @param {Object} options.stateStore - StateStore インスタンス
     * @param {Object} [options.sessionManager] - SessionManager インスタンス
     */
    constructor({ stateStore, sessionManager = null }) {
        this.stateStore = stateStore;
        this.sessionManager = sessionManager;
        this.homeDir = os.homedir();
        this.claudeProjectsDir = path.join(this.homeDir, '.claude', 'projects');
        this.codexSessionsDir = path.join(this.homeDir, '.codex', 'sessions');
        this._intervalTimer = null;
        this._isLinking = false;
        this._codexIndexCache = null;
        this._codexIndexCacheTime = 0;
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

    /**
     * Codex CLI のセッションファイルから cwd を読み取る
     * jsonl の最初の行に session_meta があり、cwd が含まれる
     * @param {string} jsonlPath - jsonl ファイルパス
     * @returns {Promise<string|null>} cwd
     */
    async getCodexSessionCwd(jsonlPath) {
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
                            return meta.cwd || null;
                        }
                    } catch {
                        // Skip malformed lines
                    }
                    // Only check first few lines
                    break;
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

    /**
     * 全セッションの会話ログ紐付けを実行
     * @returns {Promise<{updated: number, total: number, errors: string[]}>}
     */
    async linkAll() {
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

            logger.info(`[ConversationLinker] Starting linkAll for ${sessions.length} session(s)...`);

            // Build Codex session index (cwd → files) once
            const codexIndex = await this._buildCodexIndex();

            const updatedSessions = [];

            for (const session of sessions) {
                try {
                    const summary = await this._linkSession(session, codexIndex);
                    if (summary) {
                        updatedSessions.push({ ...session, conversationSummary: summary });
                        updated++;
                    } else {
                        updatedSessions.push(session);
                    }
                } catch (err) {
                    errors.push(`${session.id}: ${err.message}`);
                    updatedSessions.push(session);
                }
            }

            // Save updated state
            if (updated > 0) {
                await this.stateStore.update({ ...state, sessions: updatedSessions });
                logger.info(`[ConversationLinker] Updated ${updated}/${sessions.length} session(s)`);
            } else {
                logger.info(`[ConversationLinker] No updates needed`);
            }

            if (errors.length > 0) {
                logger.warn(`[ConversationLinker] ${errors.length} error(s):`, errors.slice(0, 5));
            }

            return { updated, total: sessions.length, errors };
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
        const worktreePath = this.sessionManager
            ? await this.sessionManager.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            : (session.worktree?.path || session.path);
        if (!worktreePath) return null;

        // Claude Code ログ
        const claudeLogDir = this._getClaudeLogDir(worktreePath);
        let claudeConversations = [];
        let totalConversations = 0;

        if (claudeLogDir && existsSync(claudeLogDir)) {
            const indexEntries = await this.readClaudeSessionsIndex(claudeLogDir);

            // sessions-index.json がある場合はそこから取得
            if (indexEntries.length > 0) {
                claudeConversations = indexEntries.map(entry => ({
                    engine: 'claude',
                    conversationId: entry.sessionId,
                    firstPrompt: entry.firstPrompt || entry.summary || null,
                    lastActivity: entry.lastActivity || entry.lastModified || null,
                    messageCount: entry.numTurns || 0
                }));
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
            totalConversations += claudeConversations.length;
        }

        // Codex CLI ログ
        const codexFiles = codexIndex.get(worktreePath) || [];
        const codexConversations = [];
        for (const codexFile of codexFiles) {
            const uuid = path.basename(codexFile, '.jsonl').replace(/^rollout-/, '');
            try {
                const stat = await fs.stat(codexFile);
                codexConversations.push({
                    engine: 'codex',
                    conversationId: uuid,
                    firstPrompt: null, // Codex firstPrompt は history.jsonl から取得する必要がある（重いのでスキップ）
                    lastActivity: stat.mtime.toISOString(),
                    messageCount: 0
                });
            } catch {
                // File stat error, skip
            }
        }
        totalConversations += codexConversations.length;

        // 変更がない場合はスキップ
        const existing = session.conversationSummary;
        if (existing && existing.totalConversations === totalConversations) {
            return null; // No change
        }

        // 最新の会話を特定
        const allConversations = [...claudeConversations, ...codexConversations];
        allConversations.sort((a, b) => {
            const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
            const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
            return bTime - aTime;
        });

        const lastConversation = allConversations[0] || null;
        const engines = [...new Set(allConversations.map(c => c.engine))];

        return {
            totalConversations,
            engines,
            lastConversation,
            claudeLogDir: claudeLogDir || null,
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
            return index;
        }

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
                            const cwd = await this.getCodexSessionCwd(filePath);
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

        logger.info(`[ConversationLinker] Codex index: ${index.size} unique cwd(s)`);
        this._codexIndexCache = index;
        this._codexIndexCacheTime = Date.now();
        return index;
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

        const worktreePath = this.sessionManager
            ? await this.sessionManager.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            : (session.worktree?.path || session.path);
        if (!worktreePath) {
            return { conversations: [] };
        }

        const conversations = [];

        // Claude Code
        const claudeLogDir = this._getClaudeLogDir(worktreePath);
        if (claudeLogDir && existsSync(claudeLogDir)) {
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
        const codexFiles = codexIndex.get(worktreePath.replace(/\/+$/, '')) || [];

        for (const filePath of codexFiles) {
            const uuid = path.basename(filePath, '.jsonl').replace(/^rollout-/, '');
            try {
                const stat = await fs.stat(filePath);
                conversations.push({
                    engine: 'codex',
                    id: uuid,
                    firstPrompt: null,
                    lastActivity: stat.mtime.toISOString(),
                    messageCount: 0,
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
                await this.linkAll();
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

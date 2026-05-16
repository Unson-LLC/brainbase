// @ts-check
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { logger } from '../utils/logger.js';

export const ARCHIVE_STATUS = Object.freeze({
    QUEUED: 'queued',
    RECORDING: 'recording',
    RECORDED: 'recorded',
    INTEGRATING: 'integrating',
    CLEANING: 'cleaning',
    CLEANED: 'cleaned',
    BLOCKED: 'blocked'
});

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function markdownValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    return String(value).replace(/\r?\n/g, ' ');
}

function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error || '');
}

const ARCHIVE_BRANCH = 'archive-records';
const PUSH_RETRY_LIMIT = 2;

function isMissingRemoteBranchError(error) {
    const message = getErrorMessage(error);
    return /Remote branch .* not found/i.test(message)
        || /Could not find remote branch/i.test(message)
        || /couldn't find remote ref/i.test(message);
}

export class ArchiveFinalizerService {
    /**
     * @param {{
     *   stateStore: any,
     *   worktreeService: any,
     *   execPromise?: Function,
     *   repoRoot?: string,
     *   recordPublisher?: Function,
     *   now?: () => Date
     * }} options
     */
    constructor({ stateStore, worktreeService, execPromise, repoRoot = process.cwd(), recordPublisher = null, now = () => new Date() }) {
        this.stateStore = stateStore;
        this.worktreeService = worktreeService;
        this.execPromise = execPromise;
        this.repoRoot = repoRoot;
        this.recordPublisher = recordPublisher || this._publishMarkdownRecord.bind(this);
        this.now = now;
        this._running = new Set();
        this._draining = false;
        this._timer = null;
    }

    start(intervalMs = 60_000) {
        if (this._timer) return;
        this._timer = setInterval(() => {
            this.drainQueued({ limit: 5 }).catch((error) => {
                logger.error('[ArchiveFinalizer] drain failed:', getErrorMessage(error));
            });
        }, intervalMs);
        this._timer.unref?.();
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    async enqueue(sessionId) {
        setImmediate(() => {
            this.finalize(sessionId).catch((error) => {
                logger.error(`[ArchiveFinalizer] finalize failed for ${sessionId}:`, getErrorMessage(error));
            });
        });
        return { success: true, queued: true };
    }

    getStatus(sessionId) {
        const session = this._findSession(sessionId);
        return session?.archive || null;
    }

    async migrateLegacyArchivedSessions() {
        await this._mutateSessions((sessions) => sessions.map((session) => {
            if (session.intendedState !== 'archived' || session.archive?.status) return session;
            const status = session.worktree?.repo ? ARCHIVE_STATUS.QUEUED : ARCHIVE_STATUS.CLEANED;
            return {
                ...session,
                archive: {
                    status,
                    updatedAt: this._isoNow()
                }
            };
        }));
    }

    async drainQueued(options = {}) {
        const { limit = 5 } = options;
        if (this._draining) {
            return { success: false, skipped: true, reason: 'already_draining' };
        }

        this._draining = true;
        let processed = 0;
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            for (const session of sessions) {
                if (session.intendedState !== 'archived') continue;
                if (![
                    ARCHIVE_STATUS.QUEUED,
                    ARCHIVE_STATUS.RECORDING,
                    ARCHIVE_STATUS.RECORDED,
                    ARCHIVE_STATUS.INTEGRATING,
                    ARCHIVE_STATUS.CLEANING
                ].includes(session.archive?.status)) continue;
                await this.finalize(session.id);
                processed += 1;
                if (processed >= limit) break;
            }
            return { success: true, processed };
        } finally {
            this._draining = false;
        }
    }

    async finalize(sessionId) {
        if (this._running.has(sessionId)) {
            return { success: false, skipped: true, reason: 'already_running' };
        }

        this._running.add(sessionId);
        try {
            const session = this._findSession(sessionId);
            if (!session) {
                return { success: false, error: 'Session not found' };
            }
            if (session.intendedState !== 'archived') {
                return { success: false, error: 'Session is not archived' };
            }

            let record = {
                recordPath: session.archive?.recordPath || null,
                recordPrUrl: session.archive?.recordPrUrl || null
            };
            if (!record.recordPath) {
                await this._setArchive(sessionId, {
                    status: ARCHIVE_STATUS.RECORDING,
                    blockerReason: null
                });

                record = await this.recordPublisher(session);
                await this._setArchive(sessionId, {
                    status: ARCHIVE_STATUS.RECORDED,
                    recordPath: record.recordPath || null,
                    recordPrUrl: record.recordPrUrl || null,
                    recordMergeWarning: record.mergeWarning || null
                });
            } else {
                await this._setArchive(sessionId, {
                    status: ARCHIVE_STATUS.RECORDED,
                    blockerReason: null
                });
            }

            const latest = this._findSession(sessionId) || session;
            if (!latest.worktree?.repo) {
                await this._markCleaned(sessionId, {});
                return { success: true, status: ARCHIVE_STATUS.CLEANED, record };
            }

            const status = await this.worktreeService.getStatus(
                sessionId,
                latest.worktree.repo,
                latest.worktree.startCommit || null,
                {
                    workspaceId: latest.activeWorkspaceId || latest.worktree?.workspaceId || sessionId,
                    generation: latest.worktree?.generation
                }
            );

            if (status.hasWorkingCopyChanges || status.changesNotPushed > 0) {
                return await this._block(sessionId, this._formatIntegrationBlocker(status), { status });
            }

            if (status.needsMerge) {
                await this._setArchive(sessionId, { status: ARCHIVE_STATUS.INTEGRATING });
                const mergeResult = await this.worktreeService.merge(sessionId, latest.worktree.repo, latest.name, {
                    workspaceId: latest.activeWorkspaceId || latest.worktree?.workspaceId || sessionId,
                    generation: latest.worktree?.generation,
                    workspacePath: latest.worktree?.path || latest.path || null,
                    rotateAfterMerge: false
                });
                if (!mergeResult?.success) {
                    return await this._block(sessionId, mergeResult?.error || 'Merge failed', { mergeResult });
                }
                await this._markCleaned(sessionId, {
                    merged: true,
                    mergedAt: mergeResult.mergedAt || this._isoNow(),
                    mergedPrUrl: mergeResult.prUrl || null
                });
                return { success: true, status: ARCHIVE_STATUS.CLEANED, record, mergeResult };
            }

            await this._setArchive(sessionId, { status: ARCHIVE_STATUS.CLEANING });
            const removed = await this.worktreeService.remove(sessionId, latest.worktree.repo);
            if (!removed) {
                return await this._block(sessionId, 'Worktree cleanup failed');
            }
            await this._markCleaned(sessionId, {});
            return { success: true, status: ARCHIVE_STATUS.CLEANED, record };
        } catch (error) {
            return await this._block(sessionId, getErrorMessage(error));
        } finally {
            this._running.delete(sessionId);
        }
    }

    _findSession(sessionId) {
        const state = this.stateStore.get();
        return (state.sessions || []).find((session) => session.id === sessionId) || null;
    }

    _isoNow() {
        return this.now().toISOString();
    }

    async _setArchive(sessionId, patch) {
        await this._patchSession(sessionId, (session) => ({
            archive: {
                ...(session.archive || {}),
                ...patch,
                updatedAt: this._isoNow()
            }
        }));
    }

    async _markCleaned(sessionId, patch) {
        await this._patchSession(sessionId, (session) => {
            const next = {
                ...patch,
                archive: {
                    ...(session.archive || {}),
                    status: ARCHIVE_STATUS.CLEANED,
                    blockerReason: null,
                    finalizedAt: this._isoNow(),
                    updatedAt: this._isoNow()
                }
            };
            if (session.worktree) {
                next.worktree = undefined;
            }
            return next;
        });
    }

    async _block(sessionId, reason, extra = {}) {
        await this._setArchive(sessionId, {
            status: ARCHIVE_STATUS.BLOCKED,
            blockerReason: reason,
            lastError: reason
        });
        return { success: false, ...extra, status: ARCHIVE_STATUS.BLOCKED, error: reason };
    }

    _formatIntegrationBlocker(status) {
        const reasons = [];
        if (status.hasWorkingCopyChanges) {
            reasons.push('working copy has changes');
        }
        if (status.changesNotPushed > 0) {
            reasons.push(`${status.changesNotPushed} change(s) are not pushed`);
        }
        return reasons.join('; ') || 'Workspace needs manual integration';
    }

    async _patchSession(sessionId, patchOrFactory) {
        if (typeof this.stateStore.patchSession === 'function') {
            await this.stateStore.patchSession(sessionId, patchOrFactory);
            return;
        }

        await this._mutateSessions((sessions) => sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const patch = typeof patchOrFactory === 'function' ? patchOrFactory(session) : patchOrFactory;
            const next = { ...session, ...patch };
            for (const [key, value] of Object.entries(patch || {})) {
                if (value === undefined) {
                    delete next[key];
                }
            }
            return next;
        }));
    }

    async _mutateSessions(mutator) {
        if (typeof this.stateStore.mutateSessions === 'function') {
            await this.stateStore.mutateSessions(mutator);
            return;
        }

        const currentState = this.stateStore.get();
        const nextSessions = await mutator([...(currentState.sessions || [])], currentState);
        await this.stateStore.update({ ...currentState, sessions: nextSessions });
    }

    async _publishMarkdownRecord(session) {
        if (typeof this.execPromise !== 'function') {
            throw new Error('Archive record publisher is not configured');
        }

        const now = this.now();
        const year = String(now.getFullYear());
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const recordPath = `docs/session-archives/${year}/${month}/${session.id}.md`;
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-archive-record-'));
        const recordContent = this._buildRecordMarkdown(session, now);
        const commitMessage = `docs(session): archive ${session.id}`;

        try {
            const remoteUrl = (await this.execPromise(`git -C ${shellQuote(this.repoRoot)} remote get-url origin`)).stdout.trim();
            await this._cloneArchiveBranch(tempDir, remoteUrl);
            await this._writeRecordFile(tempDir, recordPath, recordContent);
            await this._stageAndCommit(tempDir, recordPath, commitMessage);

            for (let attempt = 1; ; attempt += 1) {
                try {
                    await this.execPromise(`git -C ${shellQuote(tempDir)} push origin ${shellQuote(ARCHIVE_BRANCH)}`);
                    break;
                } catch (error) {
                    if (attempt > PUSH_RETRY_LIMIT) {
                        logger.warn(`[ArchiveFinalizer] Archive record push failed after retry: ${getErrorMessage(error)}`);
                        throw error;
                    }
                    logger.warn(`[ArchiveFinalizer] Archive record push race detected (attempt ${attempt}); refetching and retrying`);
                    await this.execPromise(`git -C ${shellQuote(tempDir)} fetch origin ${shellQuote(ARCHIVE_BRANCH)}`);
                    await this.execPromise(`git -C ${shellQuote(tempDir)} reset --hard ${shellQuote(`origin/${ARCHIVE_BRANCH}`)}`);
                    await this._writeRecordFile(tempDir, recordPath, recordContent);
                    await this._stageAndCommit(tempDir, recordPath, commitMessage);
                }
            }

            return {
                recordPath,
                recordPrUrl: null,
                branchName: ARCHIVE_BRANCH,
                mergeWarning: null
            };
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }

    async _cloneArchiveBranch(tempDir, remoteUrl) {
        try {
            await this.execPromise(`git clone --depth 1 --branch ${shellQuote(ARCHIVE_BRANCH)} ${shellQuote(remoteUrl)} ${shellQuote(tempDir)}`);
            return;
        } catch (error) {
            if (!isMissingRemoteBranchError(error)) throw error;
        }
        // Branch does not exist on remote yet — initialize an orphan history
        await this.execPromise(`git clone --depth 1 ${shellQuote(remoteUrl)} ${shellQuote(tempDir)}`);
        await this.execPromise(`git -C ${shellQuote(tempDir)} checkout --orphan ${shellQuote(ARCHIVE_BRANCH)}`);
        await this.execPromise(`git -C ${shellQuote(tempDir)} rm -rf .`).catch(() => {});
    }

    async _writeRecordFile(tempDir, recordPath, content) {
        await fs.mkdir(path.join(tempDir, path.dirname(recordPath)), { recursive: true });
        await fs.writeFile(path.join(tempDir, recordPath), content, 'utf8');
    }

    async _stageAndCommit(tempDir, recordPath, commitMessage) {
        await this.execPromise(`git -C ${shellQuote(tempDir)} add ${shellQuote(recordPath)}`);
        await this.execPromise(`git -C ${shellQuote(tempDir)} commit -m ${shellQuote(commitMessage)}`);
    }

    _buildRecordMarkdown(session, archivedAt) {
        const worktree = session.worktree || {};
        return [
            '---',
            `session_id: ${markdownValue(session.id)}`,
            `archived_at: ${archivedAt.toISOString()}`,
            `repo: ${markdownValue(worktree.repo)}`,
            '---',
            '',
            `# Session Archive: ${markdownValue(session.name || session.id)}`,
            '',
            '| Field | Value |',
            '| --- | --- |',
            `| Session ID | ${markdownValue(session.id)} |`,
            `| Name | ${markdownValue(session.name)} |`,
            `| Project | ${markdownValue(session.project)} |`,
            `| Engine | ${markdownValue(session.engine)} |`,
            `| Repository | ${markdownValue(worktree.repo)} |`,
            `| Worktree | ${markdownValue(worktree.path || session.path || session.cwd)} |`,
            `| Start Commit | ${markdownValue(worktree.startCommit)} |`,
            `| Created At | ${markdownValue(session.createdAt || session.createdDate)} |`,
            `| Archived At | ${archivedAt.toISOString()} |`,
            '',
            '## Finalizer',
            '',
            'This record was created before integration and cleanup so the session cannot disappear without a GitHub trace.',
            ''
        ].join('\n');
    }
}

// @ts-check
/**
 * WorktreeService
 * Jujutsu workspace操作を管理するサービス（Git worktreeから移行）
 *
 * 変更点:
 * - Git worktree → Jujutsu workspace
 * - jj workspace add --name <name> <path>
 * - jj git push --bookmark <name>
 * - jj workspace forget <name> + 物理ディレクトリ削除
 */
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

function parseGitHubRepoSpec(remoteUrl) {
    const value = String(remoteUrl || '').trim();
    const patterns = [
        /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/,
        /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/,
        /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/
    ];

    for (const pattern of patterns) {
        const match = value.match(pattern);
        if (match) return match[1];
    }

    return null;
}

export class WorktreeService {
    /**
     * @param {string} worktreesDir - workspaces保存ディレクトリ
     * @param {string} canonicalRoot - メインリポジトリのパス（listWorktrees()で使用）
     * @param {Function} execPromise - util.promisify(exec)
     */
    constructor(worktreesDir, canonicalRoot, execPromise) {
        this.worktreesDir = worktreesDir;
        this.canonicalRoot = canonicalRoot;
        this.execPromise = execPromise;
        this._jjRepoCache = new Map();  // repoPath単位のキャッシュ
        this._repoMutex = new Map();    // repoPath -> Promise (last in chain)
    }

    /**
     * 同一 repoPath への jj/git 書き込みを直列化する。
     * 異なる repoPath 間は並列実行を許可。chain内の例外は次の呼び出しに伝播しない。
     */
    async _withRepoLock(repoPath, fn) {
        const prev = this._repoMutex.get(repoPath) || Promise.resolve();
        const next = prev.then(fn, fn);
        // 後続 caller が chain に乗れるよう、結果に関わらず resolve する Promise を保持
        this._repoMutex.set(repoPath, next.then(() => {}, () => {}));
        return next;
    }

    /**
     * Jujutsuリポジトリかどうかを判定
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async _isJujutsuRepo(repoPath) {
        if (this._jjRepoCache.has(repoPath)) {
            return this._jjRepoCache.get(repoPath);
        }
        try {
            await this.execPromise(`jj -R "${repoPath}" version`);
            this._jjRepoCache.set(repoPath, true);
            return true;
        } catch {
            this._jjRepoCache.set(repoPath, false);
            return false;
        }
    }

    /**
     * worktreesディレクトリが存在することを保証
     */
    async ensureWorktreesDir() {
        try {
            await fs.mkdir(this.worktreesDir, { recursive: true });
        } catch (err) {
            logger.error('Failed to create worktrees directory:', err);
        }
    }

    /**
     * ゾンビworktreeを検出して物理ディレクトリを削除する。
     * ゾンビ = .jj/working_copy は存在するが、jj workspace list に登録されていないworktree。
     * workspace forgetされたが物理ディレクトリが残った状態を自動クリーンアップする。
     * @param {string} repoPath - メインリポジトリのパス
     * @returns {Promise<string[]>} 削除したディレクトリ名の配列
     */
    async cleanupZombieWorktrees(repoPath) {
        const removed = [];
        try {
            await fs.mkdir(this.worktreesDir, { recursive: true });
            const entries = await fs.readdir(this.worktreesDir, { withFileTypes: true });
            const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
            if (!dirs.length) return removed;

            let registeredWorkspaces;
            try {
                const { stdout } = await this.execPromise(`jj -R "${repoPath}" workspace list --no-pager`);
                registeredWorkspaces = new Set(
                    stdout.split('\n').filter(Boolean).map((line) => line.split(':')[0].trim())
                );
            } catch {
                return removed;
            }

            for (const dir of dirs) {
                const worktreePath = path.join(this.worktreesDir, dir);
                const jjDir = path.join(worktreePath, '.jj');
                try {
                    await fs.access(jjDir);
                } catch {
                    continue;
                }

                if (registeredWorkspaces.has(dir)) continue;

                logger.warn(`[workspace] Zombie worktree detected: ${dir} (not in jj workspace list). Removing.`);
                try {
                    await fs.rm(worktreePath, { recursive: true, force: true });
                    removed.push(dir);
                    logger.info(`[workspace] Zombie worktree removed: ${dir}`);
                } catch (rmErr) {
                    logger.error(`[workspace] Failed to remove zombie worktree ${dir}: ${rmErr.message}`);
                }
            }
        } catch (err) {
            logger.error(`[workspace] Zombie cleanup scan failed: ${err.message}`);
        }
        return removed;
    }

    _getWorkspaceIdentity(sessionId, options = {}) {
        const workspaceId = options.workspaceId || options.activeWorkspaceId || sessionId;
        const generation = Number.isFinite(options.generation)
            ? options.generation
            : this._parseWorkspaceGeneration(workspaceId, sessionId);
        return { workspaceId, generation };
    }

    _parseWorkspaceGeneration(workspaceId, sessionId) {
        if (!workspaceId || workspaceId === sessionId) return 1;
        const escapedSessionId = String(sessionId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(workspaceId).match(new RegExp(`^${escapedSessionId}-g(\\d+)$`));
        return match ? Number.parseInt(match[1], 10) || 1 : 1;
    }

    _nextWorkspaceIdentity(sessionId, options = {}) {
        const current = this._getWorkspaceIdentity(sessionId, options);
        const nextGeneration = Math.max(1, current.generation || 1) + 1;
        return {
            workspaceId: `${sessionId}-g${nextGeneration}`,
            generation: nextGeneration
        };
    }

    _getWorkspaceName(sessionId, repoPath, options = {}) {
        const { workspaceId } = this._getWorkspaceIdentity(sessionId, options);
        return `${workspaceId}-${path.basename(repoPath)}`;
    }

    _getSessionBranchName(sessionId, options = {}) {
        const { workspaceId } = this._getWorkspaceIdentity(sessionId, options);
        return `session/${workspaceId}`;
    }

    _getSessionBookmarkCandidates(sessionId, options = {}) {
        const { workspaceId } = this._getWorkspaceIdentity(sessionId, options);
        const candidates = workspaceId === sessionId
            ? [this._getSessionBranchName(sessionId, options), workspaceId]
            : [this._getSessionBranchName(sessionId, options), workspaceId];
        return candidates
            .filter((value, index, list) => value && list.indexOf(value) === index);
    }

    async _realpathOrResolve(targetPath) {
        try {
            return await fs.realpath(targetPath);
        } catch {
            return path.resolve(targetPath);
        }
    }

    async _isCanonicalRepo(repoPath) {
        const [repoRealpath, canonicalRealpath] = await Promise.all([
            this._realpathOrResolve(repoPath),
            this._realpathOrResolve(this.canonicalRoot)
        ]);
        return repoRealpath === canonicalRealpath;
    }

    async _getJjCommitId(repoPath, revset) {
        const { stdout } = await this._execJujutsuWithStaleRetry(
            repoPath,
            `--ignore-working-copy log -r "${revset}" -T 'commit_id ++ "\\n"' --no-pager --no-graph`,
            { retryStale: false }
        );
        return stdout
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean) || null;
    }

    async getMergeDeploymentGuardStatus(repoPath, options = {}) {
        const { mainBranchName = null, fetchRemote = false } = options;
        const resolvedMainBranchName = mainBranchName || await this._getMainBranchName(repoPath);
        const canonical = await this._isCanonicalRepo(repoPath);

        const baseStatus = {
            ready: true,
            canonical,
            repoPath,
            mainBranchName: resolvedMainBranchName,
            reason: 'ok'
        };

        if (process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD === '1') {
            return { ...baseStatus, disabled: true, reason: 'disabled' };
        }

        if (!canonical) {
            return { ...baseStatus, skipped: true, reason: 'non_canonical_repo' };
        }

        try {
            await this.execPromise(`git -C "${repoPath}" rev-parse --verify HEAD`);
        } catch (error) {
            return {
                ...baseStatus,
                ready: false,
                reason: 'missing_git_head',
                error: error instanceof Error ? error.message : String(error)
            };
        }

        if (!await this._isJujutsuRepo(repoPath)) {
            return {
                ...baseStatus,
                ready: false,
                reason: 'not_jj_repo',
                error: 'Canonical Brainbase repo must be a Jujutsu repo for merge deployment guard'
            };
        }

        try {
            if (fetchRemote) {
                await this._execJujutsuWithStaleRetry(repoPath, 'git fetch');
            }

            const [defaultCommit, mainCommit, statusResult] = await Promise.all([
                this._getJjCommitId(repoPath, 'default@'),
                this._getJjCommitId(repoPath, resolvedMainBranchName),
                this._execJujutsuWithStaleRetry(repoPath, 'status --no-pager')
            ]);
            const hasRelevantWorkingCopyChanges = this._statusHasRelevantWorkingCopyChanges(statusResult.stdout);

            if (hasRelevantWorkingCopyChanges) {
                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'canonical_workspace_dirty',
                    defaultCommit,
                    mainCommit
                };
            }

            if (!defaultCommit || !mainCommit) {
                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'unresolved_jj_revision',
                    defaultCommit,
                    mainCommit
                };
            }

            if (defaultCommit !== mainCommit) {
                const { stdout: diffPaths } = await this._execJujutsuWithStaleRetry(
                    repoPath,
                    `diff -r "${resolvedMainBranchName}..default@" --name-only`
                );
                if (!this._diffOutputHasRelevantPaths(diffPaths)) {
                    return {
                        ...baseStatus,
                        reason: 'ok_ignored_artifact_delta',
                        defaultCommit,
                        mainCommit
                    };
                }

                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'canonical_workspace_not_deployed',
                    defaultCommit,
                    mainCommit
                };
            }

            return { ...baseStatus, defaultCommit, mainCommit };
        } catch (error) {
            return {
                ...baseStatus,
                ready: false,
                reason: 'guard_check_failed',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    async syncCanonicalWorkspaceAfterMerge(repoPath, mainBranchName) {
        if (process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD === '1') {
            return { success: true, skipped: true, reason: 'disabled' };
        }

        if (!await this._isCanonicalRepo(repoPath)) {
            return { success: true, skipped: true, reason: 'non_canonical_repo' };
        }

        try {
            await this._execJujutsuWithStaleRetry(repoPath, 'git fetch');
            await this._execJujutsuWithStaleRetry(repoPath, `rebase -b default@ -d "${mainBranchName}"`);
        } catch (error) {
            return {
                success: false,
                reason: 'deploy_sync_failed',
                error: error instanceof Error ? error.message : String(error)
            };
        }

        const status = await this.getMergeDeploymentGuardStatus(repoPath, { mainBranchName, fetchRemote: false });
        if (!status.ready) {
            return {
                success: false,
                reason: status.reason,
                status
            };
        }

        return { success: true, status };
    }

    _isStaleWorkingCopyError(error) {
        const message = [
            error?.message,
            error?.stderr,
            error?.stdout
        ]
            .filter(Boolean)
            .join('\n')
            .toLowerCase();

        return message.includes('working copy is stale')
            || message.includes('workspace update-stale');
    }

    _isIndexLockError(error) {
        if (!error) return false;
        const message = [
            error?.message,
            error?.stderr,
            error?.stdout
        ]
            .filter(Boolean)
            .join('\n');

        return message.includes('Could not acquire lock for index file')
            || message.includes('index.lock');
    }

    /**
     * `<lockPath>` が活物プロセスに保持されておらず、mtimeも30秒以上前なら stale と判定。
     * lsof が使えない環境では mtime 条件のみで判定する。
     */
    async _isStaleLockfile(lockPath) {
        let stat;
        try {
            stat = await fs.stat(lockPath);
        } catch {
            return false;
        }

        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 30_000) {
            return false;
        }

        try {
            const { stdout } = await this.execPromise(`lsof "${lockPath}" 2>/dev/null || true`);
            if (stdout && stdout.trim().length > 0) {
                return false;
            }
        } catch {
            // lsof unavailable — fall through to mtime-only judgment
        }

        return true;
    }

    /**
     * `<repoPath>/.git/index.lock` が stale なら削除する。
     * 削除に成功した場合のみ true を返し、警告ログを残す。
     */
    async _recoverStaleLockfile(repoPath) {
        const lockPath = path.join(repoPath, '.git', 'index.lock');
        if (!(await this._isStaleLockfile(lockPath))) {
            return false;
        }

        try {
            await fs.unlink(lockPath);
            logger.warn(`[workspace] Removed stale index.lock at ${lockPath}`);
            return true;
        } catch (err) {
            logger.info(`[workspace] Stale index.lock removal failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }

    /**
     * ソースが存在すればシンボリックリンクを作成（既存ならスキップ）
     */
    async _symlinkIfMissing(sourcePath, targetPath, label) {
        try {
            await fs.access(sourcePath);
            try {
                await fs.access(targetPath);
                logger.info(`${label} already exists at ${targetPath}, skipping symlink`);
            } catch {
                await fs.symlink(sourcePath, targetPath);
                logger.info(`Created ${label} symlink at ${targetPath}`);
            }
        } catch (err) {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
                logger.info(`Note: ${label} not found at ${sourcePath}`);
            } else {
                logger.info(`Note: Could not create ${label} symlink: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    async _execJujutsuWithStaleRetry(repoPath, command, options = {}) {
        const { retryStale = true } = options;
        const fullCommand = `jj -R "${repoPath}" ${command}`;

        return this._withRepoLock(repoPath, async () => {
            try {
                return await this.execPromise(fullCommand);
            } catch (error) {
                if (retryStale && this._isStaleWorkingCopyError(error)) {
                    logger.warn(`[workspace] Detected stale jj working copy at ${repoPath}, healing before retry`);
                    await this.execPromise(`jj -R "${repoPath}" workspace update-stale`);
                    return await this.execPromise(fullCommand);
                }

                if (this._isIndexLockError(error) && await this._recoverStaleLockfile(repoPath)) {
                    return await this.execPromise(fullCommand);
                }

                throw error;
            }
        });
    }

    async _getBookmarkInfos(repoPath, sessionId, options = {}) {
        const { fetchRemote = true } = options;

        if (fetchRemote) {
            try {
                await this.execPromise(`jj -R "${repoPath}" git fetch`);
            } catch (fetchErr) {
                logger.info(`[getStatus] git fetch failed, continuing: ${fetchErr.message}`);
            }
        }

        const bookmarkCandidates = this._getSessionBookmarkCandidates(sessionId, options);
        const infos = [];

        for (const candidate of bookmarkCandidates) {
            try {
                const { stdout } = await this.execPromise(
                    `jj -R "${repoPath}" bookmark list "${candidate}" --all-remotes --no-pager`
                );
                const output = stdout.trim();
                if (!output || output.includes('No matching bookmarks') || output.includes('(deleted)')) {
                    continue;
                }

                infos.push({
                    name: candidate,
                    pushed: /@origin(?::|\b)/.test(output) || /origin:/.test(output),
                    output
                });
            } catch {
                // ignore missing bookmark candidate
            }
        }

        return infos;
    }

    async _resolveMergeBookmarkName(sessionId, repoPath, options = {}) {
        const bookmarkInfos = await this._getBookmarkInfos(repoPath, sessionId, { ...options, fetchRemote: false });
        return bookmarkInfos.find(info => info.pushed)?.name
            || bookmarkInfos[0]?.name
            || this._getSessionBranchName(sessionId, options);
    }

    _isNonTrackingRemoteBookmarkError(error, bookmarkName) {
        const message = [
            error?.message,
            error?.stderr,
            error?.stdout,
            String(error || '')
        ].filter(Boolean).join('\n');

        return message.includes(`Non-tracking remote bookmark ${bookmarkName}@origin exists`);
    }

    async _pushBookmarkForMerge(repoPath, bookmarkName) {
        try {
            await this._execJujutsuWithStaleRetry(
                repoPath,
                `git push --bookmark "${bookmarkName}"`,
                { retryStale: false }
            );
        } catch (pushErr) {
            if (!this._isNonTrackingRemoteBookmarkError(pushErr, bookmarkName)) {
                throw pushErr;
            }

            logger.info(`[merge] Tracking existing remote bookmark before retry: ${bookmarkName}@origin`);
            await this._execJujutsuWithStaleRetry(
                repoPath,
                `bookmark track "${bookmarkName}" --remote=origin`,
                { retryStale: false }
            );
            await this._execJujutsuWithStaleRetry(
                repoPath,
                `git push --bookmark "${bookmarkName}"`,
                { retryStale: false }
            );
        }
    }

    async _resolveGitRefForBookmark(workspacePath, bookmarkName) {
        const refCandidates = [
            `refs/remotes/origin/${bookmarkName}`,
            `origin/${bookmarkName}`,
            bookmarkName
        ];

        for (const candidate of refCandidates) {
            try {
                await this.execPromise(`git -C "${workspacePath}" rev-parse --verify "${candidate}"`);
                return candidate;
            } catch {
                // try next ref
            }
        }

        return null;
    }

    async _ensureGitExclude(gitDirPath, pattern) {
        const infoDir = path.join(gitDirPath, 'info');
        const excludePath = path.join(infoDir, 'exclude');
        let current = '';

        await fs.mkdir(infoDir, { recursive: true });

        try {
            current = await fs.readFile(excludePath, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                throw error;
            }
        }

        const lines = current
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (!lines.includes(pattern)) {
            const next = current && !current.endsWith('\n')
                ? `${current}\n${pattern}\n`
                : `${current}${pattern}\n`;
            await fs.writeFile(excludePath, next);
        }
    }

    async _workspaceMatchesBookmark(workspacePath, bookmarkName) {
        const gitRef = await this._resolveGitRefForBookmark(workspacePath, bookmarkName);
        if (!gitRef) {
            return false;
        }

        try {
            await this.execPromise(`git -C "${workspacePath}" diff --quiet "${gitRef}" --`);
            return true;
        } catch {
            return false;
        }
    }

    async _getCurrentGitBranch(workspacePath) {
        try {
            const { stdout } = await this.execPromise(`git -C "${workspacePath}" branch --show-current`);
            const branch = stdout.trim();
            return branch || null;
        } catch {
            return null;
        }
    }

    async _isGitBranchPushed(workspacePath, branchName) {
        if (!branchName) return false;

        try {
            await this.execPromise(
                `git -C "${workspacePath}" rev-parse --verify "refs/remotes/origin/${branchName}"`
            );
            return true;
        } catch {
            return false;
        }
    }

    async _workspaceMatchesGitHead(workspacePath) {
        try {
            await this.execPromise(`git -C "${workspacePath}" diff --quiet HEAD --`);
            return true;
        } catch {
            return false;
        }
    }

    async _countCommitsAheadOfBase(repoPath, baseRef, targetRef) {
        if (!baseRef || !targetRef) {
            return 0;
        }

        try {
            const { stdout } = await this.execPromise(
                `jj -R "${repoPath}" log -r "${baseRef}..${targetRef}" -T '"x\n"' --no-pager --no-graph 2>/dev/null | wc -l`
            );
            return parseInt(stdout.trim(), 10) || 0;
        } catch {
            return 0;
        }
    }

    _isWorkspaceArtifactStatusPath(statusPath) {
        const normalized = String(statusPath || '').replace(/\\/g, '/');
        const copyOrRenameMatch = normalized.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
        if (copyOrRenameMatch) {
            const [, prefix, fromPath, toPath, suffix] = copyOrRenameMatch;
            return [
                `${prefix}${fromPath}${suffix}`,
                `${prefix}${toPath}${suffix}`
            ].every((candidate) => this._isWorkspaceArtifactStatusPath(candidate));
        }

        const basename = normalized.split('/').pop();
        const artifactBasenames = new Set([
            '.DS_Store',
            '.brainbase-port',
            '.mcp.json',
            '.vibeproignore',
            '.antigravityignore',
            'AGENTS.md',
            'CLAUDE.md'
        ]);

        return normalized.includes('/.claude/')
            || normalized.startsWith('.claude/')
            || normalized.includes('/node_modules/')
            || normalized.startsWith('node_modules/')
            || normalized.includes('/--help/')
            || normalized.startsWith('--help/')
            || basename === 'node_modules'
            || artifactBasenames.has(basename);
    }

    _statusHasRelevantWorkingCopyChanges(statusOutput) {
        if (!String(statusOutput || '').includes('Working copy changes:')) {
            return false;
        }

        return String(statusOutput || '')
            .split('\n')
            .some((line) => {
                const match = line.match(/^\s*[A-Z?][A-Z? ]*\s+(.+)$/);
                if (!match) return false;
                return !this._isWorkspaceArtifactStatusPath(match[1]);
            });
    }

    async _hasWorkingCopyConflicts(workspacePath) {
        try {
            const { stdout } = await this.execPromise(
                `jj -R "${workspacePath}" resolve --list --no-pager`
            );
            return this._resolveListHasConflicts(stdout);
        } catch (error) {
            const output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
            if (/No conflicts found/i.test(output)) {
                return false;
            }
            logger.warn(`[workspace] Failed to inspect conflicts for ${workspacePath}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    _resolveListHasConflicts(resolveOutput) {
        return String(resolveOutput || '')
            .split('\n')
            .some((line) => line.trim() && !/No conflicts found/i.test(line));
    }

    _diffOutputHasRelevantPaths(diffOutput) {
        return String(diffOutput || '')
            .split('\n')
            .some((line) => {
                const statMatch = line.match(/^\s*(.+?)\s+\|\s+/);
                const filePath = (statMatch ? statMatch[1] : line).trim();
                if (!filePath || /^[0-9]+ files? changed/.test(filePath)) return false;
                return !this._isWorkspaceArtifactStatusPath(filePath);
            });
    }

    async _resolveArchiveTargetBookmark(sessionId, repoPath, workspacePath, bookmarkInfos) {
        const officialBookmark = bookmarkInfos.find(info => info.pushed) || null;
        if (officialBookmark) {
            return {
                bookmarkName: officialBookmark.name,
                adoptSessionBookmark: false
            };
        }

        const currentBranch = await this._getCurrentGitBranch(workspacePath);
        if (!currentBranch) {
            return null;
        }

        const [branchPushed, matchesHead] = await Promise.all([
            this._isGitBranchPushed(workspacePath, currentBranch),
            this._workspaceMatchesGitHead(workspacePath)
        ]);

        if (!branchPushed || !matchesHead) {
            return null;
        }

        return {
            bookmarkName: currentBranch,
            adoptSessionBookmark: currentBranch !== this._getSessionBranchName(sessionId)
        };
    }

    async _collectStatus(sessionId, repoPath, workspacePath, startCommit = null, options = {}) {
        const { fetchRemote = true } = options;
        const repoName = path.basename(repoPath);
        const workspaceIdentity = this._getWorkspaceIdentity(sessionId, options);
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, workspaceIdentity);
        const fallbackBookmarkName = this._getSessionBranchName(sessionId, workspaceIdentity);

        try {
            await fs.access(workspacePath);

            const mainBranchName = await this._getMainBranchName(repoPath);

            let changesNotPushed = 0;
            try {
                const baseRef = startCommit || mainBranchName;
                const { stdout: aheadCount } = await this.execPromise(
                    `jj -R "${workspacePath}" log -r "${baseRef}..@-" -T '"x\n"' --no-pager --no-graph 2>/dev/null | wc -l`
                );
                changesNotPushed = parseInt(aheadCount.trim()) || 0;
            } catch {
                changesNotPushed = 0;
            }

            let hasWorkingCopyChanges = false;
            try {
                const { stdout: statusOutput } = await this.execPromise(
                    `jj -R "${workspacePath}" status --no-pager`
                );
                hasWorkingCopyChanges = this._statusHasRelevantWorkingCopyChanges(statusOutput);
            } catch {
                hasWorkingCopyChanges = false;
            }

            const bookmarkInfos = await this._getBookmarkInfos(repoPath, sessionId, { ...options, fetchRemote });
            const officialBookmark = bookmarkInfos.find(info => info.pushed) || null;
            const bookmarkPushed = Boolean(officialBookmark);
            const mergeTargetRef = officialBookmark?.name || bookmarkInfos[0]?.name || null;
            const bookmarkName = mergeTargetRef || fallbackBookmarkName;
            const commitsAheadOfBase = await this._countCommitsAheadOfBase(
                repoPath,
                mainBranchName,
                mergeTargetRef
            );
            const needsIntegration = changesNotPushed > 0 || hasWorkingCopyChanges;
            const needsMerge = commitsAheadOfBase > 0;
            const shouldCheckConflicts = hasWorkingCopyChanges || changesNotPushed > 0 || needsMerge;
            const hasConflicts = shouldCheckConflicts
                ? await this._hasWorkingCopyConflicts(workspacePath)
                : false;

            return {
                exists: true,
                repoName,
                worktreePath: workspacePath,
                workspaceName,
                bookmarkName,
                officialBookmarkName: officialBookmark?.name || null,
                mainBranch: mainBranchName,
                changesNotPushed,
                hasWorkingCopyChanges,
                hasConflicts,
                bookmarkPushed,
                needsIntegration,
                needsMerge,
                commitsAheadOfBase,
                commitsAhead: changesNotPushed,
                hasUncommittedChanges: hasWorkingCopyChanges,
                conflicted: hasConflicts,
                branchName: this._getSessionBranchName(sessionId, workspaceIdentity),
                mergeTargetRef,
                workspaceId: workspaceIdentity.workspaceId,
                generation: workspaceIdentity.generation
            };
        } catch {
            return {
                exists: false,
                repoName,
                worktreePath: workspacePath,
                workspaceName,
                bookmarkName: fallbackBookmarkName,
                officialBookmarkName: null,
                needsIntegration: false,
                needsMerge: false,
                workspaceId: workspaceIdentity.workspaceId,
                generation: workspaceIdentity.generation
            };
        }
    }

    async _ensureGitCompatibility(sessionId, repoPath, workspacePath, options = {}) {
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, options);
        const branchName = this._getSessionBranchName(sessionId, options);
        const gitRoot = path.join(repoPath, '.git');
        const gitWorktreePath = path.join(gitRoot, 'worktrees', workspaceName);

        await fs.mkdir(gitWorktreePath, { recursive: true });

        const { stdout: headCommit } = await this.execPromise(
            `git -C "${repoPath}" rev-parse HEAD`
        );
        const commit = headCommit.trim();

        if (!commit) {
            throw new Error(`Failed to resolve HEAD commit for ${repoPath}`);
        }

        await this.execPromise(
            `git -C "${repoPath}" branch --force "${branchName}" "${commit}"`
        );

        await fs.writeFile(
            path.join(gitWorktreePath, 'gitdir'),
            path.join(workspacePath, '.git') + '\n'
        );
        await fs.writeFile(
            path.join(gitWorktreePath, 'commondir'),
            '../..\n'
        );
        await fs.writeFile(
            path.join(gitWorktreePath, 'HEAD'),
            `ref: refs/heads/${branchName}\n`
        );
        await fs.writeFile(
            path.join(workspacePath, '.git'),
            `gitdir: ${gitWorktreePath}\n`
        );

        await this._ensureGitExclude(gitWorktreePath, '.jj/');

        // Untrack .jj/ from git index if it was accidentally committed upstream.
        // .gitignore only prevents new tracking; already-tracked files need explicit removal.
        // Without this, git reset --hard restores a stale .jj/working_copy/checkout
        // from the parent commit, corrupting the jj workspace identity.
        try {
            await this.execPromise(`git -C "${workspacePath}" rm -r --cached .jj/ 2>/dev/null || true`);
        } catch {
            // .jj/ may not be tracked — that's fine
        }

        // Align the git worktree metadata with the freshly materialized JJ workspace.
        await this.execPromise(`git -C "${workspacePath}" reset --hard HEAD`);

        return { workspaceName, branchName, gitWorktreePath };
    }

    async _removeGitCompatibility(sessionId, repoPath, options = {}) {
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, options);
        const branchName = this._getSessionBranchName(sessionId, options);
        const gitWorktreePath = path.join(repoPath, '.git', 'worktrees', workspaceName);

        try {
            await fs.rm(gitWorktreePath, { recursive: true, force: true });
        } catch (err) {
            logger.info(`[workspace] Git metadata cleanup skipped: ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
            await this.execPromise(`git -C "${repoPath}" branch -D "${branchName}"`);
        } catch (err) {
            logger.info(`[workspace] Git branch cleanup skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * 新しいJujutsu workspaceを作成
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{worktreePath: string, branchName: string, repoPath: string}|null>}
     */
    async create(sessionId, repoPath, options = {}) {
        const { skipFetch = false } = options;
        await this.ensureWorktreesDir();

        const workspaceIdentity = this._getWorkspaceIdentity(sessionId, options);
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, workspaceIdentity);
        const workspacePath = path.join(this.worktreesDir, workspaceName);
        const bookmarkName = this._getSessionBranchName(sessionId, workspaceIdentity);

        try {
            // Check if directory exists first
            try {
                await fs.access(repoPath);
            } catch (accessErr) {
                throw new Error(`Directory does not exist: ${repoPath}. Please check your project configuration in config.yml (local.path or github setting).`);
            }

            // Check if Jujutsu is available
            const isJujutsu = await this._isJujutsuRepo(repoPath);
            if (!isJujutsu) {
                logger.info(`[workspace] Not a jj repo, auto-initializing at ${repoPath}...`);
                try {
                    await this.execPromise(`cd "${repoPath}" && jj git init --colocate`);
                    logger.info(`[workspace] jj git init --colocate succeeded at ${repoPath}`);
                    this._jjRepoCache.set(repoPath, true); // 初期化成功をキャッシュ
                } catch (initErr) {
                    throw new Error(`jj git init failed at ${repoPath}: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
                }
            }

            // Check if workspace already exists
            try {
                const { stdout: workspaceList } = await this._execJujutsuWithStaleRetry(
                    repoPath,
                    'workspace list'
                );
                if (workspaceList.includes(`${workspaceName}:`)) {
                    logger.info(`[workspace] Workspace already exists: ${workspaceName}, reusing`);
                    await this._ensureGitCompatibility(sessionId, repoPath, workspacePath, workspaceIdentity);
                    const mainBranchName = await this._getMainBranchName(repoPath);
                    const workspaceBaseRevision = await this._resolveWorkspaceBaseRevision(repoPath, mainBranchName);
                    const startCommit = await this._getWorkspaceStartCommit(workspacePath, workspaceBaseRevision);
                    return {
                        worktreePath: workspacePath,
                        branchName: this._getSessionBranchName(sessionId, workspaceIdentity),
                        repoPath,
                        startCommit,
                        workspaceName,
                        workspaceId: workspaceIdentity.workspaceId,
                        generation: workspaceIdentity.generation
                    };
                }
            } catch {
                // Workspace doesn't exist, continue to create
            }

            // Fetch latest from remote (skipFetch=trueで省略可能、2-3秒短縮)
            if (!skipFetch) {
                try {
                    await this._execJujutsuWithStaleRetry(repoPath, 'git fetch');
                } catch (fetchErr) {
                    logger.info(`[workspace] git fetch failed, continuing: ${fetchErr.message}`);
                }
            } else {
                logger.info(`[workspace] git fetch skipped (skipFetch=true)`);
            }

            const mainBranchName = await this._getMainBranchName(repoPath);
            const workspaceBaseRevision = await this._resolveWorkspaceBaseRevision(repoPath, mainBranchName);

            // Create workspace
            await this._execJujutsuWithStaleRetry(
                repoPath,
                `workspace add --name "${workspaceName}" -r "${workspaceBaseRevision}" --sparse-patterns full "${workspacePath}"`
            );
            logger.info(`[workspace] Created workspace: ${workspaceName} at ${workspacePath}`);

            // Run post-creation tasks in parallel (all non-critical, try-catch wrapped)
            const workspaceRoot = path.dirname(path.dirname(this.worktreesDir));
            const [gitResult, bookmarkResult, , , , startCommitResult] = await Promise.allSettled([
                this._ensureGitCompatibility(sessionId, repoPath, workspacePath, workspaceIdentity),
                this._execJujutsuWithStaleRetry(repoPath, `bookmark create -r ${workspaceBaseRevision} "${bookmarkName}"`),
                this._symlinkIfMissing(path.join(repoPath, '.env'), path.join(workspacePath, '.env'), '.env'),
                this._symlinkIfMissing(path.join(workspaceRoot, '.claude'), path.join(workspacePath, '.claude'), '.claude'),
                this._symlinkIfMissing(path.join(workspaceRoot, '.mcp.json'), path.join(workspacePath, '.mcp.json'), '.mcp.json'),
                this._getWorkspaceStartCommit(workspacePath, workspaceBaseRevision)
            ]);

            if (gitResult.status === 'fulfilled') {
                logger.info(`[workspace] Registered git worktree at ${gitResult.value?.gitWorktreePath}`);
            } else {
                logger.info(`[workspace] Git worktree registration failed (non-critical): ${gitResult.reason?.message || gitResult.reason}`);
            }
            if (bookmarkResult.status === 'fulfilled') {
                logger.info(`[workspace] Created bookmark: ${bookmarkName}`);
            } else {
                logger.info(`[workspace] Bookmark creation skipped: ${bookmarkResult.reason?.message || bookmarkResult.reason}`);
            }
            const startCommit = startCommitResult.status === 'fulfilled' ? startCommitResult.value : null;

            logger.info(`Created Jujutsu workspace at ${workspacePath}`);
            return {
                worktreePath: workspacePath,
                branchName: this._getSessionBranchName(sessionId, workspaceIdentity),
                repoPath,
                startCommit,
                workspaceName,
                workspaceId: workspaceIdentity.workspaceId,
                generation: workspaceIdentity.generation
            };
        } catch (err) {
            logger.error(`Failed to create workspace for ${sessionId}:`, err instanceof Error ? err.message : String(err));
            throw err;
        }
    }

    /**
     * Jujutsu workspaceを削除
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async remove(sessionId, repoPath, options = {}) {
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, options);
        const workspacePath = path.join(this.worktreesDir, workspaceName);

        try {
            // Forget workspace (metadata only)
            try {
                await this.execPromise(`jj -R "${repoPath}" workspace forget "${workspaceName}"`);
                logger.info(`[workspace] Forgot workspace: ${workspaceName}`);
            } catch (forgetErr) {
                logger.info(`[workspace] Workspace forget skipped: ${forgetErr instanceof Error ? forgetErr.message : String(forgetErr)}`);
            }

            // Delete canonical and legacy session bookmarks.
            for (const candidate of this._getSessionBookmarkCandidates(sessionId, options)) {
                try {
                    await this.execPromise(`jj -R "${repoPath}" bookmark delete "${candidate}"`);
                    logger.info(`[workspace] Deleted bookmark: ${candidate}`);
                } catch (bookmarkErr) {
                    logger.info(`[workspace] Bookmark deletion skipped: ${bookmarkErr instanceof Error ? bookmarkErr.message : String(bookmarkErr)}`);
                }
            }

            // Remove physical directory — must succeed to prevent zombie worktrees
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
                logger.info(`[workspace] Removed physical directory: ${workspacePath}`);
            } catch (rmErr) {
                logger.warn(`[workspace] Directory removal failed for ${workspacePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`);
            }

            // Verify removal — zombie prevention
            try {
                await fs.access(workspacePath);
                logger.warn(`[workspace] Zombie worktree still exists after remove: ${workspacePath}`);
                return false;
            } catch {
                // Expected: directory no longer exists
            }

            await this._removeGitCompatibility(sessionId, repoPath, options);

            return true;
        } catch (err) {
            logger.error(`Failed to remove workspace for ${sessionId}:`, err instanceof Error ? err.message : String(err));
            return false;
        }
    }

    async _retireWorkspaceGeneration(sessionId, repoPath, options = {}) {
        const workspaceIdentity = this._getWorkspaceIdentity(sessionId, options);
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, workspaceIdentity);
        const workspacePath = options.workspacePath || path.join(this.worktreesDir, workspaceName);

        try {
            await this._execJujutsuWithStaleRetry(
                repoPath,
                `workspace forget "${workspaceName}"`,
                { retryStale: false }
            );
        } catch (forgetErr) {
            logger.info(`[merge] Workspace forget skipped: ${forgetErr instanceof Error ? forgetErr.message : String(forgetErr)}`);
        }

        for (const candidate of this._getSessionBookmarkCandidates(sessionId, workspaceIdentity)) {
            try {
                await this._execJujutsuWithStaleRetry(
                    repoPath,
                    `bookmark delete "${candidate}"`,
                    { retryStale: false }
                );
            } catch (bookmarkErr) {
                logger.info(`[merge] Bookmark deletion skipped: ${bookmarkErr instanceof Error ? bookmarkErr.message : String(bookmarkErr)}`);
            }
        }

        try {
            await fs.rm(workspacePath, { recursive: true, force: true });
            logger.info(`[merge] Removed physical directory: ${workspacePath}`);
        } catch (rmErr) {
            logger.warn(`[merge] Directory removal failed for ${workspacePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`);
        }

        try {
            await fs.access(workspacePath);
            logger.warn(`[merge] Zombie worktree still exists after merge cleanup: ${workspacePath}`);
            return {
                success: false,
                error: 'Worktree cleanup failed after merge',
                workspaceId: workspaceIdentity.workspaceId,
                workspaceName,
                workspacePath
            };
        } catch {
            // Expected: directory no longer exists
        }

        await this._removeGitCompatibility(sessionId, repoPath, workspaceIdentity);

        return {
            success: true,
            workspaceId: workspaceIdentity.workspaceId,
            generation: workspaceIdentity.generation,
            workspaceName,
            workspacePath,
            branchName: this._getSessionBranchName(sessionId, workspaceIdentity)
        };
    }

    async _readPrMergeMetadata(prUrl, ghRepoSpec) {
        try {
            const { stdout } = await this.execPromise(
                `gh pr view "${String(prUrl).trim()}" --repo "${ghRepoSpec}" --json mergedAt,mergeCommit --jq '{mergedAt, mergeCommit: .mergeCommit.oid}'`
            );
            const parsed = JSON.parse(stdout || '{}');
            return {
                mergedAt: parsed.mergedAt || null,
                mergeCommit: parsed.mergeCommit || null
            };
        } catch (error) {
            logger.info(`[merge] PR merge metadata lookup skipped: ${error instanceof Error ? error.message : String(error)}`);
            return { mergedAt: null, mergeCommit: null };
        }
    }

    /**
     * Jujutsu workspaceの状態を取得
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {string|null} startCommit - セッション開始時のコミットハッシュ
     * @returns {Promise<Object>} workspace状態情報
     */
    async getStatus(sessionId, repoPath, startCommit = null, options = {}) {
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, options);
        const workspacePath = path.join(this.worktreesDir, workspaceName);
        return await this._collectStatus(sessionId, repoPath, workspacePath, startCommit, options);
    }

    async autoHealArchiveState(sessionId, repoPath, workspacePath, startCommit = null) {
        const statusBefore = await this._collectStatus(sessionId, repoPath, workspacePath, startCommit);
        const result = {
            attempted: false,
            healed: false,
            reason: 'nothing_to_fix',
            actions: [],
            statusBefore,
            statusAfter: statusBefore
        };

        if (!statusBefore.exists) {
            return { ...result, reason: 'no_workspace' };
        }

        if (!statusBefore.hasWorkingCopyChanges) {
            return {
                ...result,
                reason: statusBefore.changesNotPushed > 0 ? 'changes_not_pushed' : 'already_clean'
            };
        }

        if (statusBefore.changesNotPushed > 0) {
            return { ...result, reason: 'changes_not_pushed' };
        }

        const bookmarkInfos = await this._getBookmarkInfos(repoPath, sessionId);
        const archiveTarget = await this._resolveArchiveTargetBookmark(
            sessionId,
            repoPath,
            workspacePath,
            bookmarkInfos
        );
        if (!archiveTarget) {
            return { ...result, reason: 'missing_official_bookmark' };
        }

        const workspaceMatches = archiveTarget.adoptSessionBookmark
            ? await this._workspaceMatchesGitHead(workspacePath)
            : await this._workspaceMatchesBookmark(workspacePath, archiveTarget.bookmarkName);
        if (!workspaceMatches) {
            return { ...result, reason: 'working_copy_differs' };
        }

        const staleLocalBookmarks = bookmarkInfos.filter(
            info => info.name !== this._getSessionBranchName(sessionId) && !info.pushed
        );

        result.attempted = true;

        if (archiveTarget.adoptSessionBookmark) {
            const sessionBranchName = this._getSessionBranchName(sessionId);
            await this.execPromise(
                `jj -R "${repoPath}" bookmark set "${sessionBranchName}" -r "${archiveTarget.bookmarkName}"`
            );
            result.actions.push(`move-bookmark:${sessionBranchName}->${archiveTarget.bookmarkName}`);
        }

        for (const bookmark of staleLocalBookmarks) {
            await this.execPromise(`jj -R "${repoPath}" bookmark delete "${bookmark.name}"`);
            result.actions.push(`delete-bookmark:${bookmark.name}`);
        }

        await this.execPromise(
            `jj -R "${workspacePath}" new "${this._getSessionBranchName(sessionId)}" -m "wip: archive clean working copy"`
        );
        result.actions.push(`reset-working-copy:${this._getSessionBranchName(sessionId)}`);

        await this.execPromise(`jj -R "${repoPath}" git export`);
        result.actions.push('git-export');

        const statusAfter = await this._collectStatus(sessionId, repoPath, workspacePath, startCommit);
        result.statusAfter = statusAfter;
        result.healed = !statusAfter.hasWorkingCopyChanges && statusAfter.changesNotPushed === 0;
        result.reason = result.healed ? 'healed' : 'post_heal_still_dirty';

        return result;
    }

    /**
     * ローカルmainを更新（Jujutsu: jj git fetch）
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{success: boolean, updated?: boolean, error?: string, mainBranch?: string}>}
     */
    async updateLocalMain(repoPath, options = {}) {
        const mainBranchName = await this._getMainBranchName(repoPath);

        try {
            // Fetch latest from remote
            await this.execPromise(`jj -R "${repoPath}" git fetch`);
        } catch (err) {
            return { success: false, error: `fetch失敗: ${err instanceof Error ? err.message : String(err)}` };
        }

        // Jujutsu doesn't need explicit "update local main" like Git
        // The main bookmark is automatically updated on fetch
        return { success: true, updated: true, mainBranch: mainBranchName };
    }

    /**
     * mainブランチ名を取得
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<string>}
     */
    async _getMainBranchName(repoPath) {
        const { stdout: mainBranch } = await this.execPromise(
            `git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
        );
        return mainBranch.trim() || 'main';
    }

    async _getGitHubRepoSpec(repoPath) {
        const { stdout } = await this.execPromise(`git -C "${repoPath}" remote get-url origin`);
        const repoSpec = parseGitHubRepoSpec(stdout);
        if (!repoSpec) {
            throw new Error(`Unable to derive GitHub repo from origin remote: ${stdout.trim() || '(empty)'}`);
        }
        return repoSpec;
    }

    async _resolveWorkspaceBaseRevision(repoPath, preferredRevision) {
        const candidates = [preferredRevision, 'main', 'trunk()']
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index);

        for (const candidate of candidates) {
            try {
                await this.execPromise(
                    `jj -R "${repoPath}" --ignore-working-copy log -r "${candidate}" -T 'commit_id ++ "\\n"' --no-pager`
                );
                return candidate;
            } catch {
                // try next candidate
            }
        }

        throw new Error(`Unable to resolve Jujutsu workspace base revision for ${repoPath}`);
    }

    async _getWorkspaceStartCommit(workspacePath, preferredRevision) {
        const candidates = [preferredRevision, '@-', 'main', 'trunk()']
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index);

        for (const candidate of candidates) {
            try {
                const { stdout } = await this.execPromise(
                    `jj -R "${workspacePath}" --ignore-working-copy log -r "${candidate}" -T 'commit_id ++ "\\n"' --no-pager`
                );
                const commit = stdout
                    .split('\n')
                    .map((line) => line.trim())
                    .find(Boolean);
                if (commit) {
                    return commit;
                }
            } catch {
                // try next candidate
            }
        }

        throw new Error(`Unable to resolve workspace start commit for ${workspacePath}`);
    }

    /**
     * Jujutsu workspaceをベースブランチにマージ（PR経由）
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {string|null} sessionName - セッション名（オプション）
     * @returns {Promise<{success: boolean, message?: string, error?: string, needsCommit?: boolean, hasConflicts?: boolean, prUrl?: string}>}
     */
    async merge(sessionId, repoPath, sessionName = null, options = {}) {
        try {
            const workspaceIdentity = this._getWorkspaceIdentity(sessionId, options);
            // Get main branch name
            const mainBranchName = await this._getMainBranchName(repoPath);
            const ghRepoSpec = await this._getGitHubRepoSpec(repoPath);
            const bookmarkName = await this._resolveMergeBookmarkName(sessionId, repoPath, workspaceIdentity);

            // Push bookmark to remote
            logger.info(`[merge] Pushing bookmark: ${bookmarkName}`);
            try {
                await this._pushBookmarkForMerge(repoPath, bookmarkName);
            } catch (pushErr) {
                return {
                    success: false,
                    error: `Push failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`
                };
            }

            // Get commits for PR description
            const { stdout: commits } = await this._execJujutsuWithStaleRetry(
                repoPath,
                `log -r "${mainBranchName}..${bookmarkName}" -T '"- " ++ description.first_line() ++ "\\n"' --no-pager`,
                { retryStale: false }
            );

            // Build PR title
            const displayName = sessionName || sessionId;
            const prTitle = `Merge session: ${displayName}`;

            // Create PR
            logger.info(`[merge] Creating PR for ${bookmarkName}`);
            const { stdout: prUrl } = await this.execPromise(
                `gh pr create --base "${mainBranchName}" --head "${bookmarkName}" --title "${prTitle}" --body "$(cat <<'EOF'
## Summary

${commits || 'No commit messages'}

## Test plan

- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --repo "${ghRepoSpec}"
            `);

            // Merge PR
            logger.info(`[merge] Merging PR`);
            await this.execPromise(`gh pr merge "${prUrl.trim()}" --repo "${ghRepoSpec}" --merge --delete-branch`);
            const mergeMetadata = options.rotateAfterMerge
                ? await this._readPrMergeMetadata(prUrl.trim(), ghRepoSpec)
                : { mergedAt: null, mergeCommit: null };
            const mergedAt = mergeMetadata.mergedAt || new Date().toISOString();

            const deployGuard = await this.syncCanonicalWorkspaceAfterMerge(repoPath, mainBranchName);
            if (!deployGuard.success) {
                return {
                    success: false,
                    merged: true,
                    rotationBlocked: Boolean(options.rotateAfterMerge),
                    error: `Merged PR but canonical workspace deploy guard failed: ${deployGuard.reason || 'unknown'}`,
                    prUrl: prUrl.trim(),
                    mergedAt,
                    mergeCommit: mergeMetadata.mergeCommit,
                    deployGuard
                };
            }

            const retired = await this._retireWorkspaceGeneration(sessionId, repoPath, {
                ...workspaceIdentity,
                workspacePath: options.workspacePath
            });
            const retiredGeneration = {
                workspaceId: workspaceIdentity.workspaceId,
                generation: workspaceIdentity.generation,
                workspaceName: retired.workspaceName,
                path: retired.workspacePath,
                branch: bookmarkName,
                mergedPrUrl: prUrl.trim(),
                mergedAt,
                mergeCommit: mergeMetadata.mergeCommit,
                retiredAt: new Date().toISOString()
            };

            if (!retired.success) {
                return {
                    success: false,
                    merged: true,
                    rotationBlocked: Boolean(options.rotateAfterMerge),
                    error: retired.error,
                    prUrl: prUrl.trim(),
                    mergedAt,
                    mergeCommit: mergeMetadata.mergeCommit,
                    rotation: {
                        retired: retiredGeneration,
                        active: null
                    }
                };
            }

            if (!options.rotateAfterMerge) {
                logger.info(`[merge] Merged ${bookmarkName} into ${mainBranchName}`);
                return {
                    success: true,
                    message: 'Merged via PR',
                    prUrl: prUrl.trim(),
                    mergedAt,
                    mergeCommit: mergeMetadata.mergeCommit,
                    deployGuard,
                    rotation: {
                        retired: retiredGeneration,
                        active: null
                    }
                };
            }

            let active;
            try {
                const nextWorkspace = this._nextWorkspaceIdentity(sessionId, workspaceIdentity);
                const worktreeResult = await this.create(sessionId, repoPath, {
                    workspaceId: nextWorkspace.workspaceId,
                    generation: nextWorkspace.generation,
                    skipFetch: true
                });
                active = {
                    workspaceId: worktreeResult.workspaceId,
                    generation: worktreeResult.generation,
                    workspaceName: worktreeResult.workspaceName,
                    path: worktreeResult.worktreePath,
                    branch: worktreeResult.branchName,
                    startCommit: worktreeResult.startCommit,
                    repo: repoPath
                };
            } catch (rotationErr) {
                return {
                    success: false,
                    merged: true,
                    rotationBlocked: true,
                    error: `Merged PR but workspace generation rotation failed: ${rotationErr instanceof Error ? rotationErr.message : String(rotationErr)}`,
                    prUrl: prUrl.trim(),
                    mergedAt,
                    mergeCommit: mergeMetadata.mergeCommit,
                    rotation: {
                        retired: retiredGeneration,
                        active: null
                    }
                };
            }

            logger.info(`[merge] Merged ${bookmarkName} into ${mainBranchName} and rotated workspace to ${active.workspaceId}`);
            return {
                success: true,
                message: 'Merged via PR and rotated workspace generation',
                prUrl: prUrl.trim(),
                mergedAt,
                mergeCommit: mergeMetadata.mergeCommit,
                deployGuard,
                rotation: {
                    retired: retiredGeneration,
                    active
                }
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Failed to merge workspace for ${sessionId}:`, message);
            return { success: false, error: message };
        }
    }

    /**
     * コミットログを取得
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {number} [limit=50] - 取得件数
     * @returns {Promise<{commits: Array, repoType: string, repoName: string, worktreePath: string}>}
     */
    async getCommitLog(sessionId, repoPath, limit = 50) {
        const dirName = path.basename(repoPath);
        const workspaceName = `${sessionId}-${dirName}`;
        const workspacePath = path.join(this.worktreesDir, workspaceName);

        // Check if workspace exists
        try {
            await fs.access(workspacePath);
        } catch {
            return { commits: [], repoType: 'unknown', repoName: dirName, worktreePath: workspacePath };
        }

        const isJujutsu = await this._isJujutsuRepo(repoPath);
        const repoName = await this._getRemoteRepoName(repoPath, isJujutsu) || dirName;

        if (isJujutsu) {
            const result = await this._getJujutsuCommitLog(workspacePath, limit);
            return { ...result, repoName };
        }
        const result = await this._getGitCommitLog(workspacePath, limit);
        return { ...result, repoName };
    }

    /**
     * パス直接指定でコミットログを取得
     * @param {string} repoPath - リポジトリのパス
     * @param {number} limit - 取得するコミット数
     */
    async getCommitLogByPath(repoPath, limit = 50) {
        const dirName = path.basename(repoPath);

        // Check if repo exists
        try {
            await fs.access(repoPath);
        } catch {
            return { commits: [], repoType: 'unknown', repoName: dirName, worktreePath: repoPath };
        }

        const isJujutsu = await this._isJujutsuRepo(repoPath);
        const repoName = await this._getRemoteRepoName(repoPath, isJujutsu) || dirName;

        if (isJujutsu) {
            const result = await this._getJujutsuCommitLog(repoPath, limit);
            return { ...result, repoName };
        }
        const result = await this._getGitCommitLog(repoPath, limit);
        return { ...result, repoName };
    }

    /**
     * Jujutsuのコミットログを取得
     * @private
     */
    async _getJujutsuCommitLog(workspacePath, limit) {
        try {
            const template = 'commit_id ++ "\\x00" ++ description.first_line() ++ "\\x00" ++ committer.timestamp() ++ "\\x00" ++ author.name() ++ "\\x00" ++ bookmarks ++ "\\x00" ++ if(self.working_copies(), "true", "false") ++ "\\x00" ++ parents.map(|c| c.commit_id()).join(",") ++ "\\n"';
            const { stdout } = await this.execPromise(
                `jj -R "${workspacePath}" log -r "::@" -T '${template}' --no-graph --no-pager -n ${limit}`
            );

            const commits = this._parseJujutsuLog(stdout);
            return { commits, repoType: 'jj', worktreePath: workspacePath };
        } catch (err) {
            logger.error(`[commitLog] jj log failed for ${workspacePath}:`, err instanceof Error ? err.message : String(err));
            return { commits: [], repoType: 'jj', worktreePath: workspacePath };
        }
    }

    /**
     * Jujutsuログ出力をパース
     * @private
     */
    _parseJujutsuLog(stdout) {
        if (!stdout || !stdout.trim()) return [];

        return stdout.trim().split('\n')
            .filter(line => line.includes('\x00'))
            .map(line => {
                const parts = line.split('\x00');
                const hash = (parts[0] || '').trim();
                const parentStr = (parts[6] || '').trim();
                return {
                    hash: hash.substring(0, 12),
                    description: (parts[1] || '').trim() || '(empty)',
                    timestamp: (parts[2] || '').trim(),
                    author: (parts[3] || '').trim(),
                    bookmarks: (parts[4] || '').trim().split(/\s+/).filter(Boolean),
                    isWorkingCopy: (parts[5] || '').trim() === 'true',
                    parents: parentStr ? parentStr.split(',').map(p => p.trim().substring(0, 12)) : []
                };
            });
    }

    /**
     * Gitのコミットログを取得（フォールバック）
     * @private
     */
    async _getGitCommitLog(workspacePath, limit) {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${workspacePath}" log --format="%h%x00%s%x00%aI%x00%an%x00%D%x00%p%x00" -n ${limit}`
            );

            const commits = this._parseGitLog(stdout);
            // Mark first commit as working copy
            if (commits.length > 0) {
                commits[0].isWorkingCopy = true;
            }
            return { commits, repoType: 'git', worktreePath: workspacePath };
        } catch (err) {
            logger.error(`[commitLog] git log failed for ${workspacePath}:`, err instanceof Error ? err.message : String(err));
            return { commits: [], repoType: 'git', worktreePath: workspacePath };
        }
    }

    /**
     * Gitログ出力をパース
     * @private
     */
    _parseGitLog(stdout) {
        if (!stdout || !stdout.trim()) return [];

        return stdout.trim().split('\n')
            .filter(line => line.includes('\x00'))
            .map(line => {
                const parts = line.split('\x00');
                const parentStr = (parts[5] || '').trim();
                return {
                    hash: (parts[0] || '').trim(),
                    description: (parts[1] || '').trim() || '(empty)',
                    timestamp: (parts[2] || '').trim(),
                    author: (parts[3] || '').trim(),
                    bookmarks: (parts[4] || '').trim().split(/,\s*/).filter(Boolean),
                    isWorkingCopy: false,
                    parents: parentStr ? parentStr.split(' ').filter(Boolean) : []
                };
            });
    }

    /**
     * origin remoteのURLからリポジトリ名を取得
     * @private
     * @param {string} repoPath - リポジトリパス
     * @param {boolean} isJujutsu - jjリポジトリかどうか
     * @returns {Promise<string|null>}
     */
    async _getRemoteRepoName(repoPath, isJujutsu) {
        try {
            let url;
            if (isJujutsu) {
                const { stdout } = await this.execPromise(
                    `jj -R "${repoPath}" git remote list --no-pager 2>/dev/null`
                );
                const originLine = stdout.split('\n').find(l => l.startsWith('origin '));
                url = originLine?.split(/\s+/)[1];
            } else {
                const { stdout } = await this.execPromise(
                    `git -C "${repoPath}" remote get-url origin 2>/dev/null`
                );
                url = stdout.trim();
            }
            if (!url) return null;
            // Extract repo name from URL: https://github.com/Org/repo-name.git → repo-name
            const match = url.match(/\/([^/]+?)(?:\.git)?$/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /**
     * 全てのJujutsu workspaceをリストアップ
     * @returns {Promise<Array<{name: string, path: string, isMain: boolean}>>}
     */
    async listWorktrees() {
        try {
            const { stdout } = await this.execPromise(
                `jj -R "${this.canonicalRoot}" workspace list --no-pager`
            );

            const workspaces = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                const match = line.match(/^(\S+):/);
                if (match) {
                    const name = match[1];
                    const isMain = name === 'default';
                    const workspacePath = isMain
                        ? this.canonicalRoot
                        : path.join(this.worktreesDir, name);

                    workspaces.push({
                        name,
                        path: workspacePath,
                        branch: isMain ? 'main' : `session/${name.split('-')[0]}`,
                        isMain
                    });
                }
            }

            return workspaces;
        } catch (err) {
            logger.error('Failed to list workspaces:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }
}

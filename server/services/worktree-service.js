// @ts-check
/**
 * WorktreeService
 * Git worktree操作を管理するサービス
 *
 * 2026-07-11: Jujutsu(jj)依存を撤去し、gitネイティブ実装へ移行した
 * (story-worktree-service-git-migration)。
 * - セッションworktreeのライフサイクルは `git worktree add/remove` で完結する。
 * - 正本repoマージデプロイガードは `git rev-parse` / `git status --porcelain` /
 *   `git diff --name-only` を用いて同等の保護レベルを維持する。
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
        this._gitRepoCache = new Map();  // repoPath単位のキャッシュ
        this._repoMutex = new Map();    // repoPath -> Promise (last in chain)
    }

    /**
     * 同一 repoPath への git書き込みを直列化する。
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
     * Gitリポジトリかどうかを判定
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async _isGitRepo(repoPath) {
        if (this._gitRepoCache.has(repoPath)) {
            return this._gitRepoCache.get(repoPath);
        }
        try {
            await this.execPromise(`git -C "${repoPath}" rev-parse --git-dir`);
            this._gitRepoCache.set(repoPath, true);
            return true;
        } catch {
            this._gitRepoCache.set(repoPath, false);
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
     * `git worktree list --porcelain` の出力をパースする
     * @param {string} stdout
     * @returns {Array<{path: string, branch: string|null}>}
     */
    _parseWorktreeListPorcelain(stdout) {
        const worktrees = [];
        let current = null;

        for (const line of String(stdout || '').split('\n')) {
            if (line.startsWith('worktree ')) {
                if (current) worktrees.push(current);
                current = { path: line.slice('worktree '.length).trim(), branch: null };
            } else if (line.startsWith('branch ')) {
                if (current) {
                    current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
                }
            } else if (!line.trim()) {
                if (current) {
                    worktrees.push(current);
                    current = null;
                }
            }
        }
        if (current) worktrees.push(current);

        return worktrees;
    }

    /**
     * ゾンビworktreeを検出して物理ディレクトリを削除する。
     * ゾンビ = `.git`（file/dir）は存在するが、`git worktree list --porcelain` に登録されていないworktree。
     * worktree removeされたが物理ディレクトリが残った状態を自動クリーンアップする。
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

            let registeredPaths;
            try {
                const { stdout } = await this.execPromise(`git -C "${repoPath}" worktree list --porcelain`);
                registeredPaths = new Set(
                    this._parseWorktreeListPorcelain(stdout).map((w) => path.resolve(w.path))
                );
            } catch {
                return removed;
            }

            for (const dir of dirs) {
                const worktreePath = path.join(this.worktreesDir, dir);
                const gitPath = path.join(worktreePath, '.git');
                try {
                    await fs.access(gitPath);
                } catch {
                    continue;
                }

                if (registeredPaths.has(path.resolve(worktreePath))) continue;

                logger.warn(`[workspace] Zombie worktree detected: ${dir} (not in git worktree list). Removing.`);
                try {
                    await fs.rm(worktreePath, { recursive: true, force: true });
                    removed.push(dir);
                    logger.info(`[workspace] Zombie worktree removed: ${dir}`);
                } catch (rmErr) {
                    logger.error(`[workspace] Failed to remove zombie worktree ${dir}: ${rmErr.message}`);
                }
            }

            if (removed.length > 0) {
                try {
                    await this.execPromise(`git -C "${repoPath}" worktree prune`);
                } catch {
                    // best-effort
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

    _getSessionBranchCandidates(sessionId, options = {}) {
        const { workspaceId } = this._getWorkspaceIdentity(sessionId, options);
        const candidates = [this._getSessionBranchName(sessionId, options), workspaceId];
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

    async _getGitCommitId(repoPath, revspec) {
        try {
            const { stdout } = await this.execPromise(`git -C "${repoPath}" rev-parse "${revspec}"`);
            return stdout.trim() || null;
        } catch {
            return null;
        }
    }

    async _resolveMainCommit(repoPath, mainBranchName) {
        const candidates = [
            `refs/remotes/origin/${mainBranchName}`,
            `refs/heads/${mainBranchName}`
        ];
        for (const candidate of candidates) {
            const commit = await this._getGitCommitId(repoPath, candidate);
            if (commit) return commit;
        }
        return null;
    }

    async _getGitStatusPorcelain(repoPath) {
        try {
            const { stdout } = await this.execPromise(`git -C "${repoPath}" status --porcelain`);
            return stdout;
        } catch {
            return '';
        }
    }

    async _getGitDiffNameOnly(repoPath, fromRef, toRef) {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${repoPath}" diff --name-only "${fromRef}" "${toRef}"`
            );
            return stdout;
        } catch {
            return '';
        }
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

        if (!await this._isGitRepo(repoPath)) {
            return {
                ...baseStatus,
                ready: false,
                reason: 'not_git_repo',
                error: 'Canonical Brainbase repo must be a Git repo for merge deployment guard'
            };
        }

        try {
            if (fetchRemote) {
                await this._execGitWithLockRetry(repoPath, 'fetch origin');
            }

            const [headCommit, mainCommit, statusOutput] = await Promise.all([
                this._getGitCommitId(repoPath, 'HEAD'),
                this._resolveMainCommit(repoPath, resolvedMainBranchName),
                this._getGitStatusPorcelain(repoPath)
            ]);
            const hasRelevantWorkingCopyChanges = this._statusHasRelevantWorkingCopyChanges(statusOutput);

            if (hasRelevantWorkingCopyChanges) {
                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'canonical_workspace_dirty',
                    defaultCommit: headCommit,
                    mainCommit
                };
            }

            if (!headCommit || !mainCommit) {
                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'unresolved_git_revision',
                    defaultCommit: headCommit,
                    mainCommit
                };
            }

            if (headCommit !== mainCommit) {
                const diffPaths = await this._getGitDiffNameOnly(repoPath, mainCommit, headCommit);
                if (!this._diffOutputHasRelevantPaths(diffPaths)) {
                    return {
                        ...baseStatus,
                        reason: 'ok_ignored_artifact_delta',
                        defaultCommit: headCommit,
                        mainCommit
                    };
                }

                return {
                    ...baseStatus,
                    ready: false,
                    reason: 'canonical_workspace_not_deployed',
                    defaultCommit: headCommit,
                    mainCommit
                };
            }

            return { ...baseStatus, defaultCommit: headCommit, mainCommit };
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
            await this._execGitWithLockRetry(repoPath, 'fetch origin');
            await this._execGitWithLockRetry(repoPath, `checkout -B "${mainBranchName}" "origin/${mainBranchName}"`);
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

    /**
     * repo lockの下でgitコマンドを実行し、`.git/index.lock` の stale回復を1回だけ試みる。
     */
    async _execGitWithLockRetry(repoPath, command) {
        const fullCommand = `git -C "${repoPath}" ${command}`;

        return this._withRepoLock(repoPath, async () => {
            try {
                return await this.execPromise(fullCommand);
            } catch (error) {
                if (this._isIndexLockError(error) && await this._recoverStaleLockfile(repoPath)) {
                    return await this.execPromise(fullCommand);
                }

                throw error;
            }
        });
    }

    async _gitRefExists(repoPath, ref) {
        try {
            await this.execPromise(`git -C "${repoPath}" rev-parse --verify "${ref}"`);
            return true;
        } catch {
            return false;
        }
    }

    async _getBranchInfos(repoPath, sessionId, options = {}) {
        const { fetchRemote = true } = options;

        if (fetchRemote) {
            try {
                await this.execPromise(`git -C "${repoPath}" fetch origin`);
            } catch (fetchErr) {
                logger.info(`[getStatus] git fetch failed, continuing: ${fetchErr.message}`);
            }
        }

        const branchCandidates = this._getSessionBranchCandidates(sessionId, options);
        const infos = [];

        for (const candidate of branchCandidates) {
            const localExists = await this._gitRefExists(repoPath, `refs/heads/${candidate}`);
            if (!localExists) continue;

            const pushed = await this._gitRefExists(repoPath, `refs/remotes/origin/${candidate}`);
            infos.push({
                name: candidate,
                pushed,
                output: pushed ? `${candidate}@origin` : candidate
            });
        }

        return infos;
    }

    async _resolveMergeBranchName(sessionId, repoPath, options = {}) {
        const branchInfos = await this._getBranchInfos(repoPath, sessionId, { ...options, fetchRemote: false });
        return branchInfos.find(info => info.pushed)?.name
            || branchInfos[0]?.name
            || this._getSessionBranchName(sessionId, options);
    }

    async _pushBranchForMerge(repoPath, branchName) {
        await this._execGitWithLockRetry(repoPath, `push origin "${branchName}"`);
    }

    async _resolveGitRefForBranch(workspacePath, branchName) {
        const refCandidates = [
            `refs/remotes/origin/${branchName}`,
            `origin/${branchName}`,
            branchName
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

    async _workspaceMatchesBranch(workspacePath, branchName) {
        const gitRef = await this._resolveGitRefForBranch(workspacePath, branchName);
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
                `git -C "${repoPath}" rev-list --count "${baseRef}..${targetRef}"`
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

    /**
     * `git status --porcelain` の1行から対象パスを取り出す。
     * リネーム/コピー行（`old -> new`）は既存の `{from => to}` 判定ロジックへ正規化する。
     */
    _extractPorcelainStatusPath(line) {
        const rest = line.slice(3);
        const renameMatch = rest.match(/^(.+) -> (.+)$/);
        if (renameMatch) {
            return `{${renameMatch[1]} => ${renameMatch[2]}}`;
        }
        return rest;
    }

    _statusHasRelevantWorkingCopyChanges(statusOutput) {
        return String(statusOutput || '')
            .split('\n')
            .some((line) => {
                if (!line.trim()) return false;
                const filePath = this._extractPorcelainStatusPath(line);
                if (!filePath) return false;
                return !this._isWorkspaceArtifactStatusPath(filePath);
            });
    }

    /**
     * Classify a `git ls-files -u` failure as a benign no-conflicts result.
     * "not a git repository": the workspace directory disappeared/was never a git
     * worktree (e.g. mid-teardown race). This is a legitimate state and must not
     * spam the error log on every poll.
     */
    _isBenignConflictInspectError(output) {
        const text = String(output || '');
        return /not a git repository/i.test(text);
    }

    async _hasWorkingCopyConflicts(workspacePath) {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${workspacePath}" ls-files -u`
            );
            return stdout.trim().length > 0;
        } catch (error) {
            const output = `${error?.stdout || ''}\n${error?.stderr || ''}\n${error?.message || ''}`;
            if (this._isBenignConflictInspectError(output)) {
                return false;
            }
            logger.warn(`[workspace] Failed to inspect conflicts for ${workspacePath}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    _diffOutputHasRelevantPaths(diffOutput) {
        return String(diffOutput || '')
            .split('\n')
            .some((line) => {
                const filePath = line.trim();
                if (!filePath) return false;
                return !this._isWorkspaceArtifactStatusPath(filePath);
            });
    }

    async _resolveArchiveTargetBranch(sessionId, repoPath, workspacePath, branchInfos) {
        const officialBranch = branchInfos.find(info => info.pushed) || null;
        if (officialBranch) {
            return {
                bookmarkName: officialBranch.name,
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
        const fallbackBranchName = this._getSessionBranchName(sessionId, workspaceIdentity);

        try {
            await fs.access(workspacePath);

            const mainBranchName = await this._getMainBranchName(repoPath);

            let changesNotPushed = 0;
            try {
                const baseRef = startCommit || mainBranchName;
                const { stdout: aheadCount } = await this.execPromise(
                    `git -C "${workspacePath}" rev-list --count "${baseRef}..HEAD"`
                );
                changesNotPushed = parseInt(aheadCount.trim(), 10) || 0;
            } catch {
                changesNotPushed = 0;
            }

            let hasWorkingCopyChanges = false;
            try {
                const { stdout: statusOutput } = await this.execPromise(
                    `git -C "${workspacePath}" status --porcelain`
                );
                hasWorkingCopyChanges = this._statusHasRelevantWorkingCopyChanges(statusOutput);
            } catch {
                hasWorkingCopyChanges = false;
            }

            const branchInfos = await this._getBranchInfos(repoPath, sessionId, { ...options, fetchRemote });
            const officialBranch = branchInfos.find(info => info.pushed) || null;
            const bookmarkPushed = Boolean(officialBranch);
            const mergeTargetRef = officialBranch?.name || branchInfos[0]?.name || null;
            const bookmarkName = mergeTargetRef || fallbackBranchName;
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
                officialBookmarkName: officialBranch?.name || null,
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
                bookmarkName: fallbackBranchName,
                officialBookmarkName: null,
                needsIntegration: false,
                needsMerge: false,
                workspaceId: workspaceIdentity.workspaceId,
                generation: workspaceIdentity.generation
            };
        }
    }

    _isBranchAlreadyExistsError(err) {
        const message = err instanceof Error ? err.message : String(err || '');
        return /already exists/i.test(message) && /branch/i.test(message);
    }

    _isWorktreeAlreadyExistsError(err) {
        const message = err instanceof Error ? err.message : String(err || '');
        return /already exists/i.test(message) && !/branch/i.test(message);
    }

    async _reuseExistingWorkspace(sessionId, repoPath, workspacePath, workspaceName, workspaceIdentity) {
        logger.info(`[workspace] Workspace already exists: ${workspaceName}, reusing`);
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

    /**
     * 新しいgit worktreeを作成
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
        const branchName = this._getSessionBranchName(sessionId, workspaceIdentity);

        try {
            // Check if directory exists first
            try {
                await fs.access(repoPath);
            } catch {
                throw new Error(`Directory does not exist: ${repoPath}. Please check your project configuration in config.yml (local.path or github setting).`);
            }

            // Check if this is a git repo; auto-initialize otherwise
            const isGitRepo = await this._isGitRepo(repoPath);
            if (!isGitRepo) {
                logger.info(`[workspace] Not a git repo, auto-initializing at ${repoPath}...`);
                try {
                    await this.execPromise(`git -C "${repoPath}" init`);
                    logger.info(`[workspace] git init succeeded at ${repoPath}`);
                    this._gitRepoCache.set(repoPath, true); // 初期化成功をキャッシュ
                } catch (initErr) {
                    throw new Error(`git init failed at ${repoPath}: ${initErr instanceof Error ? initErr.message : String(initErr)}`);
                }
            }

            // Check if worktree already registered
            try {
                const { stdout: worktreeList } = await this._execGitWithLockRetry(repoPath, 'worktree list --porcelain');
                const alreadyRegistered = this._parseWorktreeListPorcelain(worktreeList)
                    .some((entry) => path.resolve(entry.path) === path.resolve(workspacePath));
                if (alreadyRegistered) {
                    return await this._reuseExistingWorkspace(sessionId, repoPath, workspacePath, workspaceName, workspaceIdentity);
                }
            } catch {
                // Not registered yet (or listing failed) — continue to create
            }

            // Fetch latest from remote (skipFetch=trueで省略可能、2-3秒短縮)
            if (!skipFetch) {
                try {
                    await this._execGitWithLockRetry(repoPath, 'fetch origin');
                } catch (fetchErr) {
                    logger.info(`[workspace] git fetch failed, continuing: ${fetchErr.message}`);
                }
            } else {
                logger.info(`[workspace] git fetch skipped (skipFetch=true)`);
            }

            const mainBranchName = await this._getMainBranchName(repoPath);
            const workspaceBaseRevision = await this._resolveWorkspaceBaseRevision(repoPath, mainBranchName);

            // Create worktree (+ branch)
            try {
                await this._execGitWithLockRetry(
                    repoPath,
                    `worktree add -b "${branchName}" "${workspacePath}" "${workspaceBaseRevision}"`
                );
                logger.info(`[workspace] Created worktree: ${workspaceName} at ${workspacePath}`);
            } catch (addErr) {
                if (this._isBranchAlreadyExistsError(addErr)) {
                    logger.warn(`[workspace] Branch already exists, retrying worktree add without -b: ${branchName}`);
                    try {
                        await this._execGitWithLockRetry(
                            repoPath,
                            `worktree add "${workspacePath}" "${branchName}"`
                        );
                        logger.info(`[workspace] Created worktree for existing branch: ${workspaceName} at ${workspacePath}`);
                    } catch (retryErr) {
                        if (this._isWorktreeAlreadyExistsError(retryErr)) {
                            return await this._reuseExistingWorkspace(sessionId, repoPath, workspacePath, workspaceName, workspaceIdentity);
                        }
                        throw retryErr;
                    }
                } else if (this._isWorktreeAlreadyExistsError(addErr)) {
                    logger.warn(`[workspace] Worktree appeared during create: ${workspaceName}, reusing existing workspace`);
                    return await this._reuseExistingWorkspace(sessionId, repoPath, workspacePath, workspaceName, workspaceIdentity);
                } else {
                    throw addErr;
                }
            }

            // Run post-creation tasks in parallel (all non-critical, try-catch wrapped)
            const workspaceRoot = path.dirname(path.dirname(this.worktreesDir));
            const [, , , startCommitResult] = await Promise.allSettled([
                this._symlinkIfMissing(path.join(repoPath, '.env'), path.join(workspacePath, '.env'), '.env'),
                this._symlinkIfMissing(path.join(workspaceRoot, '.claude'), path.join(workspacePath, '.claude'), '.claude'),
                this._symlinkIfMissing(path.join(workspaceRoot, '.mcp.json'), path.join(workspacePath, '.mcp.json'), '.mcp.json'),
                this._getWorkspaceStartCommit(workspacePath, workspaceBaseRevision)
            ]);

            const startCommit = startCommitResult.status === 'fulfilled' ? startCommitResult.value : null;

            logger.info(`Created git worktree at ${workspacePath}`);
            return {
                worktreePath: workspacePath,
                branchName,
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
     * git worktreeを削除
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async remove(sessionId, repoPath, options = {}) {
        const workspaceName = this._getWorkspaceName(sessionId, repoPath, options);
        const workspacePath = path.join(this.worktreesDir, workspaceName);

        try {
            try {
                await this._execGitWithLockRetry(repoPath, `worktree remove --force "${workspacePath}"`);
                logger.info(`[workspace] Removed worktree: ${workspaceName}`);
            } catch (removeErr) {
                logger.info(`[workspace] worktree remove failed, falling back to fs.rm: ${removeErr instanceof Error ? removeErr.message : String(removeErr)}`);
                try {
                    await fs.rm(workspacePath, { recursive: true, force: true });
                    logger.info(`[workspace] Removed physical directory: ${workspacePath}`);
                } catch (rmErr) {
                    logger.warn(`[workspace] Directory removal failed for ${workspacePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`);
                }
                try {
                    await this._execGitWithLockRetry(repoPath, 'worktree prune');
                } catch {
                    // best-effort
                }
            }

            // Verify removal — zombie prevention
            try {
                await fs.access(workspacePath);
                logger.warn(`[workspace] Zombie worktree still exists after remove: ${workspacePath}`);
                return false;
            } catch {
                // Expected: directory no longer exists
            }

            // Delete canonical and legacy session branches.
            for (const candidate of this._getSessionBranchCandidates(sessionId, options)) {
                try {
                    await this.execPromise(`git -C "${repoPath}" branch -D "${candidate}"`);
                    logger.info(`[workspace] Deleted branch: ${candidate}`);
                } catch (branchErr) {
                    logger.info(`[workspace] Branch deletion skipped: ${branchErr instanceof Error ? branchErr.message : String(branchErr)}`);
                }
            }

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
            await this._execGitWithLockRetry(repoPath, `worktree remove --force "${workspacePath}"`);
        } catch (removeErr) {
            logger.info(`[merge] worktree remove failed, falling back to fs.rm: ${removeErr instanceof Error ? removeErr.message : String(removeErr)}`);
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
                logger.info(`[merge] Removed physical directory: ${workspacePath}`);
            } catch (rmErr) {
                logger.warn(`[merge] Directory removal failed for ${workspacePath}: ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`);
            }
            try {
                await this._execGitWithLockRetry(repoPath, 'worktree prune');
            } catch {
                // best-effort
            }
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

        for (const candidate of this._getSessionBranchCandidates(sessionId, workspaceIdentity)) {
            try {
                await this.execPromise(`git -C "${repoPath}" branch -D "${candidate}"`);
            } catch (branchErr) {
                logger.info(`[merge] Branch deletion skipped: ${branchErr instanceof Error ? branchErr.message : String(branchErr)}`);
            }
        }

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
     * git worktreeの状態を取得
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

        const branchInfos = await this._getBranchInfos(repoPath, sessionId);
        const archiveTarget = await this._resolveArchiveTargetBranch(
            sessionId,
            repoPath,
            workspacePath,
            branchInfos
        );
        if (!archiveTarget) {
            return { ...result, reason: 'missing_official_bookmark' };
        }

        const workspaceMatches = archiveTarget.adoptSessionBookmark
            ? await this._workspaceMatchesGitHead(workspacePath)
            : await this._workspaceMatchesBranch(workspacePath, archiveTarget.bookmarkName);
        if (!workspaceMatches) {
            return { ...result, reason: 'working_copy_differs' };
        }

        const staleLocalBranches = branchInfos.filter(
            info => info.name !== this._getSessionBranchName(sessionId) && !info.pushed
        );

        result.attempted = true;

        if (archiveTarget.adoptSessionBookmark) {
            const sessionBranchName = this._getSessionBranchName(sessionId);
            await this.execPromise(
                `git -C "${repoPath}" branch -f "${sessionBranchName}" "${archiveTarget.bookmarkName}"`
            );
            result.actions.push(`move-branch:${sessionBranchName}->${archiveTarget.bookmarkName}`);
        }

        for (const branch of staleLocalBranches) {
            await this.execPromise(`git -C "${repoPath}" branch -D "${branch.name}"`);
            result.actions.push(`delete-branch:${branch.name}`);
        }

        // Only reset the working copy after we've confirmed above (via
        // _workspaceMatchesBranch / _workspaceMatchesGitHead) that it matches the
        // archive target — this reset is a no-op content-wise, purely to clear
        // the "dirty" bookkeeping state.
        await this.execPromise(
            `git -C "${workspacePath}" reset --hard "${this._getSessionBranchName(sessionId)}"`
        );
        result.actions.push(`reset-working-copy:${this._getSessionBranchName(sessionId)}`);

        const statusAfter = await this._collectStatus(sessionId, repoPath, workspacePath, startCommit);
        result.statusAfter = statusAfter;
        result.healed = !statusAfter.hasWorkingCopyChanges && statusAfter.changesNotPushed === 0;
        result.reason = result.healed ? 'healed' : 'post_heal_still_dirty';

        return result;
    }

    /**
     * ローカルmainを更新（git fetch）
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{success: boolean, updated?: boolean, error?: string, mainBranch?: string}>}
     */
    async updateLocalMain(repoPath, options = {}) {
        const mainBranchName = await this._getMainBranchName(repoPath);

        try {
            await this.execPromise(`git -C "${repoPath}" fetch origin`);
        } catch (err) {
            return { success: false, error: `fetch失敗: ${err instanceof Error ? err.message : String(err)}` };
        }

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
        const candidates = [
            preferredRevision ? `origin/${preferredRevision}` : null,
            preferredRevision,
            'HEAD'
        ]
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index);

        for (const candidate of candidates) {
            const commit = await this._getGitCommitId(repoPath, candidate);
            if (commit) {
                return candidate;
            }
        }

        throw new Error(`Unable to resolve git worktree base revision for ${repoPath}`);
    }

    async _getWorkspaceStartCommit(workspacePath, preferredRevision = null) {
        const candidates = [preferredRevision, 'HEAD']
            .filter(Boolean)
            .filter((value, index, list) => list.indexOf(value) === index);

        for (const candidate of candidates) {
            const commit = await this._getGitCommitId(workspacePath, candidate);
            if (commit) {
                return commit;
            }
        }

        throw new Error(`Unable to resolve workspace start commit for ${workspacePath}`);
    }

    /**
     * git worktreeをベースブランチにマージ（PR経由）
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
            const branchName = await this._resolveMergeBranchName(sessionId, repoPath, workspaceIdentity);

            // Push branch to remote
            logger.info(`[merge] Pushing branch: ${branchName}`);
            try {
                await this._pushBranchForMerge(repoPath, branchName);
            } catch (pushErr) {
                return {
                    success: false,
                    error: `Push failed: ${pushErr instanceof Error ? pushErr.message : String(pushErr)}`
                };
            }

            // Get commits for PR description
            const { stdout: commits } = await this.execPromise(
                `git -C "${repoPath}" log "${mainBranchName}..${branchName}" --format="- %s"`
            );

            // Build PR title
            const displayName = sessionName || sessionId;
            const prTitle = `Merge session: ${displayName}`;

            // Create PR
            logger.info(`[merge] Creating PR for ${branchName}`);
            const { stdout: prUrl } = await this.execPromise(
                `gh pr create --base "${mainBranchName}" --head "${branchName}" --title "${prTitle}" --body "$(cat <<'EOF'
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
                branch: branchName,
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
                logger.info(`[merge] Merged ${branchName} into ${mainBranchName}`);
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

            logger.info(`[merge] Merged ${branchName} into ${mainBranchName} and rotated workspace to ${active.workspaceId}`);
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

        const repoName = await this._getRemoteRepoName(repoPath) || dirName;
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

        const repoName = await this._getRemoteRepoName(repoPath) || dirName;
        const result = await this._getGitCommitLog(repoPath, limit);
        return { ...result, repoName };
    }

    /**
     * Gitのコミットログを取得
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
     * @returns {Promise<string|null>}
     */
    async _getRemoteRepoName(repoPath) {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${repoPath}" remote get-url origin 2>/dev/null`
            );
            const url = stdout.trim();
            if (!url) return null;
            // Extract repo name from URL: https://github.com/Org/repo-name.git → repo-name
            const match = url.match(/\/([^/]+?)(?:\.git)?$/);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /**
     * 全てのgit worktreeをリストアップ
     * @returns {Promise<Array<{name: string, path: string, isMain: boolean}>>}
     */
    async listWorktrees() {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${this.canonicalRoot}" worktree list --porcelain`
            );

            const entries = this._parseWorktreeListPorcelain(stdout);
            return entries.map((entry) => {
                const isMain = path.resolve(entry.path) === path.resolve(this.canonicalRoot);
                const name = isMain ? 'default' : path.basename(entry.path);
                return {
                    name,
                    path: entry.path,
                    branch: entry.branch || (isMain ? 'main' : `session/${name.split('-')[0]}`),
                    isMain
                };
            });
        } catch (err) {
            logger.error('Failed to list workspaces:', err instanceof Error ? err.message : String(err));
            return [];
        }
    }
}

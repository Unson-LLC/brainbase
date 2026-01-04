/**
 * WorktreeService
 * Git worktree操作を管理するサービス
 */
import { promises as fs } from 'fs';
import path from 'path';

export class WorktreeService {
    /**
     * @param {string} worktreesDir - worktrees保存ディレクトリ
     * @param {string} canonicalRoot - 正本ディレクトリルート（環境変数BRAINBASE_ROOTまたはconfig.yml）
     * @param {Function} execPromise - util.promisify(exec)
     */
    constructor(worktreesDir, canonicalRoot, execPromise) {
        this.worktreesDir = worktreesDir;
        this.canonicalRoot = canonicalRoot;
        this.execPromise = execPromise;
    }

    /**
     * worktreesディレクトリが存在することを保証
     */
    async ensureWorktreesDir() {
        try {
            await fs.mkdir(this.worktreesDir, { recursive: true });
        } catch (err) {
            console.error('Failed to create worktrees directory:', err);
        }
    }

    /**
     * 新しいworktreeを作成し、正本ディレクトリへのシンボリックリンクを設定
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{worktreePath: string, branchName: string, repoPath: string}|null>}
     */
    async create(sessionId, repoPath) {
        await this.ensureWorktreesDir();

        const repoName = path.basename(repoPath);
        const worktreePath = path.join(this.worktreesDir, `${sessionId}-${repoName}`);
        const branchName = `session/${sessionId}`;

        try {
            // Check if directory exists first
            try {
                await fs.access(repoPath);
            } catch (accessErr) {
                throw new Error(`Directory does not exist: ${repoPath}. Please check your project configuration in config.yml (local.path or github setting).`);
            }

            // Check if repo is a git repository
            try {
                await this.execPromise(`git -C "${repoPath}" rev-parse --git-dir`);
            } catch (gitErr) {
                throw new Error(`Not a git repository: ${repoPath}. Please ensure the directory is initialized as a git repository or configure the project properly in config.yml.`);
            }

            // Create worktree with new branch
            await this.execPromise(`git -C "${repoPath}" worktree add "${worktreePath}" -b "${branchName}"`);

            // Create symlink for .env if it exists in the source repo
            const sourceEnvPath = path.join(repoPath, '.env');
            const targetEnvPath = path.join(worktreePath, '.env');
            try {
                await fs.access(sourceEnvPath);
                await fs.symlink(sourceEnvPath, targetEnvPath);
                console.log(`Created .env symlink at ${targetEnvPath}`);
            } catch (envErr) {
                // .env doesn't exist or symlink failed - not critical
                if (envErr.code !== 'ENOENT') {
                    console.log(`Note: Could not create .env symlink: ${envErr.message}`);
                }
            }

            // Set skip-worktree flag BEFORE creating symlinks
            // This must be done while files still exist in the worktree
            const excludePaths = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude', 'config.yml'];
            const allFilesToSkip = [];

            // Collect all files first
            for (const p of excludePaths) {
                try {
                    const { stdout } = await this.execPromise(
                        `git -C "${worktreePath}" ls-files ${p} 2>/dev/null || echo ""`
                    );
                    if (stdout.trim()) {
                        const files = stdout.trim().split('\n').filter(f => f.trim());
                        allFilesToSkip.push(...files);
                        console.log(`Found ${files.length} files under: ${p}`);
                    }
                } catch (skipErr) {
                    console.log(`Note: No files to skip-worktree under ${p}`);
                }
            }

            // Set skip-worktree for all files in batches
            if (allFilesToSkip.length > 0) {
                console.log(`Setting skip-worktree for ${allFilesToSkip.length} files...`);
                const batchSize = 100;
                for (let i = 0; i < allFilesToSkip.length; i += batchSize) {
                    const batch = allFilesToSkip.slice(i, i + batchSize);
                    const filesArg = batch.map(f => `"${f}"`).join(' ');
                    await this.execPromise(
                        `git -C "${worktreePath}" update-index --skip-worktree ${filesArg}`
                    );
                    console.log(`Set skip-worktree for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allFilesToSkip.length/batchSize)} (${batch.length} files)`);
                }
                console.log(`Successfully set skip-worktree for ${allFilesToSkip.length} files`);
            }

            // Create symlinks for canonical directories (正本ディレクトリ)
            // These directories are shared across all worktrees and committed directly to main
            // IMPORTANT: 正本は常に BRAINBASE_ROOT（環境変数または設定ファイル）にある
            const canonicalDirs = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude'];
            const canonicalFiles = ['config.yml'];

            for (const dir of canonicalDirs) {
                const sourcePath = path.join(this.canonicalRoot, dir);
                const targetPath = path.join(worktreePath, dir);
                try {
                    await fs.access(sourcePath);
                    // Remove the directory/file created by worktree
                    await fs.rm(targetPath, { recursive: true, force: true });
                    // Create symlink to canonical path
                    await fs.symlink(sourcePath, targetPath);
                    console.log(`Created canonical symlink: ${dir} -> ${sourcePath}`);
                } catch (symlinkErr) {
                    if (symlinkErr.code !== 'ENOENT') {
                        console.log(`Note: Could not create ${dir} symlink: ${symlinkErr.message}`);
                    }
                }
            }

            for (const file of canonicalFiles) {
                const sourcePath = path.join(this.canonicalRoot, file);
                const targetPath = path.join(worktreePath, file);
                try {
                    await fs.access(sourcePath);
                    await fs.rm(targetPath, { force: true });
                    await fs.symlink(sourcePath, targetPath);
                    console.log(`Created canonical symlink: ${file} -> ${sourcePath}`);
                } catch (symlinkErr) {
                    if (symlinkErr.code !== 'ENOENT') {
                        console.log(`Note: Could not create ${file} symlink: ${symlinkErr.message}`);
                    }
                }
            }

            console.log(`Created worktree at ${worktreePath} with branch ${branchName}`);
            return { worktreePath, branchName, repoPath };
        } catch (err) {
            console.error(`Failed to create worktree for ${sessionId}:`, err.message);
            // If worktree creation fails (e.g., not a git repo), return null
            return null;
        }
    }

    /**
     * worktreeを削除
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async remove(sessionId, repoPath) {
        const repoName = path.basename(repoPath);
        const worktreePath = path.join(this.worktreesDir, `${sessionId}-${repoName}`);
        const branchName = `session/${sessionId}`;

        try {
            // Remove worktree
            await this.execPromise(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`);
            console.log(`Removed worktree at ${worktreePath}`);

            // Delete branch
            await this.execPromise(`git -C "${repoPath}" branch -D "${branchName}"`).catch(() => {});
            console.log(`Deleted branch ${branchName}`);

            return true;
        } catch (err) {
            console.error(`Failed to remove worktree for ${sessionId}:`, err.message);
            return false;
        }
    }

    /**
     * 既存worktreeのskip-worktreeフラグを修正
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{success: boolean, filesFixed?: number, error?: string}>}
     */
    async fixSymlinks(sessionId, repoPath) {
        const repoName = path.basename(repoPath);
        const worktreePath = path.join(this.worktreesDir, `${sessionId}-${repoName}`);

        try {
            // Check if worktree exists
            await fs.access(worktreePath);

            // Set skip-worktree flag for symlinked paths
            // For existing worktrees, we need to reset the deletions first
            const excludePaths = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude', 'config.yml'];
            let totalFixed = 0;

            // Get all deleted files that are in canonical paths
            const { stdout } = await this.execPromise(
                `git -C "${worktreePath}" diff main --name-status --diff-filter=D`
            );

            if (stdout.trim()) {
                const filesToFix = [];
                const lines = stdout.trim().split('\n');

                for (const line of lines) {
                    // Format: "D\tpath/to/file"
                    const match = line.match(/^D\s+(.+)$/);
                    if (match) {
                        const file = match[1];
                        // Check if file is in one of the canonical paths
                        const isCanonical = excludePaths.some(p =>
                            file === p || file.startsWith(p + '/')
                        );

                        if (isCanonical) {
                            filesToFix.push(file);
                        }
                    }
                }

                if (filesToFix.length > 0) {
                    // Reset the deletions in index (restore files from main branch)
                    const filesArg = filesToFix.map(f => `"${f}"`).join(' ');
                    await this.execPromise(
                        `git -C "${worktreePath}" restore --source=main --staged ${filesArg}`
                    );

                    // Now set skip-worktree for all files
                    for (const file of filesToFix) {
                        try {
                            await this.execPromise(
                                `git -C "${worktreePath}" update-index --skip-worktree "${file}"`
                            );
                            totalFixed++;
                        } catch (updateErr) {
                            console.log(`Note: Could not set skip-worktree for ${file}: ${updateErr.message}`);
                        }
                    }
                }
            }

            console.log(`Fixed ${totalFixed} files in worktree ${sessionId}`);
            return { success: true, filesFixed: totalFixed };
        } catch (err) {
            console.error(`Failed to fix worktree symlinks for ${sessionId}:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * worktreeの未マージ状態を取得
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<Object>} worktree状態情報
     */
    async getStatus(sessionId, repoPath) {
        const repoName = path.basename(repoPath);
        const worktreePath = path.join(this.worktreesDir, `${sessionId}-${repoName}`);
        const branchName = `session/${sessionId}`;

        try {
            // Check if worktree exists
            await fs.access(worktreePath);

            // Get main branch name
            const { stdout: mainBranch } = await this.execPromise(
                `git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
            );
            const mainBranchName = mainBranch.trim() || 'main';

            // Check if branch has commits ahead of main (use repoPath's main, not worktree's)
            // This ensures we compare against the canonical main branch, not a stale worktree reference
            const { stdout: mainCommit } = await this.execPromise(
                `git -C "${repoPath}" rev-parse ${mainBranchName} 2>/dev/null || echo ""`
            );
            const { stdout: headCommit } = await this.execPromise(
                `git -C "${worktreePath}" rev-parse HEAD 2>/dev/null || echo ""`
            );

            // Check if session branch commit is an ancestor of main (already merged)
            let ahead = 0;
            let behind = 0;
            if (mainCommit.trim() && headCommit.trim()) {
                // Check if HEAD is ancestor of main (meaning it's been merged)
                const { stdout: mergeBase } = await this.execPromise(
                    `git -C "${repoPath}" merge-base ${mainCommit.trim()} ${headCommit.trim()} 2>/dev/null || echo ""`
                );
                if (mergeBase.trim() === headCommit.trim()) {
                    // Session branch is ancestor of main = already merged
                    ahead = 0;
                } else {
                    // Count commits ahead
                    const { stdout: aheadCount } = await this.execPromise(
                        `git -C "${repoPath}" rev-list --count ${mainCommit.trim()}..${headCommit.trim()} 2>/dev/null || echo "0"`
                    );
                    ahead = parseInt(aheadCount.trim()) || 0;
                }
            }

            // Check for uncommitted changes (excluding symlinked directories like .claude/)
            const { stdout: statusOutput } = await this.execPromise(
                `git -C "${worktreePath}" status --porcelain`
            );
            // Filter out symlinked directories/files (they show as deleted/typechange but are actually fine)
            const significantChanges = statusOutput.trim().split('\n').filter(line => {
                if (!line.trim()) return false;
                // Exclude .claude directory/file changes (symlink to canonical)
                // Matches: ".claude/xxx", ".claude" (standalone), "?? .claude"
                if (line.includes('.claude')) return false;
                // Exclude _codex/, _tasks/, _inbox/, _schedules/, _ops/ (all symlinked to canonical)
                // Also exclude the directory names themselves when shown as untracked
                if (line.match(/(_codex|_tasks|_inbox|_schedules|_ops)(\/|$|\s*$)/)) return false;
                // Exclude config.yml (symlinked to canonical)
                if (line.includes('config.yml')) return false;
                return true;
            });
            const hasUncommittedChanges = significantChanges.length > 0;

            return {
                exists: true,
                worktreePath,
                branchName,
                mainBranch: mainBranchName,
                commitsAhead: ahead || 0,
                commitsBehind: behind || 0,
                hasUncommittedChanges,
                needsMerge: (ahead || 0) > 0 || hasUncommittedChanges
            };
        } catch (err) {
            return {
                exists: false,
                worktreePath,
                branchName,
                needsMerge: false
            };
        }
    }

    /**
     * worktreeブランチをmainにマージ
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {string|null} sessionName - セッション名（オプション）
     * @returns {Promise<{success: boolean, message?: string, error?: string, needsCommit?: boolean, hasConflicts?: boolean}>}
     */
    async merge(sessionId, repoPath, sessionName = null) {
        const repoName = path.basename(repoPath);
        const worktreePath = path.join(this.worktreesDir, `${sessionId}-${repoName}`);
        const branchName = `session/${sessionId}`;

        try {
            // Get main branch name
            const { stdout: mainBranch } = await this.execPromise(
                `git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
            );
            const mainBranchName = mainBranch.trim() || 'main';

            // Check for uncommitted changes in main repo before merge
            try {
                const { stdout: statusOutput } = await this.execPromise(
                    `git -C "${repoPath}" status --porcelain`
                );
                if (statusOutput.trim()) {
                    return {
                        success: false,
                        error: `マージ前にmainブランチの未コミット変更をコミットしてください:\n${statusOutput}`,
                        needsCommit: true
                    };
                }
            } catch (statusErr) {
                console.error('Failed to check git status:', statusErr.message);
            }

            // Checkout main branch in original repo
            await this.execPromise(`git -C "${repoPath}" checkout ${mainBranchName}`);

            // Pre-merge conflict check (dry-run)
            try {
                await this.execPromise(
                    `git -C "${repoPath}" merge --no-commit --no-ff ${branchName}`
                );
                // No conflicts - abort this dry-run merge
                await this.execPromise(`git -C "${repoPath}" merge --abort`);
            } catch (dryRunErr) {
                // Conflicts detected - abort and return error
                try {
                    await this.execPromise(`git -C "${repoPath}" merge --abort`);
                } catch (abortErr) {
                    // Ignore abort errors
                }
                return {
                    success: false,
                    error: `マージコンフリクトが検出されました。手動で解決してください:\n${dryRunErr.message}`,
                    hasConflicts: true
                };
            }

            // Build merge message
            const displayName = sessionName || sessionId;
            const mergeMessage = `Merge session: ${displayName}`;

            // Merge session branch (actual merge)
            const { stdout: mergeOutput } = await this.execPromise(
                `git -C "${repoPath}" merge ${branchName} --no-ff -m "${mergeMessage}"`
            );

            console.log(`Merged ${branchName} into ${mainBranchName}`);
            return { success: true, message: mergeOutput };
        } catch (err) {
            console.error(`Failed to merge worktree for ${sessionId}:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * 全てのworktreeをリストアップ
     * @returns {Promise<Array<{path: string, branch: string, isMain: boolean}>>}
     */
    async listWorktrees() {
        try {
            const { stdout } = await this.execPromise(
                `git -C "${this.canonicalRoot}" worktree list --porcelain`
            );

            const worktrees = [];
            const lines = stdout.trim().split('\n');
            let currentWorktree = {};

            for (const line of lines) {
                if (line.startsWith('worktree ')) {
                    if (currentWorktree.path) {
                        worktrees.push(currentWorktree);
                    }
                    currentWorktree = { path: line.substring(9) };
                } else if (line.startsWith('branch ')) {
                    const branchRef = line.substring(7);
                    currentWorktree.branch = branchRef.replace('refs/heads/', '');
                    currentWorktree.isMain = !currentWorktree.branch.startsWith('session/');
                } else if (line.startsWith('bare') || line.startsWith('detached') || line === '') {
                    // Skip bare, detached, and empty lines
                    continue;
                }
            }

            // Add last worktree
            if (currentWorktree.path) {
                worktrees.push(currentWorktree);
            }

            return worktrees;
        } catch (err) {
            console.error('Failed to list worktrees:', err.message);
            return [];
        }
    }
}

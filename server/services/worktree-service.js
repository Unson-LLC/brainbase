/**
 * WorktreeService
 * Git worktree操作を管理するサービス
 */
import { promises as fs } from 'fs';
import path from 'path';

export class WorktreeService {
    /**
     * @param {string} worktreesDir - worktrees保存ディレクトリ
     * @param {string} canonicalRoot - メインリポジトリのパス（listWorktrees()で使用）
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
     * 新しいworktreeを作成
     * NOTE: シンボリックリンク方式は廃止。各worktreeが独立したコピーを持つ
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

            // NOTE: シンボリックリンク方式を廃止
            // 以前は _codex, _tasks 等を正本へのシンボリックリンクにしていたが、
            // 新方式では各worktreeが独立したコピーを持ち、PRでマージする運用に変更
            // これにより：
            // - セッション間で変更が混ざらない
            // - 変更が全てブランチにコミットされる
            // - PRでマージに一本化できる

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

            // Check for uncommitted changes
            // NOTE: シンボリックリンク方式を廃止したため、フィルタリング不要
            // 全ての変更（_codex, _tasks等を含む）を検出する
            const { stdout: statusOutput } = await this.execPromise(
                `git -C "${worktreePath}" status --porcelain`
            );
            const hasUncommittedChanges = statusOutput.trim().length > 0;

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

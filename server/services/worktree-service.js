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
        this.isJujutsuRepo = null;  // キャッシュ
    }

    /**
     * Jujutsuリポジトリかどうかを判定
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async _isJujutsuRepo(repoPath) {
        if (this.isJujutsuRepo !== null) {
            return this.isJujutsuRepo;
        }
        try {
            await this.execPromise(`jj -C "${repoPath}" version`);
            this.isJujutsuRepo = true;
            return true;
        } catch {
            this.isJujutsuRepo = false;
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
            console.error('Failed to create worktrees directory:', err);
        }
    }

    /**
     * 新しいJujutsu workspaceを作成
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<{worktreePath: string, branchName: string, repoPath: string}|null>}
     */
    async create(sessionId, repoPath) {
        await this.ensureWorktreesDir();

        const repoName = path.basename(repoPath);
        const workspaceName = `${sessionId}-${repoName}`;
        const workspacePath = path.join(this.worktreesDir, workspaceName);
        const bookmarkName = sessionId;  // Jujutsu bookmark = sessionId

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
                throw new Error(`Not a Jujutsu repository: ${repoPath}. Run 'jj git init' in the repository first.`);
            }

            // Check if workspace already exists
            try {
                const { stdout: workspaceList } = await this.execPromise(
                    `jj -C "${repoPath}" workspace list`
                );
                if (workspaceList.includes(`${workspaceName}:`)) {
                    console.log(`[workspace] Workspace already exists: ${workspaceName}, reusing`);
                    const { stdout: startCommit } = await this.execPromise(
                        `jj -C "${workspacePath}" log -r @ -T 'commit_id' --no-pager`
                    );
                    return { worktreePath: workspacePath, branchName: `session/${sessionId}`, repoPath, startCommit: startCommit.trim(), workspaceName };
                }
            } catch {
                // Workspace doesn't exist, continue to create
            }

            // Fetch latest from remote
            try {
                await this.execPromise(`jj -C "${repoPath}" git fetch`);
            } catch (fetchErr) {
                console.log(`[workspace] git fetch failed, continuing: ${fetchErr.message}`);
            }

            // Create workspace
            await this.execPromise(`jj -C "${repoPath}" workspace add --name "${workspaceName}" "${workspacePath}"`);
            console.log(`[workspace] Created workspace: ${workspaceName} at ${workspacePath}`);

            // Create bookmark
            try {
                await this.execPromise(`jj -C "${repoPath}" bookmark create -r main ${bookmarkName}`);
                console.log(`[workspace] Created bookmark: ${bookmarkName}`);
            } catch (bookmarkErr) {
                console.log(`[workspace] Bookmark creation skipped: ${bookmarkErr.message}`);
            }

            // Create symlink for .env if it exists in the source repo
            const sourceEnvPath = path.join(repoPath, '.env');
            const targetEnvPath = path.join(workspacePath, '.env');
            try {
                await fs.access(sourceEnvPath);
                await fs.symlink(sourceEnvPath, targetEnvPath);
                console.log(`Created .env symlink at ${targetEnvPath}`);
            } catch (envErr) {
                if (envErr.code !== 'ENOENT') {
                    console.log(`Note: Could not create .env symlink: ${envErr.message}`);
                }
            }

            // Create symlink for .claude directory
            const workspaceRoot = path.dirname(path.dirname(this.worktreesDir));
            const sourceClaudePath = path.join(workspaceRoot, '.claude');
            const targetClaudePath = path.join(workspacePath, '.claude');
            try {
                await fs.access(sourceClaudePath);
                try {
                    await fs.access(targetClaudePath);
                    console.log(`.claude already exists at ${targetClaudePath}, skipping symlink`);
                } catch {
                    await fs.symlink(sourceClaudePath, targetClaudePath);
                    console.log(`Created .claude symlink at ${targetClaudePath}`);
                }
            } catch (claudeErr) {
                if (claudeErr.code === 'ENOENT') {
                    console.log(`Note: .claude directory not found at ${sourceClaudePath}`);
                } else {
                    console.log(`Note: Could not create .claude symlink: ${claudeErr.message}`);
                }
            }

            // Get current HEAD as startCommit
            const { stdout: startCommit } = await this.execPromise(
                `jj -C "${workspacePath}" log -r @ -T 'commit_id' --no-pager`
            );

            console.log(`Created Jujutsu workspace at ${workspacePath}`);
            return { worktreePath: workspacePath, branchName: `session/${sessionId}`, repoPath, startCommit: startCommit.trim(), workspaceName };
        } catch (err) {
            console.error(`Failed to create workspace for ${sessionId}:`, err.message);
            return null;
        }
    }

    /**
     * Jujutsu workspaceを削除
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @returns {Promise<boolean>}
     */
    async remove(sessionId, repoPath) {
        const repoName = path.basename(repoPath);
        const workspaceName = `${sessionId}-${repoName}`;
        const workspacePath = path.join(this.worktreesDir, workspaceName);
        const bookmarkName = sessionId;

        try {
            // Forget workspace (metadata only)
            try {
                await this.execPromise(`jj -C "${repoPath}" workspace forget "${workspaceName}"`);
                console.log(`[workspace] Forgot workspace: ${workspaceName}`);
            } catch (forgetErr) {
                console.log(`[workspace] Workspace forget skipped: ${forgetErr.message}`);
            }

            // Delete bookmark
            try {
                await this.execPromise(`jj -C "${repoPath}" bookmark delete "${bookmarkName}"`);
                console.log(`[workspace] Deleted bookmark: ${bookmarkName}`);
            } catch (bookmarkErr) {
                console.log(`[workspace] Bookmark deletion skipped: ${bookmarkErr.message}`);
            }

            // Remove physical directory
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
                console.log(`[workspace] Removed physical directory: ${workspacePath}`);
            } catch (rmErr) {
                console.log(`[workspace] Directory removal skipped: ${rmErr.message}`);
            }

            return true;
        } catch (err) {
            console.error(`Failed to remove workspace for ${sessionId}:`, err.message);
            return false;
        }
    }

    /**
     * Jujutsu workspaceの状態を取得
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {string|null} startCommit - セッション開始時のコミットハッシュ
     * @returns {Promise<Object>} workspace状態情報
     */
    async getStatus(sessionId, repoPath, startCommit = null) {
        const repoName = path.basename(repoPath);
        const workspaceName = `${sessionId}-${repoName}`;
        const workspacePath = path.join(this.worktreesDir, workspaceName);
        const bookmarkName = sessionId;

        try {
            // Check if workspace exists
            await fs.access(workspacePath);

            // Get main branch name
            const mainBranchName = await this._getMainBranchName(repoPath);

            // Get commits ahead using jj log
            let ahead = 0;
            try {
                const { stdout: aheadCount } = await this.execPromise(
                    `jj -C "${workspacePath}" log -r "${mainBranchName}..@" -T '"x\n"' --no-pager 2>/dev/null | wc -l`
                );
                ahead = parseInt(aheadCount.trim()) || 0;
            } catch {
                ahead = 0;
            }

            // Check for uncommitted changes (Jujutsu: working copy is always a commit)
            // Check if working copy has changes not in any bookmark
            let hasUncommittedChanges = false;
            try {
                const { stdout: statusOutput } = await this.execPromise(
                    `jj -C "${workspacePath}" status --no-pager`
                );
                hasUncommittedChanges = statusOutput.trim().length > 0;
            } catch {
                hasUncommittedChanges = false;
            }

            // Check if bookmark exists and is pushed
            let bookmarkPushed = false;
            try {
                const { stdout: bookmarkList } = await this.execPromise(
                    `jj -C "${repoPath}" bookmark list ${bookmarkName} --no-pager`
                );
                bookmarkPushed = bookmarkList.includes('origin') || bookmarkList.includes('@origin');
            } catch {
                bookmarkPushed = false;
            }

            return {
                exists: true,
                worktreePath: workspacePath,
                branchName: `session/${sessionId}`,
                workspaceName,
                bookmarkName,
                mainBranch: mainBranchName,
                commitsAhead: ahead,
                hasUncommittedChanges,
                bookmarkPushed,
                needsMerge: ahead > 0 || hasUncommittedChanges
            };
        } catch (err) {
            return {
                exists: false,
                worktreePath: workspacePath,
                branchName: `session/${sessionId}`,
                workspaceName,
                needsMerge: false
            };
        }
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
            await this.execPromise(`jj -C "${repoPath}" git fetch`);
        } catch (err) {
            return { success: false, error: `fetch失敗: ${err.message}` };
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

    /**
     * Jujutsu workspaceをmainにマージ（PR経由）
     * @param {string} sessionId - セッションID
     * @param {string} repoPath - リポジトリパス
     * @param {string|null} sessionName - セッション名（オプション）
     * @returns {Promise<{success: boolean, message?: string, error?: string, needsCommit?: boolean, hasConflicts?: boolean, prUrl?: string}>}
     */
    async merge(sessionId, repoPath, sessionName = null) {
        const bookmarkName = sessionId;

        try {
            // Get main branch name
            const mainBranchName = await this._getMainBranchName(repoPath);

            // Push bookmark to remote
            console.log(`[merge] Pushing bookmark: ${bookmarkName}`);
            try {
                await this.execPromise(`jj -C "${repoPath}" git push --bookmark "${bookmarkName}"`);
            } catch (pushErr) {
                return {
                    success: false,
                    error: `Push failed: ${pushErr.message}`
                };
            }

            // Get commits for PR description
            const { stdout: commits } = await this.execPromise(
                `jj -C "${repoPath}" log -r "${mainBranchName}..${bookmarkName}" -T '"- " ++ description.first_line() ++ "\\n"' --no-pager`
            );

            // Build PR title
            const displayName = sessionName || sessionId;
            const prTitle = `Merge session: ${displayName}`;

            // Create PR
            console.log(`[merge] Creating PR for ${bookmarkName}`);
            const { stdout: prUrl } = await this.execPromise(
                `gh pr create --base "${mainBranchName}" --title "${prTitle}" --body "$(cat <<'EOF'
## Summary

${commits || 'No commit messages'}

## Test plan

- [ ] 変更が意図通りに動作することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --repo "${repoPath}"
            `);

            // Merge PR
            console.log(`[merge] Merging PR`);
            await this.execPromise(`gh pr merge --merge --delete-branch`);

            // Cleanup workspace
            const workspaceName = `${sessionId}-${path.basename(repoPath)}`;
            const workspacePath = path.join(this.worktreesDir, workspaceName);

            try {
                await this.execPromise(`jj -C "${repoPath}" workspace forget "${workspaceName}"`);
            } catch (forgetErr) {
                console.log(`[merge] Workspace forget skipped: ${forgetErr.message}`);
            }

            try {
                await this.execPromise(`jj -C "${repoPath}" bookmark delete "${bookmarkName}"`);
            } catch (bookmarkErr) {
                console.log(`[merge] Bookmark deletion skipped: ${bookmarkErr.message}`);
            }

            // Remove physical directory
            try {
                await fs.rm(workspacePath, { recursive: true, force: true });
            } catch (rmErr) {
                console.log(`[merge] Directory removal skipped: ${rmErr.message}`);
            }

            console.log(`[merge] Merged ${bookmarkName} into ${mainBranchName}`);
            return { success: true, message: 'Merged via PR', prUrl: prUrl.trim() };
        } catch (err) {
            console.error(`Failed to merge workspace for ${sessionId}:`, err.message);
            return { success: false, error: err.message };
        }
    }

    /**
     * 全てのJujutsu workspaceをリストアップ
     * @returns {Promise<Array<{name: string, path: string, isMain: boolean}>>}
     */
    async listWorktrees() {
        try {
            const { stdout } = await this.execPromise(
                `jj -C "${this.canonicalRoot}" workspace list --no-pager`
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
            console.error('Failed to list workspaces:', err.message);
            return [];
        }
    }
}

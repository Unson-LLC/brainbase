import { exec } from 'child_process';
import util from 'util';
import path from 'path';

const execPromise = util.promisify(exec);

/**
 * Storage Management Service
 * ディスク使用量、大きなファイル検出、クリーンアップ候補の特定
 */
export class StorageService {
    constructor(workspaceDir = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.workspaceDir = workspaceDir;
        this.worktreesDir = path.join(workspaceDir, '.worktrees');
    }

    /**
     * ディレクトリサイズ取得
     * @param {string} dir - ディレクトリパス
     * @returns {Promise<Object>} サイズ情報
     */
    async getDirectorySize(dir) {
        try {
            const { stdout } = await execPromise(`du -sh "${dir}"`);
            // 出力例: "1.5G    /path/to/dir"
            const [size, dirPath] = stdout.trim().split(/\s+/);

            return {
                path: dirPath || dir,
                size,
                sizeBytes: await this.getDirectorySizeInBytes(dir),
            };
        } catch (error) {
            console.error(`[StorageService] Failed to get directory size for ${dir}:`, error.message);
            return { error: error.message, size: '0' };
        }
    }

    /**
     * ディレクトリサイズをバイト数で取得
     * @param {string} dir - ディレクトリパス
     * @returns {Promise<number>} バイト数
     */
    async getDirectorySizeInBytes(dir) {
        try {
            const { stdout } = await execPromise(`du -sk "${dir}"`);
            // 出力例: "1234567    /path/to/dir"
            const [sizeKB] = stdout.trim().split(/\s+/);
            return parseInt(sizeKB) * 1024;
        } catch (error) {
            return 0;
        }
    }

    /**
     * workspace全体のストレージ情報取得
     * @returns {Promise<Object>} ストレージ情報
     */
    async getWorkspaceStorage() {
        try {
            const [workspace, worktrees] = await Promise.all([
                this.getDirectorySize(this.workspaceDir),
                this.getDirectorySize(this.worktreesDir),
            ]);

            return {
                workspace,
                worktrees,
                total: workspace.sizeBytes + worktrees.sizeBytes,
            };
        } catch (error) {
            console.error('[StorageService] Failed to get workspace storage:', error.message);
            return { error: error.message };
        }
    }

    /**
     * 大きなファイル検出（100MB以上）
     * @param {string} dir - 検索ディレクトリ
     * @param {number} sizeThresholdMB - サイズ閾値（MB、デフォルト: 100）
     * @returns {Promise<Array>} 大きなファイルのリスト
     */
    async findLargeFiles(dir = this.workspaceDir, sizeThresholdMB = 100) {
        try {
            // node_modules, .git などを除外して検索
            const { stdout } = await execPromise(
                `find "${dir}" -type f -size +${sizeThresholdMB}M 2>/dev/null | grep -v node_modules | grep -v .git | head -20`
            );

            if (!stdout.trim()) {
                return [];
            }

            const files = stdout.trim().split('\n');
            const fileDetails = await Promise.all(
                files.map(async (filePath) => {
                    try {
                        const { stdout: sizeOutput } = await execPromise(`du -sh "${filePath}"`);
                        const [size] = sizeOutput.trim().split(/\s+/);
                        return {
                            path: filePath.replace(this.workspaceDir, ''),
                            fullPath: filePath,
                            size,
                        };
                    } catch {
                        return null;
                    }
                })
            );

            return fileDetails.filter(f => f !== null);
        } catch (error) {
            console.error('[StorageService] Failed to find large files:', error.message);
            return [];
        }
    }

    /**
     * worktreeごとのサイズ取得
     * @returns {Promise<Array>} worktree情報
     */
    async getWorktreesSizes() {
        try {
            const { stdout } = await execPromise(`ls -1 "${this.worktreesDir}"`);
            const worktrees = stdout.trim().split('\n').filter(Boolean);

            const sizes = await Promise.all(
                worktrees.map(async (worktree) => {
                    const worktreePath = path.join(this.worktreesDir, worktree);
                    const sizeInfo = await this.getDirectorySize(worktreePath);

                    return {
                        name: worktree,
                        size: sizeInfo.size,
                        sizeBytes: sizeInfo.sizeBytes,
                        path: worktreePath,
                    };
                })
            );

            // サイズ順にソート
            return sizes.sort((a, b) => b.sizeBytes - a.sizeBytes);
        } catch (error) {
            console.error('[StorageService] Failed to get worktrees sizes:', error.message);
            return [];
        }
    }

    /**
     * ストレージサマリー取得
     * @returns {Promise<Object>} ストレージサマリー
     */
    async getStorageSummary() {
        const [workspace, largeFiles, worktrees] = await Promise.all([
            this.getWorkspaceStorage(),
            this.findLargeFiles(),
            this.getWorktreesSizes(),
        ]);

        return {
            workspace,
            largeFiles,
            worktrees,
        };
    }

    /**
     * バイト数を人間が読める形式に変換
     * @param {number} bytes - バイト数
     * @returns {string} フォーマットされた文字列
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

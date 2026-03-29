import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import { logger } from '../utils/logger.js';
import { formatBytes } from '../lib/validation.js';

const execPromise = util.promisify(exec);

/**
 * Storage Management Service
 * ディスク使用量、大きなファイル検出、クリーンアップ候補の特定
 */
export class StorageService {
    constructor(workspaceDir = process.env.WORKSPACE_ROOT || '/path/to/workspace') {
        this.workspaceDir = workspaceDir;
        this.worktreesDir = path.join(workspaceDir, '.worktrees');

        // キャッシュストレージ（インメモリ）
        this._cache = new Map();
        this._cacheTTL = 5 * 60 * 1000; // 5分（ミリ秒）
    }

    /**
     * キャッシュ付きで関数を実行
     * @param {string} key - キャッシュキー
     * @param {Function} fn - 実行する関数（async）
     * @returns {Promise<any>} キャッシュまたは計算結果
     */
    async _cacheWithTTL(key, fn) {
        const cached = this._cache.get(key);
        const now = Date.now();

        // キャッシュが有効な場合は即座に返す
        if (cached && (now - cached.timestamp) < this._cacheTTL) {
            logger.info(`[StorageService] Cache hit: ${key} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
            return cached.value;
        }

        // キャッシュが無効または存在しない場合、計算して保存
        logger.info(`[StorageService] Cache miss: ${key}, calculating...`);
        const value = await fn();
        this._cache.set(key, { value, timestamp: now });

        return value;
    }

    /**
     * キャッシュの経過時間を取得（秒）
     * @param {string} key - キャッシュキー
     * @returns {number|null} 経過時間（秒）
     */
    _getCacheAge(key) {
        const cached = this._cache.get(key);
        if (!cached) return null;
        return Math.round((Date.now() - cached.timestamp) / 1000);
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
            logger.error(`[StorageService] Failed to get directory size for ${dir}:`, error.message);
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
            logger.error('[StorageService] Failed to get workspace storage:', error.message);
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
            logger.error('[StorageService] Failed to find large files:', error.message);
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
            logger.error('[StorageService] Failed to get worktrees sizes:', error.message);
            return [];
        }
    }

    /**
     * ストレージサマリー取得（キャッシュ付き、TTL: 5分）
     * @returns {Promise<Object>} ストレージサマリー
     */
    async getStorageSummary() {
        // キャッシュ付きで各メソッドを実行
        const [workspace, largeFiles, worktrees] = await Promise.all([
            this._cacheWithTTL('workspace', () => this.getWorkspaceStorage()),
            this._cacheWithTTL('largeFiles', () => this.findLargeFiles()),
            this._cacheWithTTL('worktrees', () => this.getWorktreesSizes()),
        ]);

        return {
            workspace,
            largeFiles,
            worktrees,
            cachedAt: new Date().toISOString(),
            cacheInfo: {
                workspaceAge: this._getCacheAge('workspace'),
                largeFilesAge: this._getCacheAge('largeFiles'),
                worktreesAge: this._getCacheAge('worktrees'),
            },
        };
    }

    // formatBytes imported from ../lib/validation.js
}

import { exec } from 'child_process';
import util from 'util';
import os from 'os';

const execPromise = util.promisify(exec);

/**
 * System Resource Monitoring Service
 * CPU、メモリ、ディスク使用率を取得
 */
export class SystemService {
    /**
     * CPU使用率取得（macOS）
     * @returns {Promise<Object>} CPU使用率情報
     */
    async getCPUUsage() {
        try {
            // macOSの場合: top コマンドで取得
            const { stdout } = await execPromise('top -l 1 -n 0 | grep "CPU usage"');

            // 出力例: "CPU usage: 5.32% user, 3.21% sys, 91.47% idle"
            const match = stdout.match(/(\d+\.\d+)% user, (\d+\.\d+)% sys, (\d+\.\d+)% idle/);

            if (match) {
                const user = parseFloat(match[1]);
                const sys = parseFloat(match[2]);
                const idle = parseFloat(match[3]);
                const usage = user + sys;

                return {
                    usage: parseFloat(usage.toFixed(2)),
                    user: parseFloat(user.toFixed(2)),
                    system: parseFloat(sys.toFixed(2)),
                    idle: parseFloat(idle.toFixed(2)),
                    cores: os.cpus().length,
                };
            }

            throw new Error('Failed to parse CPU usage');
        } catch (error) {
            console.error('[SystemService] Failed to get CPU usage:', error.message);
            return { error: error.message, usage: 0 };
        }
    }

    /**
     * メモリ使用率取得
     * @returns {Promise<Object>} メモリ使用率情報
     */
    async getMemoryUsage() {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const usagePercent = (usedMem / totalMem) * 100;

            return {
                total: this.formatBytes(totalMem),
                used: this.formatBytes(usedMem),
                free: this.formatBytes(freeMem),
                usage: parseFloat(usagePercent.toFixed(2)),
                totalBytes: totalMem,
                usedBytes: usedMem,
                freeBytes: freeMem,
            };
        } catch (error) {
            console.error('[SystemService] Failed to get memory usage:', error.message);
            return { error: error.message, usage: 0 };
        }
    }

    /**
     * ディスク使用率取得
     * @param {string} path - チェックするパス（デフォルト: /Users/ksato/workspace）
     * @returns {Promise<Object>} ディスク使用率情報
     */
    async getDiskUsage(path = '/Users/ksato/workspace') {
        try {
            const { stdout } = await execPromise(`df -h "${path}"`);

            // 出力例:
            // Filesystem      Size   Used  Avail Capacity  iused      ifree %iused  Mounted on
            // /dev/disk3s1s1  460Gi  14Gi  278Gi     5%   487824 2913361016    0%   /System/Volumes/Data

            const lines = stdout.trim().split('\n');
            if (lines.length < 2) {
                throw new Error('Unexpected df output');
            }

            const [, dataLine] = lines;
            const parts = dataLine.split(/\s+/);

            // parts = ['/dev/disk3s1s1', '460Gi', '14Gi', '278Gi', '5%', ...]
            const [filesystem, size, used, avail, capacity] = parts;

            return {
                filesystem,
                size,
                used,
                available: avail,
                usage: parseInt(capacity),
                path,
            };
        } catch (error) {
            console.error('[SystemService] Failed to get disk usage:', error.message);
            return { error: error.message, usage: 0 };
        }
    }

    /**
     * システム全体のステータス取得
     * @returns {Promise<Object>} システムステータス
     */
    async getSystemStatus() {
        const [cpu, memory, disk] = await Promise.all([
            this.getCPUUsage(),
            this.getMemoryUsage(),
            this.getDiskUsage(),
        ]);

        return {
            cpu,
            memory,
            disk,
            uptime: this.formatUptime(os.uptime()),
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
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

    /**
     * アップタイムを人間が読める形式に変換
     * @param {number} seconds - 秒数
     * @returns {string} フォーマットされた文字列
     */
    formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        const parts = [];
        if (days > 0) parts.push(`${days}日`);
        if (hours > 0) parts.push(`${hours}時間`);
        if (minutes > 0) parts.push(`${minutes}分`);

        return parts.join(' ') || '0分';
    }
}

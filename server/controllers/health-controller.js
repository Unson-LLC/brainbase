// @ts-check
/**
 * HealthController
 * システムヘルスチェックのHTTPリクエスト処理
 */
import { logger } from '../utils/logger.js';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ status: string, message: string, [key: string]: any }} HealthCheck */

const MEMORY_DEGRADED_PERCENT = 90;

function readPositiveByteLimit(filePath) {
    try {
        const value = readFileSync(filePath, 'utf8').trim();
        if (!value || value === 'max') return null;
        const bytes = Number(value);
        return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
    } catch {
        return null;
    }
}

function selectLowestBoundary(boundaries, fallback) {
    const finite = boundaries.filter(boundary =>
        boundary.bytes !== null && boundary.bytes <= fallback.bytes);
    return finite.length > 0
        ? finite.reduce((lowest, boundary) =>
            boundary.bytes < lowest.bytes ? boundary : lowest)
        : fallback;
}

export function resolveRuntimeMemory() {
    const hostBytes = os.totalmem();
    const host = {
        usedBytes: Math.max(0, hostBytes - os.freemem()),
        boundaryBytes: hostBytes,
        source: 'host'
    };

    try {
        const cgroupLines = readFileSync('/proc/self/cgroup', 'utf8').split('\n');
        const v2Line = cgroupLines.find(line => line.startsWith('0::'));
        if (v2Line) {
            const relativePath = v2Line.slice(3).replace(/^\/+/, '');
            const roots = [
                path.join('/sys/fs/cgroup', relativePath),
                '/sys/fs/cgroup'
            ];
            for (const root of roots) {
                const usedBytes = readPositiveByteLimit(path.join(root, 'memory.current'));
                if (usedBytes === null) continue;
                const boundary = selectLowestBoundary([
                    { bytes: readPositiveByteLimit(path.join(root, 'memory.high')), source: 'cgroup.v2.memory.high' },
                    { bytes: readPositiveByteLimit(path.join(root, 'memory.max')), source: 'cgroup.v2.memory.max' }
                ], { bytes: hostBytes, source: 'host.totalmem' });
                return { usedBytes, boundaryBytes: boundary.bytes, source: boundary.source };
            }
        }

        const v1Line = cgroupLines.find(line =>
            line.split(':')[1]?.split(',').includes('memory'));
        if (v1Line) {
            const relativePath = v1Line.split(':')[2]?.replace(/^\/+/, '') || '';
            const roots = [
                path.join('/sys/fs/cgroup/memory', relativePath),
                path.join('/sys/fs/cgroup', relativePath)
            ];
            for (const root of roots) {
                const usedBytes = readPositiveByteLimit(path.join(root, 'memory.usage_in_bytes'));
                if (usedBytes === null) continue;
                const boundary = selectLowestBoundary([
                    { bytes: readPositiveByteLimit(path.join(root, 'memory.soft_limit_in_bytes')), source: 'cgroup.v1.memory.soft_limit' },
                    { bytes: readPositiveByteLimit(path.join(root, 'memory.limit_in_bytes')), source: 'cgroup.v1.memory.limit' }
                ], { bytes: hostBytes, source: 'host.totalmem' });
                return { usedBytes, boundaryBytes: boundary.bytes, source: boundary.source };
            }
        }
    } catch {
        return host;
    }

    return host;
}

export function buildMemoryHealth(memoryUsage, runtimeMemory) {
    const toMB = bytes => Math.round(bytes / 1024 / 1024);
    const heapUsedMB = toMB(memoryUsage.heapUsed);
    const heapTotalMB = toMB(memoryUsage.heapTotal);
    const rssMB = toMB(memoryUsage.rss);
    const usedMB = toMB(runtimeMemory.usedBytes);
    const boundaryMB = toMB(runtimeMemory.boundaryBytes);
    const runtimeUsagePercent = Math.round(
        (runtimeMemory.usedBytes / runtimeMemory.boundaryBytes) * 100);
    const heapUsagePercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);

    return {
        status: runtimeUsagePercent > MEMORY_DEGRADED_PERCENT ? 'degraded' : 'healthy',
        message: `Runtime memory: ${usedMB}MB / ${boundaryMB}MB (${runtimeUsagePercent}%)`,
        details: {
            used: usedMB,
            boundary: boundaryMB,
            boundarySource: runtimeMemory.source,
            runtimeUsagePercent,
            rss: rssMB,
            heapUsed: heapUsedMB,
            heapTotal: heapTotalMB,
            heapUsagePercent,
            external: toMB(memoryUsage.external),
            arrayBuffers: toMB(memoryUsage.arrayBuffers)
        }
    };
}

export class HealthController {
    /**
     * @param {{ readiness?: any, configParser?: any, terminalRuntimeReconciler?: any }} deps
     */
    constructor({ readiness, configParser, terminalRuntimeReconciler = null }) {
        this.readiness = readiness;
        this.configParser = configParser;
        this.terminalRuntimeReconciler = terminalRuntimeReconciler;
        this.startTime = Date.now();
    }

    /**
     * GET /api/health
     * システムヘルスチェック
     * @param {Request} req
     * @param {Response} res
     */
    getHealth = async (req, res) => {
        try {
            const checks = await this._runHealthChecks();
            const overallStatus = this._calculateOverallStatus(checks);

            const response = {
                status: overallStatus,
                timestamp: new Date().toISOString(),
                uptime: Math.floor((Date.now() - this.startTime) / 1000),
                checks
            };

            const statusCode = overallStatus === 'healthy' ? 200 :
                               overallStatus === 'degraded' ? 200 : 503;

            res.status(statusCode).json(response);
        } catch (error) {
            logger.error('Health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Health check failed'
            });
        }
    };

    getTerminalHealth = async (req, res) => {
        if (!this.terminalRuntimeReconciler?.getHealth) {
            return res.status(503).json({
                status: 'unhealthy',
                error: 'terminal runtime reconciler is not available'
            });
        }

        try {
            const health = await this.terminalRuntimeReconciler.getHealth();
            res.status(health.status === 'unhealthy' ? 503 : 200).json(health);
        } catch (error) {
            logger.error('Terminal health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Terminal health check failed'
            });
        }
    };

    /**
     * 各種ヘルスチェックを実行
     * @private
     */
    /** @returns {Promise<Record<string, HealthCheck>>} */
    async _runHealthChecks() {
        /** @type {Record<string, HealthCheck>} */
        const checks = {};

        // 1. Server check (always healthy if we get here)
        checks.server = {
            status: 'healthy',
            message: 'Server is running'
        };

        // 2. Session Manager ready check
        try {
            const ready = this.readiness ? this.readiness.isReady() : true;
            checks.sessionManager = {
                status: ready ? 'healthy' : 'starting',
                message: ready ? 'Session manager is ready' : 'Session manager is initializing'
            };
        } catch (error) {
            checks.sessionManager = {
                status: 'unhealthy',
                message: error instanceof Error ? error.message : 'Session manager check failed'
            };
        }

        // 3. Config integrity check
        try {
            if (this.configParser) {
                const integrity = await this.configParser.checkIntegrity();
                const hasErrors = integrity.summary?.errors > 0;
                const hasWarnings = integrity.summary?.warnings > 0;

                checks.config = {
                    status: hasErrors ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
                    message: hasErrors
                        ? `${integrity.summary.errors} config errors found`
                        : hasWarnings
                            ? `${integrity.summary.warnings} config warnings found`
                            : 'Configuration is valid',
                    stats: integrity.stats
                };
            } else {
                checks.config = {
                    status: 'healthy',
                    message: 'Config parser not available (OSS mode)'
                };
            }
        } catch (error) {
            checks.config = {
                status: 'degraded',
                message: `Config check failed: ${error instanceof Error ? error.message : 'unknown error'}`
            };
        }

        // 4. Memory usage check
        checks.memory = buildMemoryHealth(process.memoryUsage(), resolveRuntimeMemory());

        return checks;
    }

    /**
     * 全体のステータスを計算
     * @private
     */
    /** @param {Record<string, HealthCheck>} checks */
    _calculateOverallStatus(checks) {
        const statuses = Object.values(checks).map(c => c.status);

        if (statuses.includes('unhealthy')) {
            return 'unhealthy';
        }
        if (statuses.includes('degraded') || statuses.includes('starting')) {
            return 'degraded';
        }
        return 'healthy';
    }
}

/**
 * HealthController
 * システムヘルスチェックのHTTPリクエスト処理
 */
export class HealthController {
    constructor({ sessionManager, configParser }) {
        this.sessionManager = sessionManager;
        this.configParser = configParser;
        this.startTime = Date.now();
    }

    /**
     * GET /api/health
     * システムヘルスチェック
     * @returns {Object} ヘルスチェック結果
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
            console.error('Health check failed:', error);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error.message
            });
        }
    };

    /**
     * 各種ヘルスチェックを実行
     * @private
     */
    async _runHealthChecks() {
        const checks = {};

        // 1. Server check (always healthy if we get here)
        checks.server = {
            status: 'healthy',
            message: 'Server is running'
        };

        // 2. Session Manager ready check
        try {
            const ready = this.sessionManager ? this.sessionManager.isReady() : true;
            checks.sessionManager = {
                status: ready ? 'healthy' : 'starting',
                message: ready ? 'Session manager is ready' : 'Session manager is initializing'
            };
        } catch (error) {
            checks.sessionManager = {
                status: 'unhealthy',
                message: error.message
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
                message: `Config check failed: ${error.message}`
            };
        }

        // 4. Memory usage check
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
        const heapUsagePercent = Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100);

        checks.memory = {
            status: heapUsagePercent > 90 ? 'degraded' : 'healthy',
            message: `Heap usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapUsagePercent}%)`,
            details: {
                heapUsed: heapUsedMB,
                heapTotal: heapTotalMB,
                heapUsagePercent
            }
        };

        return checks;
    }

    /**
     * 全体のステータスを計算
     * @private
     */
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

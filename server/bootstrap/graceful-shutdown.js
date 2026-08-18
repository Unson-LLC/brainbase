import { gracefulCleanup } from '../lib/graceful-cleanup.js';
import { HTTP_SERVER_CLOSE_TIMEOUT_MS } from '../../lib/server-lifecycle-timeouts.js';

export function registerGracefulShutdown({
    server,
    tenantRuntimeInternalServer = null,
    meetingSourceMcpSyncService = null,
    canonicalTaskOperationRepository = null,
    getMeshService = () => null,
    log = console
}) {
    async function gracefulShutdown(signal) {
        log.log(`\n${signal} received. Shutting down gracefully...`);

        const result = await gracefulCleanup('server-shutdown', [
            {
                name: 'close-http-server',
                fn: () => new Promise((resolve) => {
                    server.close(() => {
                        log.log('HTTP server closed');
                        resolve();
                    });
                    setTimeout(resolve, HTTP_SERVER_CLOSE_TIMEOUT_MS);
                })
            },
            {
                name: 'close-tenant-runtime-internal-server',
                fn: () => new Promise((resolve) => {
                    if (!tenantRuntimeInternalServer) return resolve();
                    tenantRuntimeInternalServer.close(() => {
                        log.log('Tenant runtime internal HTTP server closed');
                        resolve();
                    });
                    setTimeout(resolve, HTTP_SERVER_CLOSE_TIMEOUT_MS);
                })
            },
            {
                name: 'release-canonical-task-writer',
                fn: async () => {
                    await canonicalTaskOperationRepository?.releaseWriter?.();
                }
            },
            {
                name: 'stop-meeting-source-mcp-sync',
                fn: () => { meetingSourceMcpSyncService?.stopScheduledSync?.(); }
            },
            {
                name: 'stop-mesh-service',
                fn: async () => {
                    const meshService = getMeshService();
                    if (meshService) await meshService.stop();
                }
            }
        ]);

        if (result.warnings.length > 0) {
            log.warn('Shutdown warnings:', result.warnings);
        }
        log.log(`Graceful shutdown complete (${result.completed.length}/${result.completed.length + result.warnings.length} steps)`);
        process.exit(0);
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

import { gracefulCleanup } from '../lib/graceful-cleanup.js';

export function registerGracefulShutdown({
    server,
    meetingSourceMcpSyncService = null,
    eveMeetingNoteReconciler = null,
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
                    setTimeout(resolve, 5000);
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
                name: 'stop-eve-note-reconciler',
                fn: () => { eveMeetingNoteReconciler?.stopScheduledReconcile?.(); }
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

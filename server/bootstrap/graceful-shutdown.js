import { gracefulCleanup } from '../lib/graceful-cleanup.js';

export function registerGracefulShutdown({
    server,
    stateStore,
    conversationLinker,
    sessionServices,
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
                name: 'cleanup-state-store',
                fn: async () => {
                    if (stateStore.cleanup) await stateStore.cleanup();
                }
            },
            {
                name: 'stop-conversation-linker',
                fn: () => { conversationLinker.stopPeriodicLink(); }
            },
            {
                name: 'cleanup-session-runtime',
                fn: async () => {
                    if (sessionServices.runtime.lifecycle.cleanup) {
                        await sessionServices.runtime.lifecycle.cleanup();
                    }
                }
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

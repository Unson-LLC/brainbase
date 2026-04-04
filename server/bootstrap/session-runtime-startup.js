export async function initializeSessionRuntime({
    stateStore,
    sessionServices,
    conversationLinker,
    testMode,
    log = console
}) {
    try {
        await stateStore.init();
        await sessionServices.workspace.reconcileSessionWorkspacePaths();
        await sessionServices.activity.restoreHookStatus();

        if (!testMode) {
            await sessionServices.runtime.maintenance.restoreActiveSessions();
            await sessionServices.runtime.maintenance.cleanupOrphans();
            sessionServices.runtime.maintenance.startPtyWatchdog();

            log.log('[BRAINBASE] Starting conversation linker...');
            conversationLinker.linkAll().catch(err => {
                log.error('[BRAINBASE] Initial conversation link failed:', err.message);
            });
            conversationLinker.startPeriodicLink(5 * 60 * 1000);
        } else {
            log.log('[BRAINBASE] Skipping session restoration and cleanup (TEST_MODE)');
        }
    } catch (error) {
        log.error('[BRAINBASE] Initialization failed:', error);
    } finally {
        sessionServices.runtime.registry.markReady();
    }
}

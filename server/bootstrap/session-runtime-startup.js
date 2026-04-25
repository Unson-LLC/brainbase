export async function initializeSessionRuntime({
    stateStore,
    sessionServices,
    archiveFinalizer,
    conversationLinker,
    testMode,
    log = console
}) {
    try {
        await stateStore.init();
        await archiveFinalizer?.migrateLegacyArchivedSessions?.();
        await sessionServices.workspace.reconcileSessionWorkspacePaths();
        await sessionServices.activity.restoreHookStatus();

        if (!testMode) {
            await sessionServices.runtime.maintenance.restoreActiveSessions();
            await sessionServices.runtime.maintenance.cleanupOrphans();
            sessionServices.runtime.maintenance.startPtyWatchdog();
            archiveFinalizer?.drainQueued?.({ limit: 3 }).catch(err => {
                log.error('[BRAINBASE] Initial archive finalizer drain failed:', err.message);
            });
            archiveFinalizer?.start?.();

            log.log('[BRAINBASE] Starting conversation linker...');
            conversationLinker.linkAll({ limit: 10 }).catch(err => {
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

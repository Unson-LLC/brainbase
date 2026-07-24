export async function initializeSessionRuntime({
    stateStore,
    sessionServices,
    log = console
}) {
    try {
        await stateStore.init();
        log.log('[BRAINBASE] Legacy session state loaded read-only; Codex owns task, worktree, and terminal lifecycle');
    } catch (error) {
        log.error('[BRAINBASE] Initialization failed:', error);
    } finally {
        sessionServices.runtime.registry.markReady();
    }
}

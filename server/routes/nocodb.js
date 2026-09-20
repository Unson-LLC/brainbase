import { createRetiredCapabilityRouter } from './retired-capability.js';

/**
 * The former NocoDB CRUD API is retained as an explicit retired boundary.
 *
 * Keeping the mount point makes stale clients fail with a deterministic 410
 * instead of silently reaching the legacy writer. Migration and historical
 * compatibility callers use the repository directly and do not pass through
 * this HTTP route.
 */
export function createNocoDBRouter() {
    return createRetiredCapabilityRouter({
        capability: 'brainbase.nocodb-api',
        owner: 'Canonical Task PostgreSQL API',
        replacement: 'Use /api/companion/tasks backed by PostgreSQL'
    });
}

import { logger } from '../server/utils/logger.js';

/**
 * Promise-based mutex for sequential execution of async operations.
 * Mixin pattern: call initMutex() in constructor, then use runAtomic().
 */
export const AtomicMixin = {
    initMutex() {
        this.mutex = Promise.resolve();
    },

    async runAtomic(operation) {
        const result = this.mutex.then(() => operation().catch(err => {
            logger.error('Atomic operation failed:', err);
            throw err;
        }));
        this.mutex = result.catch(() => {});
        return result;
    }
};

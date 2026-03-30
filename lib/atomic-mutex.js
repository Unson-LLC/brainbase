// @ts-check
import { logger } from '../server/utils/logger.js';

/** @typedef {{ mutex?: Promise<unknown> }} AtomicContext */

/**
 * Promise-based mutex for sequential execution of async operations.
 * Mixin pattern: call initMutex() in constructor, then use runAtomic().
 */
export const AtomicMixin = {
    /**
     * @this {AtomicContext}
     */
    initMutex() {
        this.mutex = Promise.resolve();
    },

    /**
     * @template T
     * @this {AtomicContext}
     * @param {() => Promise<T>} operation
     * @returns {Promise<T>}
     */
    async runAtomic(operation) {
        const result = (this.mutex || Promise.resolve()).then(() => operation().catch((err) => {
            logger.error('Atomic operation failed:', err);
            throw err;
        }));
        this.mutex = result.catch(() => {});
        return result;
    }
};

/**
 * Utility to serialize async operations so that only one runs at a time.
 * Keeps behavior consistent with previous runAtomic helpers spread across lib/.
 * @param {Object} options
 * @param {string} [options.label] - Label used in error logs for easier tracing
 * @param {boolean} [options.strict=false] - When true, non-function operations are skipped with a warning instead of throwing
 * @returns {(operation: Function) => Promise<*>}
 */
export function createAtomicRunner({ label = 'Atomic operation', strict = false } = {}) {
    let queue = Promise.resolve();

    return async (operation) => {
        const isFunction = typeof operation === 'function';
        if (!isFunction && !strict) {
            throw new TypeError('operation is not a function');
        }

        const run = queue.then(async () => {
            if (!isFunction) {
                console.warn(`${label} skipped: operation is not a function`);
                return undefined;
            }

            try {
                return await operation();
            } catch (error) {
                console.error(`${label} failed:`, error);
                throw error;
            }
        });

        // Ensure queue keeps flowing even if the operation throws.
        queue = run.catch(() => { });
        return run;
    };
}

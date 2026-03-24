/**
 * Utility to serialize async operations so that only one runs at a time.
 * Keeps behavior consistent with previous runAtomic helpers spread across lib/.
 * @param {Object} options
 * @param {string} [options.label] - Label used in error logs for easier tracing
 * @returns {(operation: Function) => Promise<*>}
 */
export function createAtomicRunner({ label = 'Atomic operation' } = {}) {
    let queue = Promise.resolve();

    return async (operation) => {
        const run = queue.then(() =>
            Promise.resolve()
                .then(operation)
                .catch(err => {
                    console.error(`${label} failed:`, err);
                    throw err;
                })
        );

        // Ensure queue keeps flowing even if the operation throws.
        queue = run.catch(() => { });
        return run;
    };
}

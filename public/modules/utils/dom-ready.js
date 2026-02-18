const DEFAULT_TIMEOUT = 5000;
const POLL_INTERVAL = 100;

/**
 * Resolve when the DOM already contains the given selector or it appears shortly after.
 * Helps large controllers avoid early returns and scattered null checks.
 *
 * @param {string} selector
 * @param {{timeout?:number}} [options]
 * @returns {Promise<Element|null>}
 */
export async function waitForElement(selector, options = {}) {
    if (typeof document === 'undefined') return null;
    const { timeout = DEFAULT_TIMEOUT } = options;
    const existing = document.querySelector(selector);
    if (existing) return existing;

    return new Promise((resolve) => {
        const deadline = Date.now() + timeout;
        const resolveOnce = (value) => {
            cleanup();
            resolve(value);
        };

        const cleanup = () => {
            observer.disconnect();
            clearInterval(interval);
        };

        const observer = new MutationObserver(() => {
            const el = document.querySelector(selector);
            if (el) {
                resolveOnce(el);
            }
        });

        const interval = setInterval(() => {
            if (Date.now() > deadline) {
                resolveOnce(null);
            }
        }, POLL_INTERVAL);

        observer.observe(document.documentElement, { childList: true, subtree: true });
    });
}

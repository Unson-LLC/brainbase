// @ts-check

/**
 * @typedef {Object} XtermModules
 * @property {new (...args: any[]) => any} Terminal - xterm.js Terminal constructor
 * @property {new (...args: any[]) => any} FitAddon - FitAddon constructor
 * @property {new (...args: any[]) => any} WebLinksAddon - WebLinksAddon constructor
 */

const XTERM_JS_URL = 'https://unpkg.com/@xterm/xterm@5.5.0/lib/xterm.js';
const XTERM_CSS_URL = 'https://unpkg.com/@xterm/xterm@5.5.0/css/xterm.css';
const XTERM_FIT_URL = 'https://unpkg.com/@xterm/addon-fit@0.10.0/lib/addon-fit.js';
const XTERM_WEBLINKS_URL = 'https://unpkg.com/@xterm/addon-web-links@0.11.0/lib/addon-web-links.js';

/** @type {Promise<XtermModules> | null} */
let loadPromise = null;

/** @param {string} href */
function ensureStyle(href) {
    const existing = document.querySelector(`link[data-bb-xterm="${href}"]`);
    if (existing) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.bbXterm = href;
    document.head.appendChild(link);
}

/**
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = /** @type {HTMLScriptElement | null} */ (document.querySelector(`script[data-bb-xterm="${src}"]`));
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.bbXterm = src;
        script.addEventListener('load', () => {
            script.dataset.loaded = 'true';
            resolve();
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        document.head.appendChild(script);
    });
}

/**
 * Load xterm.js and addons from CDN.
 * @returns {Promise<XtermModules>}
 */
export async function loadXterm() {
    if (loadPromise) return await loadPromise;

    loadPromise = (async () => {
        ensureStyle(XTERM_CSS_URL);
        await loadScript(XTERM_JS_URL);
        await loadScript(XTERM_FIT_URL);
        await loadScript(XTERM_WEBLINKS_URL);

        const Terminal = /** @type {any} */ (window).Terminal;
        const FitAddon = /** @type {any} */ (window).FitAddon?.FitAddon || /** @type {any} */ (window).FitAddon;
        const WebLinksAddon = /** @type {any} */ (window).WebLinksAddon?.WebLinksAddon || /** @type {any} */ (window).WebLinksAddon;
        if (!Terminal || !FitAddon) {
            throw new Error('xterm.js globals are not available');
        }

        return { Terminal, FitAddon, WebLinksAddon };
    })();

    return await loadPromise;
}

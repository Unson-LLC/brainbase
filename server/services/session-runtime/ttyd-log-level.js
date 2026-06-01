/**
 * Classify a ttyd stderr chunk to an appropriate application log level.
 *
 * ttyd writes its NORMAL startup output to stderr, each line carrying a
 * libwebsockets severity token right after the timestamp, e.g.:
 *   "[06/01 22:25:38:] N: ttyd 1.7.7-unknown ..."   notice  -> info
 *   "[06/01 22:25:38:] W: Can't open ...key"         warning -> warn
 *   "[06/01 22:25:38:] E: lws_create_context failed" error   -> error
 *   "[06/01 22:25:38:] D: ..."                        debug   -> info
 *
 * Routing every stderr chunk to logger.error mislabels these benign banners
 * as errors and floods the error stream (observed: 297/300 error lines were
 * ttyd notices), burying the few real errors. This classifier lets the caller
 * log each chunk at its true level.
 *
 * A chunk may span multiple lines; it is classified by its HIGHEST severity so
 * a genuine "E:" line is never downgraded by surrounding notices. Lines with no
 * recognizable ttyd token default to 'warn' (unexpected stderr stays visible
 * without re-polluting the error stream); an empty/whitespace chunk is 'info'.
 *
 * @param {string|Buffer|null|undefined} data
 * @returns {'info'|'warn'|'error'}
 */
const LEVEL_RANK = { info: 0, warn: 1, error: 2 };

function tokenToLevel(token) {
    switch (token) {
        case 'E':
            return 'error';
        case 'W':
            return 'warn';
        case 'N':
        case 'D':
            return 'info';
        default:
            return null;
    }
}

function classifyLine(line) {
    // Token after the timestamp bracket: "] N:", "] W:", etc.
    const withTs = line.match(/\]\s+([NWED]):/);
    if (withTs) {
        return tokenToLevel(withTs[1]);
    }
    // Bare leading token (rare partial/continuation lines): "N: ..."
    const bare = line.match(/^\s*([NWED]):/);
    if (bare) {
        return tokenToLevel(bare[1]);
    }
    return null;
}

export function classifyTtydStderrLevel(data) {
    const text = data == null ? '' : String(data);
    if (text.trim() === '') {
        return 'info';
    }

    let best = null;
    let sawToken = false;
    for (const line of text.split('\n')) {
        if (line.trim() === '') {
            continue;
        }
        const level = classifyLine(line);
        if (level == null) {
            continue;
        }
        sawToken = true;
        if (best == null || LEVEL_RANK[level] > LEVEL_RANK[best]) {
            best = level;
        }
    }

    if (!sawToken) {
        // Non-empty stderr without any recognizable ttyd token: keep it visible
        // but do not treat as a hard error.
        return 'warn';
    }
    return best;
}

/**
 * Log a ttyd stderr chunk at its classified severity level.
 *
 * This is the load-bearing wiring extracted so it is directly testable: the
 * ttyd stderr handler delegates here instead of calling logger.error directly.
 * The original `[ttyd:${sessionId}] ${data}` message payload is preserved
 * verbatim; only the chosen log level changes.
 *
 * @param {{info: Function, warn: Function, error: Function}} logger
 * @param {string} sessionId
 * @param {string|Buffer} data
 * @returns {'info'|'warn'|'error'} the level the chunk was logged at
 */
export function logTtydStderr(logger, sessionId, data) {
    const level = classifyTtydStderrLevel(data);
    logger[level](`[ttyd:${sessionId}] ${data}`);
    return level;
}

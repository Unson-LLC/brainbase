export const DEFAULT_HISTORY_LIMIT = 10;
export const DEFAULT_PIN_SLOTS = 3;

export function normalizeHistory(history, limit = DEFAULT_HISTORY_LIMIT) {
    if (!Array.isArray(history)) return [];
    const seen = new Set();
    const result = [];
    for (const item of history) {
        const text = typeof item === 'string' ? item.trim() : '';
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

export function pushHistory(history, text, limit = DEFAULT_HISTORY_LIMIT) {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return normalizeHistory(history, limit);
    const base = Array.isArray(history) ? history : [];
    const filtered = base.filter(item => item !== trimmed);
    return [trimmed, ...filtered].slice(0, limit);
}

export function findWordBoundaryLeft(text, index) {
    if (!text) return 0;
    let i = Math.max(0, Math.min(index, text.length));
    while (i > 0 && /\s/.test(text[i - 1])) {
        i -= 1;
    }
    while (i > 0 && !/\s/.test(text[i - 1])) {
        i -= 1;
    }
    return i;
}

export function findWordBoundaryRight(text, index) {
    if (!text) return 0;
    let i = Math.max(0, Math.min(index, text.length));
    while (i < text.length && /\s/.test(text[i])) {
        i += 1;
    }
    while (i < text.length && !/\s/.test(text[i])) {
        i += 1;
    }
    return i;
}

export function calcKeyboardOffset(innerHeight, viewportHeight, viewportOffsetTop = 0) {
    if (typeof innerHeight !== 'number' || typeof viewportHeight !== 'number') return 0;
    // Keyboard height is simply the difference between inner height and viewport height
    // offsetTop is viewport scroll position and should NOT be subtracted from keyboard offset
    return Math.max(0, innerHeight - viewportHeight);
}

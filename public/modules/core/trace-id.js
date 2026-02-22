/**
 * 追跡用IDを生成
 * @param {string} prefix
 * @returns {string}
 */
export function createTraceId(prefix = 'bb') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${ts}-${rand}`;
}

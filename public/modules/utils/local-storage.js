// @ts-check

/**
 * localStorage JSON操作のユーティリティ
 */

/**
 * localStorageからJSONをパースして取得
 * @param {string} key
 * @param {*} fallback - パース失敗時のデフォルト値
 * @returns {*}
 */
export function loadJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch (error) {
        console.warn('Failed to load storage:', key, error);
        return fallback;
    }
}

/**
 * localStorageにJSON文字列で保存
 * @param {string} key
 * @param {*} value
 */
export function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn('Failed to save storage:', key, error);
    }
}

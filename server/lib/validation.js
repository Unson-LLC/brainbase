/**
 * 共通バリデーションユーティリティ
 */

/**
 * オブジェクトから許可されたフィールドのみを抽出する
 *
 * @param {Object} obj - 入力オブジェクト
 * @param {string[]} allowedFields - 許可するフィールド名の配列
 * @returns {Object|null} フィルタ済みオブジェクト（入力が不正または有効フィールドが0件の場合はnull）
 */
export function pickAllowedFields(obj, allowedFields) {
    if (!obj || typeof obj !== 'object') {
        return null;
    }

    const picked = {};
    for (const key of allowedFields) {
        if (key in obj) {
            picked[key] = obj[key];
        }
    }

    return Object.keys(picked).length > 0 ? picked : null;
}

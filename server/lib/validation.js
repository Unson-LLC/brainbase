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

/**
 * 日付をYYYY-MM-DD形式にフォーマットする
 * @param {Date} date
 * @returns {string}
 */
export function formatDateYMD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 1週間後の期限日を取得
 * @returns {string} YYYY-MM-DD形式
 */
export function getDefaultDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return formatDateYMD(date);
}

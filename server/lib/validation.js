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

/**
 * 優先度ラベルマッピング（英語→日本語）
 */
export const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

/**
 * 優先度ラベルを日本語で取得
 * @param {string} priority
 * @returns {string}
 */
export function getPriorityLabel(priority) {
    return PRIORITY_LABELS[priority] || priority;
}

/**
 * テスト/開発環境でのヘッダーベース認証を許可するか判定
 * @returns {boolean}
 */
export function isInsecureHeaderAuthAllowed() {
    return process.env.ALLOW_INSECURE_SSOT_HEADERS === 'true'
        || process.env.BRAINBASE_TEST_MODE === 'true'
        || process.env.NODE_ENV === 'test';
}

/**
 * CSV文字列をパースして配列に変換
 * @param {string} value
 * @returns {string[]}
 */
export function parseCsv(value) {
    if (!value || typeof value !== 'string') return [];
    return value.split(',').map(v => v.trim()).filter(Boolean);
}

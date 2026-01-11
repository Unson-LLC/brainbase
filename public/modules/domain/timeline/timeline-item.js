/**
 * タイムライン項目のスキーマ定義とバリデーション
 */

/**
 * タイムライン項目のタイプ定数
 */
export const TIMELINE_TYPES = {
    COMMAND: 'command',
    SESSION: 'session',
    MANUAL: 'manual',
    TASK: 'task',
    SYSTEM: 'system'
};

const VALID_TYPES = Object.values(TIMELINE_TYPES);
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 5000;

/**
 * タイムラインIDを生成
 * @returns {string} tl_{timestamp}_{random} 形式のID
 */
export function generateTimelineId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    return `tl_${timestamp}_${random}`;
}

/**
 * ISO8601形式の日時文字列かどうかを検証
 * @param {string} str - 検証する文字列
 * @returns {boolean}
 */
function isValidISO8601(str) {
    if (typeof str !== 'string') return false;
    const date = new Date(str);
    return !isNaN(date.getTime()) && str.includes('-');
}

/**
 * タイムライン項目のバリデーション
 * @param {Object} item - 検証する項目
 * @returns {string[]} エラーメッセージの配列
 */
export function validateTimelineItem(item) {
    const errors = [];

    // 必須フィールド
    if (!item.id) {
        errors.push('id is required');
    }
    if (!item.timestamp) {
        errors.push('timestamp is required');
    } else if (!isValidISO8601(item.timestamp)) {
        errors.push('timestamp must be valid ISO8601 format');
    }
    if (!item.type) {
        errors.push('type is required');
    } else if (!VALID_TYPES.includes(item.type)) {
        errors.push(`type must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!item.title) {
        errors.push('title is required');
    } else if (item.title.length > MAX_TITLE_LENGTH) {
        errors.push(`title must be ${MAX_TITLE_LENGTH} characters or less`);
    }

    // オプションフィールド
    if (item.content && item.content.length > MAX_CONTENT_LENGTH) {
        errors.push(`content must be ${MAX_CONTENT_LENGTH} characters or less`);
    }

    return errors;
}

/**
 * タイムライン項目クラス
 */
export class TimelineItem {
    /**
     * @param {Object} data - 初期データ
     * @param {string} data.type - 項目タイプ (command, session, manual, task, system)
     * @param {string} data.title - タイトル
     * @param {string} [data.id] - ID（省略時は自動生成）
     * @param {string} [data.timestamp] - タイムスタンプ（省略時は現在時刻）
     * @param {string} [data.content] - 詳細内容
     * @param {string} [data.linkedTaskId] - リンク先タスクID
     * @param {string} [data.sessionId] - 関連セッションID
     * @param {Object} [data.metadata] - メタデータ
     * @param {string} [data.createdAt] - 作成日時
     * @param {string} [data.updatedAt] - 更新日時
     */
    constructor(data) {
        const now = new Date().toISOString();

        this.id = data.id || generateTimelineId();
        this.timestamp = data.timestamp || now;
        this.type = data.type;
        this.title = data.title;
        this.content = data.content || null;
        this.linkedTaskId = data.linkedTaskId || null;
        this.sessionId = data.sessionId || null;
        this.metadata = data.metadata || {};
        this.createdAt = data.createdAt || now;
        this.updatedAt = data.updatedAt || now;
    }

    /**
     * バリデーション実行（エラー時は例外をスロー）
     * @throws {Error} バリデーションエラー時
     */
    validate() {
        const errors = validateTimelineItem(this);
        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }
    }

    /**
     * シリアライズ
     * @returns {Object} JSON化可能なオブジェクト
     */
    toJSON() {
        return {
            id: this.id,
            timestamp: this.timestamp,
            type: this.type,
            title: this.title,
            content: this.content,
            linkedTaskId: this.linkedTaskId,
            sessionId: this.sessionId,
            metadata: this.metadata,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }

    /**
     * JSONからインスタンスを復元
     * @param {Object} data - JSONデータ
     * @returns {TimelineItem}
     */
    static fromJSON(data) {
        return new TimelineItem(data);
    }
}

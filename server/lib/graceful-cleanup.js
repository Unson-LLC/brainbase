// @ts-check
import { logger } from '../utils/logger.js';
/**
 * Graceful Partial Cleanup（CommandMateパターン）
 *
 * 複数のクリーンアップステップを順に実行し、
 * 個別のステップが失敗しても後続ステップを続行する。
 * 部分的な成功を許容し、警告を収集して返す。
 */

/**
 * @param {string} contextId - ログ用のコンテキストID（セッションIDなど）
 * @param {Array<{ name: string, fn: () => Promise<any> | any }>} steps - クリーンアップステップ
 * @returns {Promise<{ success: boolean, completed: string[], warnings: string[] }>}
 */
export async function gracefulCleanup(contextId, steps) {
    /** @type {string[]} */
    const completed = [];
    /** @type {string[]} */
    const warnings = [];

    for (const step of steps) {
        try {
            await step.fn();
            completed.push(step.name);
        } catch (error) {
            const message = `[GracefulCleanup] ${contextId}: ${step.name} failed - ${error instanceof Error ? error.message : String(error)}`;
            logger.warn(message);
            warnings.push(message);
        }
    }

    const allFailed = steps.length > 0 && completed.length === 0;

    return {
        success: !allFailed,
        completed,
        warnings
    };
}

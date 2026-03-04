/**
 * TerminalOutputParser
 * ターミナル出力の解析ユーティリティ
 */
export class TerminalOutputParser {
    /**
     * ターミナル出力から選択肢を検出
     * @param {string} text - ターミナル出力テキスト
     * @returns {Array} 検出された選択肢の配列
     *
     * Claude Codeが"Enter to select"プロンプトと共に
     * 番号付き選択肢を表示している場合のみ検出する。
     *
     * 例:
     * ```
     * ❯ 1. Option A
     *   2. Option B
     *   3. Option C
     * Enter to select (1-3):
     * ```
     */
    detectChoices(text) {
        // Check the last 30 lines of output to capture choices and prompt
        const lines = text.split('\n');
        const lastLines = lines.slice(-30).join('\n');

        // Strict check: only detect choices if "Enter to select" prompt is present
        if (!lastLines.includes('Enter to select')) {
            return [];
        }

        const choices = [];

        // Pattern 1: "1) Option" or "1. Option"
        // Also matches with selection marker: "❯ 1. Option" or "  1. Option"
        const pattern1 = /^\s*[❯>]?\s*(\d+)[).]\s+(.+)$/gm;
        let match;
        while ((match = pattern1.exec(lastLines)) !== null) {
            choices.push({
                number: match[1],
                text: match[2].trim(),
                originalText: match[0].trim(), // Claude Codeの出力をそのまま保持
                pattern: 'numbered'
            });
        }

        // Only return if we have sequential numbers starting from 1
        // and at least 2 choices
        if (choices.length >= 2) {
            const numbers = choices.map(c => parseInt(c.number));
            const isSequential = numbers.every((num, idx) =>
                idx === 0 || num === numbers[idx - 1] + 1
            );
            const startsFromOne = numbers[0] === 1;

            if (isSequential && startsFromOne) {
                return choices;
            }
        }

        return [];
    }
}

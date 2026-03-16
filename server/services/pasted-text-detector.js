/**
 * ペーストテキスト検出（CommandMate移植）
 *
 * マルチラインテキストをターミナルにペーストした際に表示される
 * [Pasted text #N +M lines] オーバーレイを検出する。
 *
 * CommandMateのpasted text detection:
 * 1. メッセージ送信 → 500ms待機
 * 2. 末尾10行をキャプチャ
 * 3. パターン検出 → Enter送信で確定
 * 4. リトライ最大3回（1500ms max）
 */

/**
 * ペーストテキストオーバーレイのパターン
 * 例: [Pasted text #1 +46 lines]
 */
export const PASTED_TEXT_PATTERN = /\[Pasted text #\d+ \+\d+ lines?\]/;

const TAIL_LINES = 10;

/**
 * ターミナル出力にペーストテキストオーバーレイが含まれるか検出
 *
 * @param {string|null} output - tmux capture-pane の出力
 * @returns {boolean} オーバーレイが検出された場合true
 */
export function detectPastedTextOverlay(output) {
    if (!output || typeof output !== 'string') {
        return false;
    }

    const lines = output.split('\n');
    const tail = lines.slice(-TAIL_LINES).join('\n');

    return PASTED_TEXT_PATTERN.test(tail);
}

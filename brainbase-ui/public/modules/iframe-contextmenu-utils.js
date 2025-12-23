/**
 * iframe Contextmenu Utilities
 * iframe内右クリックメニューのための座標変換とファイルパス検出
 */

// ファイルパス検出パターン（file-opener.jsから再利用）
// 注意：より具体的なパターン（~/, ./）を先にチェックする
const FILE_PATH_PATTERNS = [
    // ホームディレクトリ相対パス（~から始まる） - 最優先
    /(~\/[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?/g,
    // 相対パス（./から始まる）
    /(\.[\/][a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?/g,
    // 絶対パス（/から始まる）
    /(\/[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?/g,
    // ワークスペースルート相対（英数字から始まり、/を含む）
    /([a-zA-Z0-9_.\-]+\/[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?/g
];

export function convertIframeToParentCoordinates(iframeEvent, iframeRect, scrollOffset) {
    return {
        x: iframeRect.left + iframeEvent.x + scrollOffset.x,
        y: iframeRect.top + iframeEvent.y + scrollOffset.y
    };
}

export function extractFilePathFromSelection(selectedText) {
    if (!selectedText || selectedText.trim().length === 0) {
        return null;
    }

    for (const pattern of FILE_PATH_PATTERNS) {
        pattern.lastIndex = 0;
        const match = pattern.exec(selectedText);

        if (match) {
            const path = match[1];
            const line = match[2] ? parseInt(match[2]) : null;
            return { path, line };
        }
    }

    return null;
}

export function shouldShowContextMenu(selectedText) {
    if (!selectedText || selectedText.trim().length === 0) {
        return false;
    }

    return extractFilePathFromSelection(selectedText) !== null;
}

export function calculateParentCoordinates(iframe, iframeCoords) {
    const iframeRect = iframe.getBoundingClientRect();
    const scrollOffset = {
        x: window.scrollX,
        y: window.scrollY
    };

    return convertIframeToParentCoordinates(iframeCoords, iframeRect, scrollOffset);
}

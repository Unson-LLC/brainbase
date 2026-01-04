/**
 * File Opener Utility
 * ファイルを開く/表示するためのヘルパー関数
 */

/**
 * ファイルパスを検出する正規表現
 * - 絶対パス: /で始まり、英数字、ハイフン、アンダースコア、ドット、スラッシュを含む
 * - Claude Code形式のファイル参照: file_path:line_number
 */
const FILE_PATH_PATTERNS = [
    // 絶対パス（/から始まる）
    /(?:^|\s)(\/[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?(?:\s|$)/g,
    // 相対パス（./から始まる）
    /(?:^|\s)(\.[\/][a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?(?:\s|$)/g,
    // ワークスペースルート相対（英数字から始まり、/を含む）
    /(?:^|\s)([a-zA-Z0-9_.\-]+\/[a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)(?::(\d+))?(?:\s|$)/g
];

/**
 * ファイルを開く
 * @param {string} path - ファイルパス
 * @param {string} mode - 開き方 ('file' | 'reveal' | 'cursor')
 * @returns {Promise<Object>} APIレスポンス
 */
export async function openFile(path, mode = 'file') {
    try {
        const response = await fetch('/api/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, mode })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to open file');
        }

        return result;
    } catch (error) {
        console.error('Error opening file:', error);
        throw error;
    }
}

/**
 * Finderでファイルを表示
 * @param {string} path - ファイルパス
 * @returns {Promise<Object>} APIレスポンス
 */
export async function revealInFinder(path) {
    return openFile(path, 'reveal');
}

/**
 * Cursorエディタでファイルを開く
 * @param {string} path - ファイルパス
 * @param {number} line - 行番号（オプション）
 * @returns {Promise<Object>} APIレスポンス
 */
export async function openInCursor(path, line) {
    try {
        const response = await fetch('/api/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, mode: 'cursor', line })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to open file');
        }

        return result;
    } catch (error) {
        console.error('Error opening file in Cursor:', error);
        throw error;
    }
}

/**
 * テキストからファイルパスを抽出
 * @param {string} text - テキスト
 * @returns {Array<{path: string, line: number|null}>} 検出されたファイルパス
 */
export function extractFilePaths(text) {
    const paths = [];
    const seen = new Set();

    for (const pattern of FILE_PATH_PATTERNS) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const path = match[1];
            const line = match[2] ? parseInt(match[2]) : null;
            const key = `${path}:${line || ''}`;

            if (!seen.has(key)) {
                seen.add(key);
                paths.push({ path, line });
            }
        }
    }

    return paths;
}

/**
 * 選択されたテキストを取得
 * @returns {string} 選択されたテキスト
 */
export function getSelectedText() {
    const selection = window.getSelection();
    return selection ? selection.toString().trim() : '';
}

/**
 * 選択されたテキストからファイルを開く
 * @param {string} mode - 開き方 ('file' | 'reveal' | 'cursor')
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function openSelectedFile(mode = 'file') {
    const selectedText = getSelectedText();

    if (!selectedText) {
        console.warn('No text selected');
        return false;
    }

    // ファイルパスを抽出
    const paths = extractFilePaths(selectedText);

    if (paths.length === 0) {
        // 選択されたテキスト全体をパスとして試す
        try {
            await openFile(selectedText, mode);
            console.log('Opened file:', selectedText);
            return true;
        } catch (error) {
            console.warn('Selected text is not a valid file path:', selectedText);
            return false;
        }
    }

    // 最初に見つかったパスを開く
    const { path, line } = paths[0];
    try {
        if (mode === 'cursor' && line) {
            await openInCursor(path, line);
        } else {
            await openFile(path, mode);
        }
        console.log('Opened file:', path, line ? `(line ${line})` : '');
        return true;
    } catch (error) {
        console.error('Failed to open file:', error);
        return false;
    }
}

/**
 * コンテキストメニューを作成
 */
function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'file-opener-context-menu';
    menu.style.cssText = `
        position: fixed;
        background: white;
        border: 1px solid #ccc;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 10001;
        display: none;
        min-width: 200px;
        padding: 4px 0;
    `;

    const menuItems = [
        { label: 'デフォルトアプリで開く', mode: 'file', icon: '📄' },
        { label: 'Finderで表示', mode: 'reveal', icon: '📁' },
        { label: 'Cursorで開く', mode: 'cursor', icon: '✏️' }
    ];

    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        const iconSpan = document.createElement('span');
        iconSpan.textContent = item.icon;
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        menuItem.appendChild(iconSpan);
        menuItem.appendChild(labelSpan);

        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = '#f0f0f0';
        });

        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'white';
        });

        menuItem.addEventListener('click', async () => {
            hideContextMenu();
            const success = await openSelectedFile(item.mode);
            if (success) {
                showNotification(`${item.label}しました`);
            } else {
                showNotification('ファイルパスが見つかりませんでした', 'error');
            }
        });

        menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);
    return menu;
}

/**
 * コンテキストメニューを表示
 */
function showContextMenu(x, y) {
    let menu = document.getElementById('file-opener-context-menu');
    if (!menu) {
        menu = createContextMenu();
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
}

/**
 * コンテキストメニューを非表示
 */
function hideContextMenu() {
    const menu = document.getElementById('file-opener-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

/**
 * キーボードショートカットとコンテキストメニューを設定
 *
 * キーボードショートカット:
 * - Cmd+Shift+O: デフォルトアプリで開く
 * - Cmd+Shift+R: Finderで表示
 * - Cmd+Shift+E: Cursorエディタで開く
 *
 * コンテキストメニュー:
 * - ファイルパスを選択して右クリック
 */
export function setupFileOpenerShortcuts() {
    // キーボードショートカット
    document.addEventListener('keydown', async (e) => {
        // Cmd+Shift+O: デフォルトアプリで開く
        if (e.metaKey && e.shiftKey && e.key === 'O') {
            e.preventDefault();
            const success = await openSelectedFile('file');
            if (success) {
                showNotification('ファイルを開きました');
            }
        }

        // Cmd+Shift+R: Finderで表示
        if (e.metaKey && e.shiftKey && e.key === 'R') {
            e.preventDefault();
            const success = await openSelectedFile('reveal');
            if (success) {
                showNotification('Finderで表示しました');
            }
        }

        // Cmd+Shift+E: Cursorエディタで開く
        if (e.metaKey && e.shiftKey && e.key === 'E') {
            e.preventDefault();
            const success = await openSelectedFile('cursor');
            if (success) {
                showNotification('Cursorで開きました');
            }
        }
    });

    // コンテキストメニュー
    document.addEventListener('contextmenu', (e) => {
        const selectedText = getSelectedText();

        // ファイルパスが選択されている場合のみメニューを表示
        if (selectedText) {
            const paths = extractFilePaths(selectedText);
            // ファイルパスっぽいテキストか、パスが検出された場合
            if (paths.length > 0 || selectedText.includes('/')) {
                e.preventDefault();
                showContextMenu(e.pageX, e.pageY);
            }
        }
    });

    // メニュー外をクリックしたら閉じる
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('file-opener-context-menu');
        if (menu && !menu.contains(e.target)) {
            hideContextMenu();
        }
    });

    // スクロール時にメニューを閉じる
    document.addEventListener('scroll', hideContextMenu, true);

    console.log('File opener enabled:');
    console.log('  Right-click on file path: Show context menu');
    console.log('  Cmd+Shift+O: Open in default app');
    console.log('  Cmd+Shift+R: Reveal in Finder');
    console.log('  Cmd+Shift+E: Open in Cursor');
}

/**
 * 通知を表示
 * @param {string} message - 通知メッセージ
 * @param {string} type - 通知タイプ ('success' | 'error')
 */
function showNotification(message, type = 'success') {
    // 簡易的な通知表示
    const notification = document.createElement('div');
    notification.textContent = message;

    const bgColor = type === 'error' ? '#f44336' : '#4caf50';

    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;

    // アニメーション定義
    if (!document.getElementById('file-opener-animation')) {
        const style = document.createElement('style');
        style.id = 'file-opener-animation';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(10px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // 2秒後に削除
    setTimeout(() => {
        notification.remove();
    }, 2000);
}

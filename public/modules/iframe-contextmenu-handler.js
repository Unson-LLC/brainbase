/**
 * iframe Contextmenu Handler
 * iframe内からのpostMessageを受信してカスタムコンテキストメニューを表示
 */

import {
    extractFilePathFromSelection,
    shouldShowContextMenu,
    convertIframeToParentCoordinates
} from './iframe-contextmenu-utils.js';

import { openFile, openInCursor } from './file-opener.js';
import { appStore } from './core/store.js';

/**
 * 現在のセッションのcwd（worktreeパス）を取得
 * @returns {string|null}
 */
function getCurrentSessionCwd() {
    const { sessions, currentSessionId } = appStore.getState();
    const session = sessions.find(s => s.id === currentSessionId);
    return session?.path || null;
}

let currentSelectedText = '';

/**
 * コンテキストメニューを作成
 */
function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'terminal-context-menu';
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
            color: #333;
            font-size: 14px;
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
            const fileInfo = extractFilePathFromSelection(currentSelectedText);
            if (fileInfo) {
                try {
                    const cwd = getCurrentSessionCwd();
                    const options = cwd ? { cwd } : {};
                    if (item.mode === 'cursor' && fileInfo.line) {
                        await openInCursor(fileInfo.path, fileInfo.line, options);
                    } else {
                        await openFile(fileInfo.path, item.mode, options);
                    }
                    showNotification(`${item.label}しました`);
                } catch (error) {
                    console.error('Failed to open file:', error);
                    showNotification('ファイルを開けませんでした', 'error');
                }
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
function showContextMenu(x, y, selectedText) {
    console.log('[ParentContextMenu] Showing context menu at', x, y, 'for text:', selectedText.substring(0, 50) + '...');

    currentSelectedText = selectedText;

    let menu = document.getElementById('terminal-context-menu');
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
    const menu = document.getElementById('terminal-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
}

/**
 * 通知を表示
 */
function showNotification(message, type = 'success') {
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

    if (!document.getElementById('terminal-context-menu-animation')) {
        const style = document.createElement('style');
        style.id = 'terminal-context-menu-animation';
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
    setTimeout(() => notification.remove(), 2000);
}

/**
 * postMessageハンドラー
 */
export function handleTerminalContextMenu(event) {
    console.log('[ParentContextMenu] Received message:', event.data);

    if (!event.data || event.data.type !== 'terminal-contextmenu') {
        return;
    }

    const { selectedText, x, y } = event.data;

    if (!shouldShowContextMenu(selectedText)) {
        console.log('[ParentContextMenu] No file path detected in selection');
        return;
    }

    const iframe = document.querySelector('iframe[src*="console"]');
    if (!iframe) {
        console.warn('[ParentContextMenu] Terminal iframe not found');
        return;
    }

    const iframeRect = iframe.getBoundingClientRect();
    const scrollOffset = {
        x: window.scrollX || 0,
        y: window.scrollY || 0
    };

    const parentCoords = convertIframeToParentCoordinates({ x, y }, iframeRect, scrollOffset);
    console.log('[ParentContextMenu] Converted coordinates:', parentCoords);

    showContextMenu(parentCoords.x, parentCoords.y, selectedText);
}

/**
 * postMessageリスナーをセットアップ
 */
export function setupTerminalContextMenuListener() {
    console.log('[ParentContextMenu] Setting up terminal context menu listener');

    window.addEventListener('message', handleTerminalContextMenu);

    // メニュー外をクリックしたら閉じる（キャプチャフェーズで早めに検知）
    document.addEventListener('click', (e) => {
        const menu = document.getElementById('terminal-context-menu');
        if (menu && menu.style.display === 'block' && !menu.contains(e.target)) {
            console.log('[ParentContextMenu] Closing menu - clicked outside');
            hideContextMenu();
        }
    }, true); // キャプチャフェーズで実行

    // 右クリックでもメニューを閉じる
    document.addEventListener('contextmenu', (e) => {
        const menu = document.getElementById('terminal-context-menu');
        if (menu && menu.style.display === 'block') {
            hideContextMenu();
        }
    }, true);

    // スクロール時にメニューを閉じる
    document.addEventListener('scroll', hideContextMenu, true);

    console.log('[ParentContextMenu] Terminal context menu listener enabled');
}

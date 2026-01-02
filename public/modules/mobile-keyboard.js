/**
 * mobile-keyboard.js
 * モバイルでキーボード表示時に画面が隠れないようにする
 * モバイル仮想キーボードのキーハンドリング
 */

import { appStore } from './core/store.js';

/**
 * キーボード表示時の対応を初期化
 */
export function initMobileKeyboard() {
    // Setup virtual keyboard key handlers
    setupVirtualKeyboardHandlers();
    // デスクトップでは何もしない
    if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
        return;
    }

    // Visual Viewport APIをサポートしているか確認
    if (!window.visualViewport) {
        console.warn('Visual Viewport API not supported');
        // フォールバック: 単純なscrollIntoViewのみ
        setupFallbackScrolling();
        return;
    }

    const viewport = window.visualViewport;
    let activeElement = null;
    let previousHeight = viewport.height;

    // ビューポートのリサイズを監視
    function handleResize() {
        const currentHeight = viewport.height;
        const heightDiff = previousHeight - currentHeight;

        // キーボードが表示された（高さが300px以上減少）
        const keyboardShown = heightDiff > 300;

        // iframe内ターミナルへのスクロール指示
        if (keyboardShown) {
            const terminalFrame = document.getElementById('terminal-frame');
            if (terminalFrame && terminalFrame.contentWindow) {
                terminalFrame.contentWindow.postMessage({
                    type: 'scroll-to-bottom',
                    source: 'brainbase-mobile-keyboard'
                }, '*');
                console.log('[MobileKeyboard] Sent scroll-to-bottom message to iframe');
            }
        }

        previousHeight = currentHeight;

        // 既存の処理: activeElementのスクロール
        if (!activeElement) return;

        // キーボードが表示されている間、フォーカスされた要素を画面内に保つ
        requestAnimationFrame(() => {
            const rect = activeElement.getBoundingClientRect();
            const viewportBottom = viewport.height;

            // 要素が画面外にある場合
            if (rect.bottom > viewportBottom) {
                // 要素が見えるようにスクロール
                const scrollAmount = rect.bottom - viewportBottom + 20; // 20pxのマージン
                window.scrollBy({
                    top: scrollAmount,
                    behavior: 'smooth'
                });
            }
        });
    }

    // ビューポート変更イベント
    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);

    // 入力フォーカス時の処理
    document.addEventListener('focusin', (e) => {
        const target = e.target;

        // input, textarea, contenteditable要素の場合
        if (target.matches('input, textarea, [contenteditable="true"]')) {
            activeElement = target;

            // 少し待ってからスクロール（キーボードアニメーション後）
            setTimeout(() => {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });

                // 追加でリサイズハンドラを呼び出す
                handleResize();
            }, 300);
        }
    });

    // フォーカス解除時
    document.addEventListener('focusout', () => {
        activeElement = null;
    });
}

/**
 * Visual Viewport API非サポート時のフォールバック
 */
function setupFallbackScrolling() {
    document.addEventListener('focusin', (e) => {
        const target = e.target;

        if (target.matches('input, textarea, [contenteditable="true"]')) {
            setTimeout(() => {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'nearest'
                });
            }, 300);
        }
    });
}

/**
 * モバイル仮想キーボードのキーハンドラーをセットアップ
 */
function setupVirtualKeyboardHandlers() {
    const keyUp = document.getElementById('key-up');
    const keyDown = document.getElementById('key-down');
    const keyTab = document.getElementById('key-tab');
    const keyEnter = document.getElementById('key-enter');

    // 現在のセッションIDを取得するヘルパー
    const getCurrentSessionId = () => {
        return appStore.getState().currentSessionId;
    };

    // キー入力を送信するヘルパー
    const sendKey = async (keyName) => {
        const sessionId = getCurrentSessionId();
        if (!sessionId) {
            console.warn('[VirtualKeyboard] No active session');
            return;
        }

        try {
            await fetch(`/api/sessions/${sessionId}/input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: keyName,
                    type: 'key'
                })
            });
            console.log('[VirtualKeyboard] Sent key:', keyName);
        } catch (error) {
            console.error('[VirtualKeyboard] Failed to send key:', keyName, error);
        }
    };

    // Up arrow key
    if (keyUp) {
        keyUp.addEventListener('click', () => {
            console.log('[VirtualKeyboard] Up arrow clicked');
            sendKey('Up');
        });
    }

    // Down arrow key
    if (keyDown) {
        keyDown.addEventListener('click', () => {
            console.log('[VirtualKeyboard] Down arrow clicked');
            sendKey('Down');
        });
    }

    // Tab key
    if (keyTab) {
        keyTab.addEventListener('click', () => {
            console.log('[VirtualKeyboard] Tab clicked');
            sendKey('Tab');
        });
    }

    // Enter key
    if (keyEnter) {
        keyEnter.addEventListener('click', () => {
            console.log('[VirtualKeyboard] Enter clicked');
            sendKey('Enter');
        });
    }

    console.log('[VirtualKeyboard] Virtual keyboard handlers initialized');
}

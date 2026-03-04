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

    // Mobile input dock handles keyboard positioning; skip terminal slide to avoid double shift
    const hasMobileDock = Boolean(document.getElementById('mobile-input-dock'));
    if (!hasMobileDock) {
        setupTerminalSlide();
    }
}

/**
 * ターミナルスライド機能をセットアップ
 * キーボード表示時にターミナルを上にスライドさせる
 */
function setupTerminalSlide() {
    const viewport = window.visualViewport;
    // 初期のビューポート高さを記録（キーボードなし時の基準）
    const initialHeight = viewport.height;

    console.log('[TerminalSlide] Initialized with viewport height:', initialHeight);

    function handleViewportChange() {
        const currentHeight = viewport.height;
        // キーボードの高さ = 初期高さ - 現在の高さ
        const keyboardHeight = initialHeight - currentHeight;

        // .console-area を取得
        const consoleArea = document.querySelector('.console-area');
        if (!consoleArea) {
            return;
        }

        // キーボードが表示されている（100px以上の差がある）
        if (keyboardHeight > 100) {
            // ターミナルを上にスライド
            consoleArea.style.transition = 'transform 0.2s ease-out';
            consoleArea.style.transform = `translateY(-${keyboardHeight}px)`;
            console.log('[TerminalSlide] Sliding up by:', keyboardHeight, 'px');
        } else {
            // キーボードが非表示、元の位置に戻す
            consoleArea.style.transition = 'transform 0.2s ease-out';
            consoleArea.style.transform = 'translateY(0)';
            console.log('[TerminalSlide] Reset to original position');
        }
    }

    // ビューポート変更イベント
    viewport.addEventListener('resize', handleViewportChange);
    viewport.addEventListener('scroll', handleViewportChange);

    console.log('[TerminalSlide] Terminal slide handlers setup complete');
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

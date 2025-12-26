/**
 * mobile-keyboard.js
 * モバイルでキーボード表示時に画面が隠れないようにする
 */

/**
 * キーボード表示時の対応を初期化
 */
export function initMobileKeyboard() {
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

    // ビューポートのリサイズを監視
    function handleResize() {
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

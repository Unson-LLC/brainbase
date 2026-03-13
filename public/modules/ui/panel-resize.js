/**
 * Panel Resize Module
 * 左パネル（サイドバー）と右パネル（コンテキストサイドバー）の幅をドラッグで変更可能にする
 */

const STORAGE_KEYS = {
    LEFT: 'brainbase:left-panel-width',
    RIGHT: 'brainbase:right-panel-width'
};

const DEFAULTS = {
    LEFT: { width: 280, min: 200, max: 400 },
    RIGHT: { width: 350, min: 280, max: 500 }
};

const PANEL_CONFIGS = [
    {
        key: 'LEFT',
        handleId: 'left-panel-resize-handle',
        panelId: 'sidebar',
        direction: 'left',
        missingWarning: '[PanelResize] Left panel elements not found'
    },
    {
        key: 'RIGHT',
        handleId: 'right-panel-resize-handle',
        panelId: 'context-sidebar',
        direction: 'right',
        missingWarning: '[PanelResize] Right panel elements not found'
    }
];

/**
 * パネルリサイズを初期化
 */
export function initPanelResize() {
    const cleanupFns = [];

    PANEL_CONFIGS.forEach(config => {
        const cleanup = initPanel(config);
        if (cleanup) cleanupFns.push(cleanup);
    });

    return () => {
        cleanupFns.forEach(fn => fn());
    };
}

function initPanel(config) {
    const handle = document.getElementById(config.handleId);
    const panel = document.getElementById(config.panelId);

    if (!handle || !panel) {
        console.warn(config.missingWarning);
        return null;
    }

    const defaults = DEFAULTS[config.key];
    return setupHorizontalResize({
        handle,
        panel,
        storageKey: STORAGE_KEYS[config.key],
        minWidth: defaults.min,
        maxWidth: defaults.max,
        defaultWidth: defaults.width,
        direction: config.direction
    });
}

/**
 * 水平リサイズのセットアップ
 */
function setupHorizontalResize({ handle, panel, storageKey, minWidth, maxWidth, defaultWidth, direction }) {
    let isDragging = false;
    let startX = 0;
    let startWidth = 0;
    let rafId = null;
    let pendingWidth = null;
    let overlay = null;

    // 保存された幅を復元
    const savedWidth = localStorage.getItem(storageKey);
    if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (!isNaN(width) && width >= minWidth && width <= maxWidth) {
            panel.style.width = `${width}px`;
        }
    } else if (typeof defaultWidth === 'number') {
        const clampedDefault = Math.max(minWidth, Math.min(maxWidth, defaultWidth));
        panel.style.width = `${clampedDefault}px`;
    }

    // リサイズ中にiframeのマウスイベントをブロックするオーバーレイ
    function createOverlay() {
        overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:ew-resize;';
        document.body.appendChild(overlay);
    }

    function removeOverlay() {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
            overlay = null;
        }
    }

    function updateWidth() {
        if (pendingWidth !== null) {
            panel.style.width = `${pendingWidth}px`;
            pendingWidth = null;
        }
        rafId = null;
    }

    function scheduleUpdate(width) {
        pendingWidth = width;
        if (!rafId) {
            rafId = requestAnimationFrame(updateWidth);
        }
    }

    function beginDrag(startClientX) {
        isDragging = true;
        startX = startClientX;
        startWidth = panel.offsetWidth;
        createOverlay();
        handle.classList.add('dragging');
        document.body.classList.add('resizing');
    }

    function updateDragPosition(clientX) {
        if (!isDragging) return;
        const deltaX = clientX - startX;
        const newWidth = direction === 'left'
            ? startWidth + deltaX
            : startWidth - deltaX;
        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        scheduleUpdate(clampedWidth);
    }

    function finishDrag() {
        if (!isDragging) return;
        isDragging = false;
        removeOverlay();
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');

        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (pendingWidth !== null) {
            panel.style.width = `${pendingWidth}px`;
            pendingWidth = null;
        }

        const currentWidth = panel.offsetWidth;
        localStorage.setItem(storageKey, currentWidth.toString());
    }

    function onMouseDown(e) {
        e.preventDefault();
        beginDrag(e.clientX);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        updateDragPosition(e.clientX);
    }

    function onMouseUp() {
        const wasDragging = isDragging;
        finishDrag();
        if (!wasDragging) return;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // タッチデバイス対応
    function onTouchStart(e) {
        const touch = e.touches[0];
        beginDrag(touch.clientX);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        updateDragPosition(touch.clientX);
    }

    function onTouchEnd() {
        const wasDragging = isDragging;
        finishDrag();
        if (!wasDragging) return;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    }

    // イベントリスナー登録
    handle.addEventListener('mousedown', onMouseDown);
    handle.addEventListener('touchstart', onTouchStart, { passive: true });

    // クリーンアップ関数を返す
    return () => {
        handle.removeEventListener('mousedown', onMouseDown);
        handle.removeEventListener('touchstart', onTouchStart);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        if (rafId) cancelAnimationFrame(rafId);
    };
}

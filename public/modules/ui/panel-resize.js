/**
 * Panel Resize Module
 * 左パネル（サイドバー）と右パネル（コンテキストサイドバー）の幅をドラッグで変更可能にする
 */
import { eventBus, EVENTS } from '../core/event-bus.js';

const STORAGE_KEYS = {
    LEFT: 'brainbase:left-panel-width',
    RIGHT: 'brainbase:right-panel-width',
    COMMIT_TREE: 'brainbase:commit-tree-panel-width',
    COMMIT_TREE_COLLAPSED: 'brainbase:commit-tree-panel-collapsed'
};

const DEFAULTS = {
    LEFT: { width: 280, min: 200, max: 400 },
    RIGHT: { width: 350, min: 280, max: 500 },
    COMMIT_TREE: { width: 260, min: 200, max: 400 }
};

/**
 * パネルリサイズを初期化
 */
export function initPanelResize() {
    if (!isDomAvailable()) {
        return () => {};
    }

    const cleanupFns = [];

    // 左パネルのリサイズ
    const leftCleanup = initLeftPanelResize();
    if (leftCleanup) cleanupFns.push(leftCleanup);

    // Note: Commit tree panel and context sidebar are now Info Drawer tabs (no standalone resize needed)

    return () => {
        cleanupFns.forEach(fn => fn());
    };
}

/**
 * 左パネルのリサイズを初期化
 */
function initLeftPanelResize() {
    const handle = document.getElementById('left-panel-resize-handle');
    const panel = document.getElementById('sidebar');

    if (!handle || !panel) {
        console.warn('[PanelResize] Left panel elements not found');
        return null;
    }

    return setupHorizontalResize({
        handle,
        panel,
        storageKey: STORAGE_KEYS.LEFT,
        minWidth: DEFAULTS.LEFT.min,
        maxWidth: DEFAULTS.LEFT.max,
        defaultWidth: DEFAULTS.LEFT.width,
        direction: 'left' // パネルが左側にある
    });
}

// Note: initCommitTreePanelResize, initCommitTreePanelToggle, initRightPanelResize
// have been removed — Commit Tree and Context Sidebar are now Info Drawer tabs.

/**
 * 水平リサイズのセットアップ
 */
function setupHorizontalResize({ handle, panel, storageKey, minWidth, maxWidth, defaultWidth, direction }) {
    if (!isDomAvailable()) {
        return () => {};
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;
    let rafId = null;
    let pendingWidth = null;
    let overlay = null;
    const storage = getSafeStorage();

    // 保存された幅を復元
    const savedWidth = storage?.getItem(storageKey);
    if (savedWidth) {
        const width = parseInt(savedWidth, 10);
        if (!isNaN(width) && width >= minWidth && width <= maxWidth) {
            panel.style.width = `${width}px`;
        }
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

    function beginDrag(startClientX, registerListeners) {
        isDragging = true;
        startX = startClientX;
        startWidth = panel.offsetWidth;

        createOverlay();
        handle.classList.add('dragging');
        document.body.classList.add('resizing');

        if (typeof registerListeners === 'function') {
            registerListeners();
        }
    }

    function handlePointerMove(clientX) {
        if (!isDragging) return;

        const deltaX = clientX - startX;
        const newWidth = direction === 'left'
            ? startWidth + deltaX
            : startWidth - deltaX;

        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        scheduleUpdate(clampedWidth);
    }

    function finalizeDrag(cleanup) {
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
        if (storage) {
            storage.setItem(storageKey, currentWidth.toString());
        }

        if (typeof cleanup === 'function') {
            cleanup();
        }
    }

    function onMouseDown(e) {
        e.preventDefault();
        beginDrag(e.clientX, () => {
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }

    function onMouseMove(e) {
        handlePointerMove(e.clientX);
    }

    function onMouseUp() {
        finalizeDrag(() => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        });
    }

    // タッチデバイス対応
    function onTouchStart(e) {
        const touch = e.touches[0];
        beginDrag(touch.clientX, () => {
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        });
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        e.preventDefault();
        const touch = e.touches[0];
        handlePointerMove(touch.clientX);
    }

    function onTouchEnd() {
        finalizeDrag(() => {
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        });
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

function isDomAvailable() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function getSafeStorage() {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

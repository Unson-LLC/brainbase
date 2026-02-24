/**
 * Panel Resize Module
 * 左パネル（サイドバー）と右パネル（コンテキストサイドバー）の幅をドラッグで変更可能にする
 */

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
    const cleanupFns = [];

    // 左パネルのリサイズ
    const leftCleanup = initLeftPanelResize();
    if (leftCleanup) cleanupFns.push(leftCleanup);

    // コミットツリーパネルのリサイズ
    const commitTreeCleanup = initCommitTreePanelResize();
    if (commitTreeCleanup) cleanupFns.push(commitTreeCleanup);

    // コミットツリーパネルの開閉
    const commitTreeToggleCleanup = initCommitTreePanelToggle();
    if (commitTreeToggleCleanup) cleanupFns.push(commitTreeToggleCleanup);

    // 右パネルのリサイズ
    const rightCleanup = initRightPanelResize();
    if (rightCleanup) cleanupFns.push(rightCleanup);

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

/**
 * コミットツリーパネルのリサイズを初期化
 */
function initCommitTreePanelResize() {
    const handle = document.getElementById('commit-tree-resize-handle');
    const panel = document.getElementById('commit-tree-panel');

    if (!handle || !panel) {
        return null;
    }

    return setupHorizontalResize({
        handle,
        panel,
        storageKey: STORAGE_KEYS.COMMIT_TREE,
        minWidth: DEFAULTS.COMMIT_TREE.min,
        maxWidth: DEFAULTS.COMMIT_TREE.max,
        defaultWidth: DEFAULTS.COMMIT_TREE.width,
        direction: 'right'
    });
}

/**
 * コミットツリーパネル開閉トグルを初期化
 */
function initCommitTreePanelToggle() {
    const panel = document.getElementById('commit-tree-panel');
    const resizeHandle = document.getElementById('commit-tree-resize-handle');
    const collapseBtn = document.getElementById('toggle-commit-tree-panel');
    const expandBtn = document.getElementById('commit-tree-expand-btn');
    const iconEl = collapseBtn?.querySelector('i');

    if (!panel || !resizeHandle || !collapseBtn || !expandBtn) {
        return null;
    }

    const setCollapsed = (collapsed, { persist = true } = {}) => {
        panel.classList.toggle('is-collapsed', collapsed);
        panel.style.display = collapsed ? 'none' : 'flex';
        resizeHandle.classList.toggle('hidden', collapsed);
        expandBtn.classList.toggle('hidden', !collapsed);
        expandBtn.classList.toggle('active', collapsed);

        if (!collapsed) {
            const savedWidth = parseInt(localStorage.getItem(STORAGE_KEYS.COMMIT_TREE) || '', 10);
            const width = Number.isFinite(savedWidth)
                ? Math.max(DEFAULTS.COMMIT_TREE.min, Math.min(DEFAULTS.COMMIT_TREE.max, savedWidth))
                : DEFAULTS.COMMIT_TREE.width;
            panel.style.width = `${width}px`;
        }

        collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        collapseBtn.setAttribute('title', collapsed ? 'コミットパネルを開く' : 'コミットパネルを閉じる');
        collapseBtn.setAttribute('aria-label', collapsed ? 'コミットパネルを開く' : 'コミットパネルを閉じる');

        if (iconEl) {
            iconEl.setAttribute('data-lucide', collapsed ? 'chevron-left' : 'chevron-right');
        }

        if (persist) {
            localStorage.setItem(STORAGE_KEYS.COMMIT_TREE_COLLAPSED, collapsed ? '1' : '0');
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }
    };

    const onCollapseClick = () => {
        const collapsed = panel.style.display === 'none';
        setCollapsed(!collapsed);
    };

    const onExpandClick = () => {
        setCollapsed(false);
    };

    collapseBtn.addEventListener('click', onCollapseClick);
    expandBtn.addEventListener('click', onExpandClick);

    const initialCollapsed = localStorage.getItem(STORAGE_KEYS.COMMIT_TREE_COLLAPSED) === '1';
    setCollapsed(initialCollapsed, { persist: false });

    return () => {
        collapseBtn.removeEventListener('click', onCollapseClick);
        expandBtn.removeEventListener('click', onExpandClick);
    };
}

/**
 * 右パネルのリサイズを初期化
 */
function initRightPanelResize() {
    const handle = document.getElementById('right-panel-resize-handle');
    const panel = document.getElementById('context-sidebar');

    if (!handle || !panel) {
        console.warn('[PanelResize] Right panel elements not found');
        return null;
    }

    return setupHorizontalResize({
        handle,
        panel,
        storageKey: STORAGE_KEYS.RIGHT,
        minWidth: DEFAULTS.RIGHT.min,
        maxWidth: DEFAULTS.RIGHT.max,
        defaultWidth: DEFAULTS.RIGHT.width,
        direction: 'right' // パネルが右側にある
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

    function onMouseDown(e) {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;

        createOverlay();
        handle.classList.add('dragging');
        document.body.classList.add('resizing');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const newWidth = direction === 'left'
            ? startWidth + deltaX
            : startWidth - deltaX;

        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        scheduleUpdate(clampedWidth);
    }

    function onMouseUp() {
        if (!isDragging) return;

        isDragging = false;
        removeOverlay();
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing');

        // 最終値を即時適用
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (pendingWidth !== null) {
            panel.style.width = `${pendingWidth}px`;
            pendingWidth = null;
        }

        // 幅を保存
        const currentWidth = panel.offsetWidth;
        localStorage.setItem(storageKey, currentWidth.toString());

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // タッチデバイス対応
    function onTouchStart(e) {
        const touch = e.touches[0];
        isDragging = true;
        startX = touch.clientX;
        startWidth = panel.offsetWidth;

        createOverlay();
        handle.classList.add('dragging');
        document.body.classList.add('resizing');

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        e.preventDefault();

        const touch = e.touches[0];
        const deltaX = touch.clientX - startX;
        const newWidth = direction === 'left'
            ? startWidth + deltaX
            : startWidth - deltaX;

        const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        scheduleUpdate(clampedWidth);
    }

    function onTouchEnd() {
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

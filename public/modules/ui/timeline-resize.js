/**
 * Timeline Resize Module
 * タイムラインセクションの高さをドラッグで変更可能にする
 */

const STORAGE_KEY = 'brainbase:timeline-height';
const MIN_HEIGHT = 100;
const MAX_HEIGHT_RATIO = 0.7; // sidebarの70%まで

export function initTimelineResize() {
    const handle = document.getElementById('timeline-resize-handle');
    const timelineSection = document.getElementById('timeline-section');
    const sidebar = document.getElementById('context-sidebar');

    if (!handle || !timelineSection || !sidebar) {
        console.warn('[TimelineResize] Required elements not found');
        return () => {};
    }

    let isDragging = false;
    let startY = 0;
    let startHeight = 0;

    // 保存された高さを復元
    const savedHeight = localStorage.getItem(STORAGE_KEY);
    if (savedHeight) {
        const height = parseInt(savedHeight, 10);
        if (!isNaN(height) && height >= MIN_HEIGHT) {
            timelineSection.style.height = `${height}px`;
        }
    }

    function onMouseDown(e) {
        e.preventDefault();
        isDragging = true;
        startY = e.clientY;
        startHeight = timelineSection.offsetHeight;

        handle.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const deltaY = e.clientY - startY;
        const sidebarHeight = sidebar.offsetHeight;
        const maxHeight = sidebarHeight * MAX_HEIGHT_RATIO;

        let newHeight = startHeight + deltaY;
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        timelineSection.style.height = `${newHeight}px`;
    }

    function onMouseUp() {
        if (!isDragging) return;

        isDragging = false;
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // 高さを保存
        const currentHeight = timelineSection.offsetHeight;
        localStorage.setItem(STORAGE_KEY, currentHeight.toString());

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    // タッチデバイス対応
    function onTouchStart(e) {
        const touch = e.touches[0];
        isDragging = true;
        startY = touch.clientY;
        startHeight = timelineSection.offsetHeight;

        handle.classList.add('dragging');

        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onTouchEnd);
    }

    function onTouchMove(e) {
        if (!isDragging) return;
        e.preventDefault();

        const touch = e.touches[0];
        const deltaY = touch.clientY - startY;
        const sidebarHeight = sidebar.offsetHeight;
        const maxHeight = sidebarHeight * MAX_HEIGHT_RATIO;

        let newHeight = startHeight + deltaY;
        newHeight = Math.max(MIN_HEIGHT, Math.min(maxHeight, newHeight));

        timelineSection.style.height = `${newHeight}px`;
    }

    function onTouchEnd() {
        if (!isDragging) return;

        isDragging = false;
        handle.classList.remove('dragging');

        const currentHeight = timelineSection.offsetHeight;
        localStorage.setItem(STORAGE_KEY, currentHeight.toString());

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
    };
}

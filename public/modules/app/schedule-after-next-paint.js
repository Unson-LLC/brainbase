export function scheduleAfterNextPaint(callback) {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                callback();
            });
        });
        return;
    }

    setTimeout(callback, 0);
}

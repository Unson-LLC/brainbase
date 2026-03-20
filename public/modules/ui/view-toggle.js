/**
 * Activity Bar icons are static HTML; just init Lucide.
 */
export function renderPanelToggles(container) {
    if (!container) return () => {};
    if (window?.lucide?.createIcons) {
        window.lucide.createIcons();
    }
    return () => {};
}

// Backward compat alias
export const renderViewToggle = renderPanelToggles;

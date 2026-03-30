import { refreshIcons } from '../ui-helpers.js';
/**
 * Activity Bar icons are static HTML; just init Lucide.
 */
export function renderPanelToggles(container) {
    if (!container) return () => {};
    refreshIcons();
    return () => {};
}

// Backward compat alias
export const renderViewToggle = renderPanelToggles;

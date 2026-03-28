// @ts-check
const VIEWER_ID_STORAGE_KEY = 'brainbase-terminal-viewer-id';

function normalizeConsoleBasePath(proxyPath) {
    if (typeof proxyPath !== 'string') return proxyPath;

    const match = proxyPath.match(/^\/console\/[^/?#]+$/);
    if (match) {
        return `${proxyPath}/`;
    }

    return proxyPath;
}

function generateViewerId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `viewer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getTerminalViewerId() {
    if (typeof window === 'undefined' || !window.sessionStorage) {
        return 'viewer-server';
    }

    let viewerId = window.sessionStorage.getItem(VIEWER_ID_STORAGE_KEY);
    if (!viewerId) {
        viewerId = generateViewerId();
        window.sessionStorage.setItem(VIEWER_ID_STORAGE_KEY, viewerId);
    }
    return viewerId;
}

export function getTerminalViewerLabel() {
    if (typeof window === 'undefined' || !window.location) {
        return 'Unknown / Server';
    }

    const hostname = window.location.hostname || '';
    const originLabel = hostname === 'localhost' || hostname === '127.0.0.1'
        ? 'Local'
        : 'Cloudflare';

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    let deviceLabel = 'Desktop';
    if (/iPhone/i.test(ua)) {
        deviceLabel = 'iPhone';
    } else if (/iPad/i.test(ua)) {
        deviceLabel = 'iPad';
    } else if (/Mac/i.test(ua)) {
        deviceLabel = 'Mac';
    } else if (/Windows/i.test(ua)) {
        deviceLabel = 'Windows';
    } else if (/Android/i.test(ua)) {
        deviceLabel = 'Android';
    }

    return `${originLabel} / ${deviceLabel}`;
}

export function appendViewerIdToProxyPath(proxyPath, viewerId) {
    if (typeof proxyPath !== 'string' || !proxyPath.trim() || !viewerId) {
        return proxyPath;
    }

    const normalizedPath = normalizeConsoleBasePath(proxyPath);
    const separator = normalizedPath.includes('?') ? '&' : '?';
    if (normalizedPath.includes('viewerId=')) {
        return normalizedPath;
    }

    return `${normalizedPath}${separator}viewerId=${encodeURIComponent(viewerId)}`;
}

export function buildSessionRuntimeUrl(sessionId, viewerId, viewerLabel) {
    const params = new URLSearchParams();
    if (viewerId) params.set('viewerId', viewerId);
    if (viewerLabel) params.set('viewerLabel', viewerLabel);
    const query = params.toString();
    return `/api/sessions/${encodeURIComponent(sessionId)}/runtime${query ? `?${query}` : ''}`;
}

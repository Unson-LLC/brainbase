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

// localStorage を優先し、端末単位で viewerId を永続化する。
// sessionStorage はタブ単位で、タブを閉じる/モバイルで OS にアプリを殺されると消える。
// その場合 viewerId が変わり、直前の viewerId が TERMINAL_OWNER_TTL_MS（10分）の間
// terminal ownership を握ったままになるため、同一端末で開き直すと「別の viewer が使用中」
// で自分自身にブロックされる。localStorage はタブを跨いで残るので再オープンで同じ owner に戻る。
function getViewerIdStore() {
    if (typeof window === 'undefined') return null;
    try {
        if (window.localStorage) return window.localStorage;
    } catch {
        // localStorage がブロックされている（プライベートモード等）
    }
    try {
        if (window.sessionStorage) return window.sessionStorage;
    } catch {
        // 何も使えない
    }
    return null;
}

export function getTerminalViewerId() {
    const store = getViewerIdStore();
    if (!store) {
        return 'viewer-server';
    }

    let viewerId = store.getItem(VIEWER_ID_STORAGE_KEY);
    if (!viewerId) {
        viewerId = generateViewerId();
        store.setItem(VIEWER_ID_STORAGE_KEY, viewerId);
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

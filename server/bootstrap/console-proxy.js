import { createProxyMiddleware } from 'http-proxy-middleware';

function renderTerminalBlockedHtml(terminalAccess = {}) {
    const ownerLabel = terminalAccess?.ownerViewerLabel || '別の場所';
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terminal Blocked</title>
  <style>
    body { margin: 0; font-family: Menlo, Monaco, monospace; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
    .card { max-width: 520px; padding: 24px; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 16px; background: rgba(15, 23, 42, 0.96); box-shadow: 0 20px 45px rgba(0, 0, 0, 0.28); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0; line-height: 1.6; color: #cbd5e1; }
    strong { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>この terminal は別の viewer が使用中</h1>
    <p><strong>${ownerLabel}</strong> がこのセッションを表示中。親画面に戻って <strong>Take over</strong> してね。</p>
  </div>
</body>
</html>`;
}

export function getConsoleRequestInfo(req) {
    const rawUrl = req.originalUrl || req.url || '';
    const parsed = new URL(rawUrl, 'http://localhost');
    const match = parsed.pathname.match(/^\/console\/([^/]+)/);
    return {
        sessionId: match ? match[1] : null,
        viewerId: parsed.searchParams.get('viewerId') || null
    };
}

function getConsoleProxySessionId(req) {
    const candidates = [
        req.originalUrl,
        req.baseUrl && req.url ? `${req.baseUrl}${req.url}` : null,
        req.url
    ].filter(Boolean);

    for (const candidate of candidates) {
        const parsed = new URL(candidate, 'http://localhost');
        const fullMatch = parsed.pathname.match(/^\/console\/([^/]+)/);
        if (fullMatch) return fullMatch[1];

        const mountedMatch = parsed.pathname.match(/^\/([^/]+)/);
        if (mountedMatch) return mountedMatch[1];
    }

    return null;
}

export function createConsoleProxy({ sessionServices, isWindows, logger = console }) {
    function enforceTerminalOwnership(req, res, next) {
        const { sessionId, viewerId } = getConsoleRequestInfo(req);
        if (!sessionId) {
            res.status(404).send('Session not found');
            return;
        }

        if (!viewerId) {
            const terminalAccess = sessionServices.ownership.getTerminalAccessState(sessionId, viewerId);
            res.status(409).type('html').send(renderTerminalBlockedHtml(terminalAccess));
            return;
        }

        let terminalAccess = sessionServices.ownership.getTerminalAccessState(sessionId, viewerId);
        if (terminalAccess.state === 'available') {
            sessionServices.ownership.claimTerminalOwnership(sessionId, viewerId);
            terminalAccess = sessionServices.ownership.getTerminalAccessState(sessionId, viewerId);
        }

        if (terminalAccess.state === 'blocked') {
            res.status(409).type('html').send(renderTerminalBlockedHtml(terminalAccess));
            return;
        }

        sessionServices.ownership.touchTerminalOwnership(sessionId, viewerId);
        next();
    }

    const ttydProxy = createProxyMiddleware({
        target: 'http://127.0.0.1:1',
        ws: false,
        changeOrigin: true,
        pathRewrite(path) {
            if (isWindows) {
                const match = path.match(/^\/console\/[^/]+(\/.*)?$/);
                if (match) return match[1] || '/';
                return '/';
            }
            if (path.startsWith('/console')) return path;
            return '/console' + path;
        },
        router(req) {
            const activeSessions = sessionServices.runtime.registry.getActiveSessions();
            const sessionId = getConsoleProxySessionId(req);
            if (sessionId && activeSessions.has(sessionId)) {
                return `http://127.0.0.1:${activeSessions.get(sessionId).port}`;
            }
            const debugUrl = req.originalUrl || req.url;
            logger.error?.(`[Proxy] No session found for ${debugUrl}`);
            return 'http://127.0.0.1:1';
        },
        onProxyReqWs(proxyReq, req) {
            const activeSessions = sessionServices.runtime.registry.getActiveSessions();
            const sessionId = getConsoleProxySessionId(req);
            if (sessionId && activeSessions.has(sessionId)) {
                const port = activeSessions.get(sessionId).port;
                proxyReq.setHeader('Origin', `http://127.0.0.1:${port}`);
            }
        },
        onError(err, req, res) {
            logger.error?.('Proxy Error:', err);
            if (res && res.status) {
                res.status(500).send('Proxy Error');
            }
        }
    });

    function handleConsoleUpgrade(request, socket, head) {
        const { sessionId, viewerId } = getConsoleRequestInfo(request);
        if (!sessionId || !viewerId) {
            socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        let terminalAccess = sessionServices.ownership.getTerminalAccessState(sessionId, viewerId);
        if (terminalAccess?.state === 'available') {
            sessionServices.ownership.claimTerminalOwnership(sessionId, viewerId);
            terminalAccess = sessionServices.ownership.getTerminalAccessState(sessionId, viewerId);
        }

        if (!terminalAccess || terminalAccess.state !== 'owner') {
            socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }

        sessionServices.ownership.touchTerminalOwnership(sessionId, viewerId);
        ttydProxy.upgrade(request, socket, head);
    }

    return {
        enforceTerminalOwnership,
        ttydProxy,
        handleConsoleUpgrade
    };
}

import fs from 'fs/promises';
import path from 'path';
import express from 'express';

function renderApiFallbackPage() {
    return `
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>brainbase Graph API Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #0b1120 0%, #1e293b 100%);
            color: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
            margin: 0;
        }
        .container {
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 24px;
            padding: 48px;
            max-width: 600px;
            text-align: center;
        }
        h1 {
            color: #60a5fa;
            font-size: 32px;
            margin-bottom: 16px;
        }
        p {
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .status {
            background: rgba(34, 197, 94, 0.2);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 12px;
            padding: 16px;
            margin: 24px 0;
            color: #4ade80;
        }
        a {
            color: #60a5fa;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧠 brainbase Graph API Server</h1>
        <div class="status">✓ Server is running</div>
        <p>Device認証を行う場合は <a href="/device">/device</a> にアクセスしてください</p>
        <p>APIヘルスチェック: <a href="/health/ready">/health/ready</a></p>
    </div>
</body>
</html>
    `;
}

function setNoCacheHeaders(res, contentType) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Content-Type', contentType);
}

export function registerStaticRoutes(app, { publicDir, log = console }) {
    app.get('/', async (req, res) => {
        try {
            const filePath = path.join(publicDir, 'index.html');
            const content = await fs.readFile(filePath, 'utf-8');
            setNoCacheHeaders(res, 'text/html; charset=utf-8');
            res.send(content);
        } catch (error) {
            log.error('Error loading index.html:', error);
            res.set('Content-Type', 'text/html; charset=utf-8');
            res.send(renderApiFallbackPage());
        }
    });

    app.get('/app.js', async (req, res) => {
        try {
            const filePath = path.join(publicDir, 'app.js');
            const content = await fs.readFile(filePath, 'utf-8');
            setNoCacheHeaders(res, 'application/javascript; charset=utf-8');
            res.send(content);
        } catch {
            res.status(500).send('Error loading app.js');
        }
    });

    for (const page of ['device', 'setup']) {
        app.get(`/${page}`, async (req, res) => {
            try {
                const filePath = path.join(publicDir, `${page}.html`);
                const content = await fs.readFile(filePath, 'utf-8');
                setNoCacheHeaders(res, 'text/html; charset=utf-8');
                res.send(content);
            } catch (error) {
                log.error(`Error loading ${page}.html:`, error);
                res.status(500).send(`Error loading ${page} page: ${error.message}`);
            }
        });
    }

    app.use(express.static(publicDir, {
        index: false,
        setHeaders: (res, servedPath) => {
            if (servedPath.endsWith('.js') || servedPath.endsWith('.css')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));
}

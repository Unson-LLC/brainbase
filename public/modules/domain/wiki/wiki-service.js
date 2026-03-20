/**
 * Wiki Service (Client)
 * サーバーの /api/wiki エンドポイントに接続
 */

export class WikiService {
    constructor() {
        this._baseUrl = '/api/wiki';
    }

    async getPages() {
        const res = await fetch(`${this._baseUrl}/pages`);
        if (!res.ok) return [];
        return res.json();
    }

    async getPage(path) {
        const res = await fetch(`${this._baseUrl}/page?path=${encodeURIComponent(path)}`);
        if (!res.ok) return null;
        return res.json();
    }

    async savePage(path, content) {
        const res = await fetch(`${this._baseUrl}/page`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path, content })
        });
        if (!res.ok) return null;
        return res.json();
    }

    async deletePage(path) {
        const res = await fetch(`${this._baseUrl}/page?path=${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });
        if (!res.ok) return null;
        return res.json();
    }
}

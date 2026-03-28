/**
 * Wiki Service (Client)
 * サーバーの /api/wiki エンドポイントに接続
 */
import { httpClient } from '../../core/http-client.js';

const AUTH_OPTS = { suppressAuthError: true };

export class WikiService {
    constructor() {
        this._base = '/api/wiki';
    }

    async getPages() {
        try {
            return await httpClient.get(`${this._base}/pages`, AUTH_OPTS);
        } catch {
            return [];
        }
    }

    async getPage(path) {
        try {
            return await httpClient.get(`${this._base}/page?path=${encodeURIComponent(path)}`, AUTH_OPTS);
        } catch {
            return null;
        }
    }

    async savePage(path, content) {
        try {
            return await httpClient.post(`${this._base}/page`, { path, content }, AUTH_OPTS);
        } catch {
            return null;
        }
    }

    async deletePage(path) {
        try {
            return await httpClient.delete(`${this._base}/page?path=${encodeURIComponent(path)}`, AUTH_OPTS);
        } catch {
            return null;
        }
    }
}

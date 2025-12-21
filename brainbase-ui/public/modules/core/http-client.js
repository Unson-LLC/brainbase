/**
 * HTTPクライアント
 * fetch APIをラップしてJSON自動変換とエラーハンドリングを提供
 */
export class HttpClient {
    /**
     * @param {Object} config - 設定オブジェクト
     * @param {string} config.baseURL - ベースURL
     * @param {Object} config.headers - デフォルトヘッダー
     */
    constructor(config = {}) {
        this.baseURL = config.baseURL || '';
        this.defaultHeaders = {
            'Content-Type': 'application/json',
            ...config.headers
        };
    }

    /**
     * HTTPリクエストを実行
     * @param {string} url - エンドポイントURL
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>} レスポンスのJSONデータ
     * @throws {Error} HTTPエラーまたはネットワークエラー
     */
    async request(url, options = {}) {
        const fullURL = `${this.baseURL}${url}`;
        const headers = {
            ...this.defaultHeaders,
            ...options.headers
        };

        try {
            const response = await fetch(fullURL, {
                ...options,
                headers
            });

            if (!response.ok) {
                throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
            }

            return response.json();
        } catch (error) {
            if (error.message.startsWith('HTTP Error:')) {
                throw error;
            }
            throw new Error(`Network Error: ${error.message}`);
        }
    }

    /**
     * GETリクエスト
     * @param {string} url - エンドポイントURL
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>}
     */
    async get(url, options = {}) {
        return this.request(url, {
            ...options,
            method: 'GET'
        });
    }

    /**
     * POSTリクエスト
     * @param {string} url - エンドポイントURL
     * @param {*} data - リクエストボディ（JSON変換される）
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>}
     */
    async post(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    /**
     * PUTリクエスト
     * @param {string} url - エンドポイントURL
     * @param {*} data - リクエストボディ（JSON変換される）
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>}
     */
    async put(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }

    /**
     * DELETEリクエスト
     * @param {string} url - エンドポイントURL
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>}
     */
    async delete(url, options = {}) {
        return this.request(url, {
            ...options,
            method: 'DELETE'
        });
    }
}

/**
 * グローバルHTTPクライアントインスタンス
 */
export const httpClient = new HttpClient();

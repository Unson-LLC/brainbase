/**
 * HTTPクライアント
 * fetch APIをラップしてJSON自動変換とエラーハンドリングを提供
 * CSRF対策：POST/PUT/DELETEリクエストにCSRFトークンを自動付与
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
        this._csrfToken = null;
        this._csrfTokenPromise = null;
    }

    /**
     * CSRFトークンを取得
     * @returns {Promise<string>} CSRFトークン
     */
    async _getCsrfToken() {
        // 既にトークンがあればそれを返す
        if (this._csrfToken) {
            return this._csrfToken;
        }

        // 同時リクエスト対策: 取得中のPromiseがあればそれを待つ
        if (this._csrfTokenPromise) {
            return this._csrfTokenPromise;
        }

        // トークンを取得
        this._csrfTokenPromise = (async () => {
            try {
                const response = await fetch('/api/csrf-token');
                if (response.ok) {
                    const data = await response.json();
                    this._csrfToken = data.token;
                    return this._csrfToken;
                }
            } catch (error) {
                console.warn('[CSRF] Failed to fetch token:', error.message);
            }
            return '';
        })();

        const token = await this._csrfTokenPromise;
        this._csrfTokenPromise = null;
        return token;
    }

    /**
     * CSRFトークンをクリア（トークン更新が必要な場合）
     */
    clearCsrfToken() {
        this._csrfToken = null;
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
        const method = options.method || 'GET';
        const headers = {
            ...this.defaultHeaders,
            ...options.headers
        };

        // CSRFトークンを付与（POST/PUT/DELETEリクエスト）
        if (['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
            const csrfToken = await this._getCsrfToken();
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
        }

        try {
            const response = await fetch(fullURL, {
                ...options,
                headers
            });

            if (!response.ok) {
                // Handle CSRF token expiration: 403 with CSRF error message
                if (response.status === 403) {
                    try {
                        const errorData = await response.clone().json();
                        if (errorData.message && errorData.message.includes('CSRF')) {
                            // Clear token and retry once
                            this.clearCsrfToken();
                            const newToken = await this._getCsrfToken();
                            if (newToken) {
                                headers['X-CSRF-Token'] = newToken;
                                const retryResponse = await fetch(fullURL, { ...options, headers });
                                if (retryResponse.ok) {
                                    return retryResponse.json();
                                }
                            }
                        }
                    } catch (parseError) {
                        // If parsing fails, continue with normal error handling
                    }
                }

                // Try to parse error message from response body
                let errorMessage = `HTTP Error: ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (parseError) {
                    // If JSON parsing fails, use status text
                }
                throw new Error(errorMessage);
            }

            return response.json();
        } catch (error) {
            if (error.message.startsWith('HTTP Error:') || error.message.includes('Failed to')) {
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

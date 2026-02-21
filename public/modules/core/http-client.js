import { createTraceId } from './trace-id.js';

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
        this.baseURL = (config.baseURL || '').replace(/\/+$/, '');
        this.defaultHeaders = {
            'Content-Type': 'application/json',
            ...config.headers
        };
        this._csrfToken = null;
        this._csrfTokenPromise = null;
        this._authToken = config.authToken || null;
        this._onUnauthorized = config.onUnauthorized || null;
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
                const tokenUrl = this.baseURL
                    ? `${this.baseURL}/api/csrf-token`
                    : '/api/csrf-token';
                const response = await fetch(tokenUrl);
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
     * ベースURLを更新
     * @param {string} baseURL - ベースURL
     */
    setBaseURL(baseURL) {
        this.baseURL = typeof baseURL === 'string' ? baseURL.replace(/\/+$/, '') : '';
        this.clearCsrfToken();
    }

    /**
     * CSRFトークンをクリア（トークン更新が必要な場合）
     */
    clearCsrfToken() {
        this._csrfToken = null;
    }

    /**
     * 認証トークンを設定
     * @param {string} token - Bearer token
     */
    setAuthToken(token) {
        this._authToken = token;
    }

    /**
     * 認証トークンをクリア
     */
    clearAuthToken() {
        this._authToken = null;
    }

    /**
     * 401時のハンドラーを設定
     * @param {Function} handler - callback
     */
    setUnauthorizedHandler(handler) {
        this._onUnauthorized = handler;
    }

    _headersToObject(headers) {
        const obj = {};
        if (!headers || typeof headers.forEach !== 'function') return obj;
        headers.forEach((value, key) => {
            obj[String(key).toLowerCase()] = value;
        });
        return obj;
    }

    /**
     * HTTPリクエストを実行
     * @param {string} url - エンドポイントURL
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>} レスポンスのJSONデータ
     * @throws {Error} HTTPエラーまたはネットワークエラー
     */
    async request(url, options = {}) {
        const {
            traceId: providedTraceId,
            allowNotModified = false,
            ...fetchOptions
        } = options;
        const fullURL = `${this.baseURL}${url}`;
        const method = fetchOptions.method || 'GET';
        const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
        const headers = {
            ...this.defaultHeaders,
            ...fetchOptions.headers
        };
        const traceId = providedTraceId || createTraceId('req');

        // FormData送信時はContent-Typeを削除（ブラウザがboundary付きで自動設定）
        if (isFormData) {
            delete headers['Content-Type'];
        }

        if (!headers.Authorization && !headers.authorization && this._authToken) {
            headers.Authorization = `Bearer ${this._authToken}`;
        }
        if (!headers['X-BB-Trace-Id'] && !headers['x-bb-trace-id']) {
            headers['X-BB-Trace-Id'] = traceId;
        }

        // CSRFトークンを付与（POST/PUT/PATCH/DELETEリクエスト）
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) {
            const csrfToken = await this._getCsrfToken();
            if (csrfToken) {
                headers['X-CSRF-Token'] = csrfToken;
            }
        }

        try {
            const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const response = await fetch(fullURL, {
                ...fetchOptions,
                headers
            });
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;

            if (allowNotModified && response.status === 304) {
                return {
                    notModified: true,
                    status: 304,
                    headers: this._headersToObject(response.headers)
                };
            }

            if (!response.ok) {
                if (response.status === 401 && typeof this._onUnauthorized === 'function') {
                    try {
                        this._onUnauthorized();
                    } catch (error) {
                        // ignore handler errors
                    }
                }

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
                                const retryResponse = await fetch(fullURL, { ...fetchOptions, headers });
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

            if (elapsed > 500) {
                console.warn(`[HttpClient] Slow request: ${method} ${url} ${Math.round(elapsed)}ms (trace=${traceId})`);
            }
            if (response.status === 204) {
                return null;
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
        const isFormData = typeof FormData !== 'undefined' && data instanceof FormData;
        return this.request(url, {
            ...options,
            method: 'POST',
            body: isFormData ? data : JSON.stringify(data)
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
     * PATCHリクエスト
     * @param {string} url - エンドポイントURL
     * @param {*} data - リクエストボディ（JSON変換される）
     * @param {Object} options - fetchオプション
     * @returns {Promise<*>}
     */
    async patch(url, data, options = {}) {
        return this.request(url, {
            ...options,
            method: 'PATCH',
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
function resolveDefaultBaseURL() {
    if (typeof window === 'undefined') return '';
    if (Object.prototype.hasOwnProperty.call(window, '__BRAINBASE_API_BASE_URL')) {
        const explicit = window.__BRAINBASE_API_BASE_URL;
        if (typeof explicit === 'string') {
            return explicit.replace(/\/+$/, '');
        }
    }
    // デフォルトは空（same origin）- ローカルでもリモートでも同じサーバーを使用
    return '';
}

export const httpClient = new HttpClient({
    baseURL: resolveDefaultBaseURL()
});

/**
 * MobileInputApiClient
 *
 * brainbase-ui API への通信を担当
 *
 * 責務:
 * - テキスト送信 + Enter
 * - キー送信（Enter, Escape, C-l等）
 * - ターミナル内容取得
 */
export class MobileInputApiClient {
    constructor(httpClient) {
        this.httpClient = httpClient;
    }

    async sendInput(sessionId, payload) {
        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: payload,
            type: 'text'
        });
        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: 'Enter',
            type: 'key'
        });
    }

    async sendKey(sessionId, key) {
        await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
            input: key,
            type: 'key'
        });
    }

    async fetchTerminalContent(sessionId, lines = 500) {
        const res = await fetch(`/api/sessions/${sessionId}/content?lines=${lines}`);
        if (!res.ok) throw new Error('Failed to fetch content');
        const { content } = await res.json();
        return content;
    }
}

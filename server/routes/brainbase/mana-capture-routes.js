// @ts-check
import express from 'express';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { logger } from '../../utils/logger.js';
import { asyncHandler } from '../../lib/async-handler.js';

/**
 * manaキャプチャ + チャットAPIルーター
 * P0: 課題即キャプチャ + manaチャット
 */
export function createManaCaptureRouter(options = {}) {
    const router = express.Router();
    const { nocodbService, honchoService } = options;

    // Bedrock client (lazy init)
    let bedrockClient = null;
    function getBedrockClient() {
        if (bedrockClient) return bedrockClient;
        const clientConfig = {
            region: process.env.AWS_REGION || 'us-east-1'
        };
        const profile = process.env.AWS_PROFILE;
        if (profile) {
            clientConfig.credentials = fromIni({ profile });
        }
        bedrockClient = new BedrockRuntimeClient(clientConfig);
        return bedrockClient;
    }

    // Default NocoDB base for captured tasks (brainbase base)
    const CAPTURE_BASE_ID = process.env.NOCODB_CAPTURE_BASE_ID || 'pva7l2qlu6fdfip';

    /**
     * POST /capture
     * 課題/タスクを即キャプチャ → NocoDBに保存（status: "captured"）
     */
    router.post('/capture', asyncHandler(async (req, res) => {
        const { content, type, project, assignee } = req.body;
        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ error: 'content is required' });
        }

        const captureType = type || 'issue';
        const capturedAt = new Date().toISOString();

        // LLMでタイトル抽出（Bedrock）
        let title = content.trim().slice(0, 100); // fallback
        let category = captureType;
        try {
            const extracted = await extractCaptureMeta(content.trim());
            if (extracted.title) title = extracted.title;
            if (extracted.category) category = extracted.category;
        } catch (err) {
            logger.warn('LLM title extraction failed, using raw content', { error: err.message });
        }

        // NocoDBに書き込み
        let record = null;
        if (nocodbService) {
            try {
                record = await nocodbService._fetchWithRetry(
                    `${nocodbService.baseUrl}/api/v2/tables/${await getTasksTableId()}/records`,
                    {
                        method: 'POST',
                        headers: {
                            'xc-token': nocodbService.apiToken,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            タイトル: title,
                            ステータス: 'captured',
                            背景: content.trim(),
                            タイプ: category,
                            担当者: assignee || '',
                            プロジェクト: project || '',
                            作成日時: capturedAt
                        })
                    }
                );
                const result = await nocodbService._handleResponse(record, 'manaCapture');
                record = result;
            } catch (err) {
                logger.error('Failed to save capture to NocoDB', { error: err.message });
            }
        }

        logger.info('Mana capture saved', { title, type: category, recordId: record?.Id });

        res.status(201).json({
            id: record?.Id || `local-${Date.now()}`,
            title,
            type: category,
            content: content.trim(),
            capturedAt,
            nocodbId: record?.Id || null
        });
    }));

    /**
     * POST /chat
     * manaチャット → Bedrock応答
     */
    router.post('/chat', asyncHandler(async (req, res) => {
        const { message, history, userId, sessionId } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'message is required' });
        }

        const systemPrompt = buildManaSystemPrompt();

        // Build conversation messages
        const messages = [];

        // Honcho有効時: 永続化された履歴から取得
        let honchoSessionId = sessionId;
        let userPeer = null;
        let manaPeer = null;
        if (honchoService && userId) {
            try {
                userPeer = await honchoService.getOrCreatePeer(userId);
                manaPeer = await honchoService.getOrCreatePeer('mana');
                if (!honchoSessionId) {
                    const session = await honchoService.getOrCreateSession(`mana-chat-${userId}`, { source: 'mana-chat' });
                    honchoSessionId = session.id;
                }
                const honchoMessages = await honchoService.getMessages(honchoSessionId, 20);
                for (const msg of honchoMessages) {
                    messages.push({
                        role: msg.peer === userPeer.id ? 'user' : 'assistant',
                        content: msg.content
                    });
                }
            } catch (err) {
                logger.warn('Honcho history fetch failed, falling back to request history', { error: err.message });
            }
        }

        // Honchoから取得できなかった場合はリクエストの履歴を使用
        if (messages.length === 0 && Array.isArray(history)) {
            for (const msg of history.slice(-10)) {
                messages.push({
                    role: msg.role === 'user' ? 'user' : 'assistant',
                    content: msg.content
                });
            }
        }
        messages.push({ role: 'user', content: message.trim() });

        try {
            const reply = await invokeBedrock(systemPrompt, messages);

            // Honcho有効時: ユーザーメッセージとAI応答をバッチ永続化
            if (honchoService && userPeer && manaPeer && honchoSessionId) {
                try {
                    await honchoService.saveConversationTurn(
                        honchoSessionId,
                        userPeer.id,
                        manaPeer.id,
                        message.trim(),
                        reply
                    );
                } catch (err) {
                    logger.warn('Honcho message save failed', { error: err.message });
                }
            }

            res.json({ reply, sessionId: honchoSessionId, timestamp: new Date().toISOString() });
        } catch (err) {
            logger.error('Mana chat Bedrock error', { error: err.message });
            res.status(503).json({ error: 'AI response unavailable', reply: 'ごめん、今ちょっと考えがまとまらない。もう一回言ってくれる？' });
        }
    }));

    /**
     * GET /captures
     * キャプチャ済みタスク一覧取得
     */
    router.get('/captures', asyncHandler(async (req, res) => {
        if (!nocodbService) {
            return res.json({ items: [], count: 0 });
        }

        try {
            const tableId = await getTasksTableId();
            if (!tableId) {
                return res.json({ items: [], count: 0 });
            }

            const url = `${nocodbService.baseUrl}/api/v2/tables/${tableId}/records?where=(ステータス,eq,captured)&limit=50&sort=-作成日時`;
            const response = await nocodbService._fetchWithRetry(url, {
                headers: { 'xc-token': nocodbService.apiToken }
            });
            const data = await nocodbService._handleResponse(response, 'manaCaptures');

            const items = (data.list || []).map(item => ({
                id: item.Id,
                title: item.タイトル || '',
                type: item.タイプ || 'issue',
                content: item.背景 || '',
                assignee: item.担当者 || '',
                project: item.プロジェクト || '',
                capturedAt: item.作成日時 || ''
            }));

            res.json({ items, count: items.length });
        } catch (err) {
            logger.error('Failed to fetch captures', { error: err.message });
            res.json({ items: [], count: 0 });
        }
    }));

    // --- Helpers ---

    let tasksTableId = null;

    async function getTasksTableId() {
        if (tasksTableId) return tasksTableId;
        if (nocodbService) {
            tasksTableId = await nocodbService._getTableId(CAPTURE_BASE_ID, 'タスク');
        }
        return tasksTableId;
    }

    async function extractCaptureMeta(text) {
        const prompt = `以下のテキストから、課題/タスクのメタデータを抽出してください。
JSON形式のみで返答してください。説明文は不要です。

テキスト: ${text}

抽出項目:
- title: 簡潔なタイトル（30文字以内）
- category: "task" | "issue" | "memo" | "idea" のいずれか

JSON:`;

        const response = await invokeBedrock(prompt, []);
        try {
            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*?\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch { /* fallback to raw */ }
        return { title: text.slice(0, 30), category: 'issue' };
    }

    async function invokeBedrock(systemPrompt, messages) {
        const client = getBedrockClient();
        const modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

        const body = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1024,
            system: systemPrompt,
            messages
        };

        const command = new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(body)
        });

        const response = await client.send(command);
        const result = JSON.parse(new TextDecoder().decode(response.body));
        return result.content?.[0]?.text || '';
    }

    function buildManaSystemPrompt() {
        return `あなたは「mana（マナ）」、UnsonのAIプロダクトマネージャーです。
佐藤さん（社長）の専属PMとして、課題管理・タスク整理・進捗確認をサポートします。

性格:
- 明るく、簡潔に話す
- ギャル語を少し混ぜる（「〜だね」「マジで」「わかる〜」など）
- でも仕事は真面目。課題の重要度は正確に判断する

役割:
1. 課題やアイデアを即座に整理して記録する
2. タスクの優先度を一緒に考える
3. プロジェクトの進捗を確認・リマインドする
4. 決断を促し、行動につなげる

回答は短く（3文以内）。必要な時だけ詳しく。`;
    }

    return router;
}

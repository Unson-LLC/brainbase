// @ts-check
import express from 'express';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { logger } from '../../utils/logger.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { createCanonicalTaskPrincipal } from '../../services/companion/canonical-task-principal.js';

/**
 * manaキャプチャ + チャットAPIルーター
 * P0: 課題即キャプチャ + manaチャット
 */
export function createManaCaptureRouter(options = {}) {
    const router = express.Router();
    const {
        honchoService,
        bedrockClient: providedBedrockClient,
        canonicalTaskService,
        sessionGuard
    } = options;

    const requireCaptureSession = (req, res, next) => {
        if (typeof sessionGuard !== 'function') {
            return res.status(503).json({ code: 'mana_session_guard_unavailable', message: 'Mana capture authentication is unavailable' });
        }
        return sessionGuard(req, res, () => {
            if (req.authSource !== 'cookie') {
                return res.status(401).json({ code: 'mana_session_required', message: 'Mana capture requires an authenticated session' });
            }
            const personId = req.access?.personId || req.auth?.person_id || req.auth?.personId || req.auth?.sub;
            if (!personId) {
                return res.status(401).json({ code: 'mana_session_required', message: 'Mana capture session has no person identity' });
            }
            req.manaTaskContext = {
                principal: createCanonicalTaskPrincipal({ authSource: 'session', personId }),
                authSource: 'session',
                access: req.access
            };
            return next();
        });
    };

    router.use(['/capture', '/captures'], requireCaptureSession);

    // Bedrock client (lazy init)
    let bedrockClient = providedBedrockClient || null;
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

    /**
     * POST /capture
     * 課題/タスクを即キャプチャしてCanonical Taskへ保存する。
     */
    router.post('/capture', asyncHandler(async (req, res) => {
        const { capture_id: captureId, content, type, project } = req.body;
        if (!content || typeof content !== 'string' || !content.trim()) {
            return res.status(400).json({ error: 'content is required' });
        }
        if (!captureId || typeof captureId !== 'string' || !captureId.trim()) {
            return res.status(422).json({ code: 'validation_failed', field_errors: { capture_id: ['required'] } });
        }
        if (!canonicalTaskService?.createManaCapture) {
            return res.status(503).json({ code: 'canonical_task_service_unavailable', message: 'Canonical Task service is unavailable' });
        }

        const captureType = type || 'issue';

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

        try {
            const task = await canonicalTaskService.createManaCapture({
                capture_id: captureId.trim(),
                title,
                content: content.trim(),
                type: category,
                project
            }, req.manaTaskContext);
            logger.info('Mana capture materialized as Canonical Task', { title, type: category, taskId: task.id });
            res.status(201).json({
                id: task.id,
                taskId: task.id,
                version: task.version,
                status: task.status,
                title: task.title,
                type: category,
                content: content.trim(),
                capturedAt: task.created_at || null
            });
        } catch (error) {
            logger.error('Failed to materialize Mana capture', { error: error.message });
            res.status(error.status || 503).json({
                code: error.code || 'task_store_unavailable',
                message: error.message || 'Canonical Task store is unavailable',
                ...(error.fieldErrors ? { field_errors: error.fieldErrors } : {})
            });
        }
    }));

    /**
     * POST /chat
     * manaチャット → mana Lambda (Mastra askMana) 経由
     */
    const MANA_LAMBDA_URL = process.env.MANA_LAMBDA_URL || 'https://akdofkjrawesv25ynbgco3yodq0oojfm.lambda-url.us-east-1.on.aws';
    const buildManaLambdaUrl = (pathname) => new URL(pathname, `${MANA_LAMBDA_URL.replace(/\/+$/, '')}/`).toString();

    router.post('/chat', asyncHandler(async (req, res) => {
        const { message, history, userId, sessionId, projectId } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ error: 'message is required' });
        }

        try {
            const response = await fetch(buildManaLambdaUrl('api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message.trim(),
                    userId: userId || req.user?.slackUserId || 'anonymous',
                    projectId: projectId || undefined,
                    senderName: req.user?.displayName || 'brainbase-user',
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                logger.error('Mana Lambda error', { status: response.status, body: errText });
                return res.status(503).json({ error: 'AI response unavailable', reply: 'ごめん、今ちょっと考えがまとまらない。もう一回言ってくれる？' });
            }

            const data = await response.json();
            res.json({ reply: data.reply, timestamp: data.timestamp || new Date().toISOString() });
        } catch (err) {
            logger.error('Mana Lambda call failed', { error: err.message });
            res.status(503).json({ error: 'AI response unavailable', reply: 'ごめん、今ちょっと考えがまとまらない。もう一回言ってくれる？' });
        }
    }));

    /**
     * GET /captures
     * キャプチャ済みタスク一覧取得
     */
    router.get('/captures', asyncHandler(async (req, res) => {
        try {
            if (!canonicalTaskService?.listTasks) throw Object.assign(new Error('Canonical Task service is unavailable'), { status: 503, code: 'canonical_task_service_unavailable' });
            const page = await canonicalTaskService.listTasks({ limit: 50 }, req.manaTaskContext);
            const items = page.items.flatMap((task) => {
                const source = task.source_refs?.find((ref) => ref?.type === 'mana_capture');
                return source ? [{
                    id: task.id,
                    taskId: task.id,
                    version: task.version,
                    status: task.status,
                    title: task.title,
                    type: source.capture_type || 'issue',
                    content: source.content || task.description || '',
                    assigneePersonId: task.assignee_person_id,
                    project: source.project || '',
                    capturedAt: task.created_at || ''
                }] : [];
            });
            res.json({ items, count: items.length });
        } catch (err) {
            logger.error('Failed to fetch captures', { error: err.message });
            res.status(err.status || 503).json({ code: err.code || 'task_store_unavailable', message: err.message || 'Canonical Task store is unavailable' });
        }
    }));

    // --- Helpers ---

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
        const modelId = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-6';

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

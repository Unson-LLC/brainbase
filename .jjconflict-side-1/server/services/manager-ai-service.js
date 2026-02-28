/**
 * ManagerAIService
 *
 * セッションの「対話相手」としてClaude Codeの質問に代理回答。
 * 判断困難な場合はCEOにエスカレーション。
 */

import { logger } from '../utils/logger.js';

export class ManagerAIService {
    /**
     * @param {Object} options
     * @param {string} [options.apiKey] - Anthropic API Key
     * @param {string} [options.model] - モデル名
     * @param {string} [options.autoAnswerLevel] - 'conservative' | 'moderate' | 'aggressive'
     */
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
        this.model = options.model || 'claude-sonnet-4-5-20250929';
        this.defaultAutoAnswerLevel = options.autoAnswerLevel || 'moderate';
    }

    /**
     * 質問を分析し代理回答 or エスカレーション判定
     * @param {string} question - 検知された質問テキスト
     * @param {Object} goal - ゴールオブジェクト
     * @returns {Promise<{canAnswer: boolean, answer?: string, reason?: string, analysis?: string, suggestedOptions?: Array}>}
     */
    async answerQuestion(question, goal) {
        const level = goal.managerConfig?.autoAnswerLevel || this.defaultAutoAnswerLevel;

        // Phase 1: ルールベース自動回答
        const ruleBasedAnswer = this._tryRuleBasedAnswer(question, level);
        if (ruleBasedAnswer) return ruleBasedAnswer;

        // Phase 2: LLM分析
        if (this.apiKey) {
            try {
                return await this._llmAnalyze(question, goal, level);
            } catch (err) {
                logger.error('ManagerAI: LLM analysis failed', { error: err.message });
            }
        }

        // Fallback: エスカレーション
        return {
            canAnswer: false,
            reason: 'LLM分析不可（APIキーなし or エラー）',
            analysis: `質問: ${question}`,
            suggestedOptions: [
                { id: 'yes', label: 'はい', description: '肯定する' },
                { id: 'no', label: 'いいえ', description: '否定する' },
                { id: 'skip', label: 'スキップ', description: 'この質問をスキップ' }
            ]
        };
    }

    /**
     * @private
     */
    _tryRuleBasedAnswer(question, level) {
        // y/n プロンプト
        if (/\(y\/n\)/i.test(question) || /\[y\/n\]/i.test(question) || /\[yes\/no\]/i.test(question)) {
            if (level !== 'conservative') {
                // 破壊的操作はエスカレーション
                if (/delete|remove|destroy|drop|force|reset|overwrite/i.test(question)) {
                    return {
                        canAnswer: false,
                        reason: '破壊的操作の確認はCEO判断が必要',
                        analysis: `危険パターン検知: ${question}`,
                        suggestedOptions: [
                            { id: 'yes', label: 'はい、実行', description: '破壊的操作を許可' },
                            { id: 'no', label: 'いいえ、中止', description: '操作を中止' }
                        ]
                    };
                }
                return { canAnswer: true, answer: 'y' };
            }
        }

        // Press Enter / continue
        if (/press\s+(enter|any key|return)/i.test(question) || /continue\?/i.test(question)) {
            return { canAnswer: true, answer: '' };
        }

        // Tool approval (Claude Code specific)
        if (/allow.*\?\s*\(y\/n\)/i.test(question)) {
            if (level === 'aggressive') {
                return { canAnswer: true, answer: 'y' };
            }
            return {
                canAnswer: false,
                reason: 'ツール許可はCEO判断が必要',
                analysis: question,
                suggestedOptions: [
                    { id: 'allow', label: '許可', description: 'ツールの実行を許可' },
                    { id: 'deny', label: '拒否', description: 'ツールの実行を拒否' }
                ]
            };
        }

        // 選択肢プロンプト
        if (/^\s*\d+[\.\)]\s+/m.test(question)) {
            return {
                canAnswer: false,
                reason: '複数選択肢はCEO判断が必要',
                analysis: question,
                suggestedOptions: this._extractOptions(question)
            };
        }

        return null;
    }

    /**
     * @private
     */
    async _llmAnalyze(question, goal, level) {
        const systemPrompt = `あなたはCEOの代理としてClaude Codeセッションを監視するManager AIです。

ゴール: ${goal.title}
説明: ${goal.description || 'なし'}
完了条件: ${(goal.criteria?.commit || []).join(', ') || 'なし'}
自動回答レベル: ${level}

以下のルールに従って質問に回答してください:
- conservative: 確認系のみ自動回答。それ以外はエスカレーション
- moderate: 技術的判断は自動回答。ビジネス判断はエスカレーション
- aggressive: ほぼ全て自動回答。破壊的操作のみエスカレーション

必ず以下のJSON形式で回答してください:
{"canAnswer": true/false, "answer": "回答テキスト", "reason": "判断理由"}`;

        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: this.model,
                max_tokens: 500,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: `質問: ${question}\n\n代理回答してください。` }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || '';

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                canAnswer: !!parsed.canAnswer,
                answer: parsed.answer || '',
                reason: parsed.reason || '',
                analysis: text
            };
        }

        return {
            canAnswer: false,
            reason: 'LLM回答の解析に失敗',
            analysis: text,
            suggestedOptions: [
                { id: 'yes', label: 'はい', description: '肯定する' },
                { id: 'no', label: 'いいえ', description: '否定する' }
            ]
        };
    }

    /**
     * @private
     */
    _extractOptions(question) {
        const options = [];
        const lines = question.split('\n');

        for (const line of lines) {
            const match = line.match(/^\s*(\d+)[\.\)]\s+(.+)/);
            if (match) {
                options.push({ id: match[1], label: match[2].trim(), description: '' });
            }
        }

        return options.length > 0 ? options : [
            { id: '1', label: '選択肢1', description: '' },
            { id: '2', label: '選択肢2', description: '' }
        ];
    }

    /**
     * ゴールからの逸脱を分析
     */
    async analyzeDeviation(recentOutput, goal) {
        if (!this.apiKey) return { deviated: false, reason: 'LLM分析不可' };
        return { deviated: false, reason: '分析未実装' };
    }

    /**
     * 進捗サマリーを生成
     */
    async generateProgressSummary(recentOutput, goal) {
        if (!this.apiKey) {
            const lineCount = recentOutput.split('\n').filter(l => l.trim()).length;
            return `セッション出力: ${lineCount}行。詳細分析にはAPIキーが必要です。`;
        }
        return 'サマリー生成は次のフェーズで実装予定';
    }
}

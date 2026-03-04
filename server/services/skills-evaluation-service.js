/**
 * Skills評価サービス
 * LLM呼び出しと6次元品質評価を実行
 */
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const SKILLS_DIR = path.join(process.cwd(), '.claude', 'skills');

export class SkillsEvaluationService {
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  /**
   * LLMを呼び出し
   * @param {string} prompt - プロンプト
   * @param {Object} options - オプション
   * @returns {Promise<string>}
   */
  async callLLM(prompt, options = {}) {
    const model = options.model || 'claude-haiku-4-5-20251001';
    const maxTokens = options.maxTokens || 4096;

    try {
      const message = await this.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return message.content[0].text;
    } catch (error) {
      console.error('[SkillsEvaluationService] LLM call failed:', error);
      throw error;
    }
  }

  /**
   * Skill本文を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<string>}
   */
  async getSkillContent(skillName) {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    try {
      return await fs.readFile(skillPath, 'utf-8');
    } catch (error) {
      throw new Error(`Skill not found: ${skillName}`);
    }
  }

  /**
   * 完全性をチェック
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} スコア（0-1）
   */
  async checkCompleteness(skillName) {
    const content = await this.getSkillContent(skillName);

    const prompt = `
Evaluate the completeness of this Skill content.
Check if all essential elements are present:
- Clear purpose/goal
- Required inputs
- Expected outputs
- Usage examples
- Error handling guidance

Skill Content:
${content}

Output JSON:
{
  "score": 0-1 (1 = all essential elements present),
  "missing_elements": ["list of missing elements"],
  "diagnosis": "brief explanation"
}
`;

    try {
      const result = await this.callLLM(prompt);
      const parsed = JSON.parse(result);
      return parsed.score;
    } catch (error) {
      console.error('[SkillsEvaluationService] Completeness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 正確性をチェック
   * @param {string} skillName - Skill名
   * @param {Array} usageHistory - 使用履歴
   * @returns {Promise<number>} スコア（0-1）
   */
  async checkCorrectness(skillName, usageHistory) {
    const content = await this.getSkillContent(skillName);

    // 使用履歴から失敗パターンを抽出
    const failures = usageHistory.filter(h => !h.success);
    const failureRate = failures.length / usageHistory.length;

    // 失敗が多い場合はスコアを下げる
    if (failureRate > 0.5) {
      return 0.3; // 50%以上失敗している場合は正確性が低い
    }

    const prompt = `
Evaluate the correctness of this Skill's instructions.
Check if the instructions are:
- Accurate and up-to-date
- Free from logical errors
- Consistent with best practices

Skill Content:
${content}

Failure Rate: ${(failureRate * 100).toFixed(1)}%

Output JSON:
{
  "score": 0-1 (1 = fully correct),
  "issues": ["list of correctness issues"],
  "diagnosis": "brief explanation"
}
`;

    try {
      const result = await this.callLLM(prompt);
      const parsed = JSON.parse(result);
      return parsed.score;
    } catch (error) {
      console.error('[SkillsEvaluationService] Correctness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 簡潔性をチェック
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} スコア（0-1）
   */
  async checkConciseness(skillName) {
    const content = await this.getSkillContent(skillName);

    const prompt = `
Evaluate the conciseness of this Skill content.
Check for:
- Redundant explanations
- Excessive verbosity
- Unnecessary repetition
- Over-complicated instructions

Skill Content:
${content}

Output JSON:
{
  "score": 0-1 (1 = highly concise),
  "redundancies": ["list of redundant sections"],
  "diagnosis": "brief explanation"
}
`;

    try {
      const result = await this.callLLM(prompt);
      const parsed = JSON.parse(result);
      return parsed.score;
    } catch (error) {
      console.error('[SkillsEvaluationService] Conciseness check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * KERNEL準拠をチェック
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} スコア（0-1）
   */
  async checkKERNEL(skillName) {
    const content = await this.getSkillContent(skillName);

    const prompt = `
Evaluate this Skill against KERNEL 6 principles:
1. Knowledge: Domain knowledge explicitness
2. Explicitness: Instruction clarity
3. Reusability: Generic design
4. Non-redundancy: Duplication elimination
5. Error-resilience: Failure recovery
6. Linguistic Precision: Terminology accuracy

Skill Content:
${content}

Output JSON:
{
  "score": 0-1 (average of 6 dimensions),
  "knowledge": 0-1,
  "explicitness": 0-1,
  "reusability": 0-1,
  "non_redundancy": 0-1,
  "error_resilience": 0-1,
  "linguistic_precision": 0-1,
  "diagnosis": "brief explanation"
}
`;

    try {
      const result = await this.callLLM(prompt);
      const parsed = JSON.parse(result);
      return parsed.score;
    } catch (error) {
      console.error('[SkillsEvaluationService] KERNEL check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }

  /**
   * 一貫性をチェック
   * @param {string} skillName - Skill名
   * @returns {Promise<number>} スコア（0-1）
   */
  async checkConsistency(skillName) {
    const content = await this.getSkillContent(skillName);

    // 他のSkillsと比較（簡易版: 同じディレクトリ内の他Skillsを参照）
    const skillDirs = await fs.readdir(SKILLS_DIR);
    const otherSkills = skillDirs.filter(d => d !== skillName).slice(0, 3); // 最大3つのSkillsと比較

    const otherContents = [];
    for (const other of otherSkills) {
      try {
        const otherContent = await this.getSkillContent(other);
        otherContents.push({ name: other, content: otherContent });
      } catch {
        // スキップ
      }
    }

    const prompt = `
Evaluate the consistency of this Skill with other Skills.
Check if:
- Terminology is consistent
- Format/structure follows common patterns
- Style matches other Skills

Target Skill:
${content}

Other Skills for reference:
${otherContents.map(o => `[${o.name}]\n${o.content.substring(0, 500)}...`).join('\n\n')}

Output JSON:
{
  "score": 0-1 (1 = highly consistent),
  "inconsistencies": ["list of inconsistencies"],
  "diagnosis": "brief explanation"
}
`;

    try {
      const result = await this.callLLM(prompt);
      const parsed = JSON.parse(result);
      return parsed.score;
    } catch (error) {
      console.error('[SkillsEvaluationService] Consistency check failed:', error);
      return 0.5; // デフォルトスコア
    }
  }
}

export const skillsEvaluationService = new SkillsEvaluationService();

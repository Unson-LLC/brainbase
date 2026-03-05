/**
 * Skills使用履歴管理サービス
 * ~/workspace/.claude/skills-usage/ と ~/workspace/.claude/learning/ を管理
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOME = os.homedir();
const SKILLS_USAGE_DIR = path.join(HOME, 'workspace', '.claude', 'skills-usage');
const LEARNING_DIR = path.join(HOME, 'workspace', '.claude', 'learning');
const PROCESSED_SESSIONS_FILE = path.join(LEARNING_DIR, '.processed_sessions');

export class SkillsUsageService {
  /**
   * Skills使用履歴を記録
   * @param {Object} data - 使用履歴データ
   * @returns {Promise<Object>}
   */
  async recordUsage(data) {
    // ディレクトリ存在確認・作成
    await fs.mkdir(SKILLS_USAGE_DIR, { recursive: true });

    // ファイル名: {skillName}_{sessionId}.json
    const filename = `${data.skillName}_${data.sessionId}.json`;
    const filepath = path.join(SKILLS_USAGE_DIR, filename);

    // JSON形式で保存
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(filepath, content, 'utf-8');

    return { success: true, filepath };
  }

  /**
   * 特定Skillの使用履歴を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Array>}
   */
  async getUsageHistory(skillName) {
    try {
      await fs.access(SKILLS_USAGE_DIR);
    } catch {
      return []; // ディレクトリが存在しない場合は空配列
    }

    const files = await fs.readdir(SKILLS_USAGE_DIR);
    const targetFiles = files.filter(f => f.startsWith(`${skillName}_`) && f.endsWith('.json'));

    const history = [];
    for (const file of targetFiles) {
      const filepath = path.join(SKILLS_USAGE_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);
      history.push(data);
    }

    // タイムスタンプでソート（新しい順）
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return history;
  }

  /**
   * 全Skillsの使用履歴を取得
   * @returns {Promise<Array>}
   */
  async getAllUsageHistory() {
    try {
      await fs.access(SKILLS_USAGE_DIR);
    } catch {
      return []; // ディレクトリが存在しない場合は空配列
    }

    const files = await fs.readdir(SKILLS_USAGE_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const history = [];
    for (const file of jsonFiles) {
      const filepath = path.join(SKILLS_USAGE_DIR, file);
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);
      history.push(data);
    }

    // タイムスタンプでソート（新しい順）
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return history;
  }

  /**
   * 処理済みセッション一覧を取得
   * @returns {Promise<Array<string>>}
   */
  async getProcessedSessions() {
    try {
      const content = await fs.readFile(PROCESSED_SESSIONS_FILE, 'utf-8');
      return content.split('\n').filter(line => line.trim() !== '');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * 処理済みセッションをマーク
   * @param {string} sessionId - セッションID
   */
  async markProcessed(sessionId) {
    // ディレクトリ存在確認・作成
    await fs.mkdir(LEARNING_DIR, { recursive: true });

    // 既に処理済みかチェック
    const processedSessions = await this.getProcessedSessions();
    if (processedSessions.includes(sessionId)) {
      return; // 既に処理済み
    }

    // 追記
    await fs.appendFile(PROCESSED_SESSIONS_FILE, `${sessionId}\n`, 'utf-8');
  }

  /**
   * 学習候補を取得
   * @param {string} sessionId - セッションID
   * @returns {Promise<Array>}
   */
  async getLearnings(sessionId) {
    const learningFile = path.join(LEARNING_DIR, `last_result_${sessionId}.txt`);

    try {
      const content = await fs.readFile(learningFile, 'utf-8');

      // JSON部分を抽出（ファイルにはログ出力が含まれている可能性がある）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const data = JSON.parse(jsonMatch[0]);
      return data.learnings || [];
    } catch (error) {
      console.warn(`[SkillsUsageService] Failed to get learnings for ${sessionId}:`, error.message);
      return [];
    }
  }
}

export const skillsUsageService = new SkillsUsageService();

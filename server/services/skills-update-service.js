/**
 * Skills更新・履歴管理サービス
 * SKILL.mdファイルの更新、バックアップ、履歴記録を管理
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const SKILLS_DIR = path.join(process.cwd(), '.claude', 'skills');

export class SkillsUpdateService {
  /**
   * Skillを更新
   * @param {string} skillName - Skill名
   * @param {string} newContent - 新しいコンテンツ
   * @param {Object} metadata - メタデータ
   * @returns {Promise<Object>}
   */
  async updateSkill(skillName, newContent, metadata = {}) {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    const backupDir = path.join(SKILLS_DIR, skillName, '.backup');

    // 現在のコンテンツを取得
    let currentContent = '';
    try {
      currentContent = await fs.readFile(skillPath, 'utf-8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // ファイルが存在しない場合は新規作成
    }

    // バックアップディレクトリ作成
    await fs.mkdir(backupDir, { recursive: true });

    // バックアップファイル名（タイムスタンプ + ハッシュ）
    const timestamp = Date.now();
    const hash = crypto.createHash('md5').update(currentContent).digest('hex').slice(0, 8);
    const backupFilename = `${timestamp}_${hash}.md`;
    const backupPath = path.join(backupDir, backupFilename);

    // バックアップ作成
    if (currentContent) {
      await fs.writeFile(backupPath, currentContent, 'utf-8');
    }

    // 新しいコンテンツを書き込み
    await fs.writeFile(skillPath, newContent, 'utf-8');

    return {
      success: true,
      skillPath,
      backupPath,
      metadata
    };
  }

  /**
   * バックアップ一覧を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Array>}
   */
  async listBackups(skillName) {
    const backupDir = path.join(SKILLS_DIR, skillName, '.backup');

    try {
      const files = await fs.readdir(backupDir);
      const backups = files
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const match = f.match(/^(\d+)_([a-f0-9]+)\.md$/);
          if (!match) return null;

          return {
            filename: f,
            timestamp: parseInt(match[1]),
            hash: match[2],
            path: path.join(backupDir, f)
          };
        })
        .filter(b => b !== null)
        .sort((a, b) => b.timestamp - a.timestamp); // 新しい順

      return backups;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  /**
   * バックアップコンテンツを取得
   * @param {string} skillName - Skill名
   * @param {string} timestamp - タイムスタンプ
   * @returns {Promise<string>}
   */
  async getBackup(skillName, timestamp) {
    const backups = await this.listBackups(skillName);
    const backup = backups.find(b => b.timestamp === parseInt(timestamp));

    if (!backup) {
      throw new Error('Backup not found');
    }

    return await fs.readFile(backup.path, 'utf-8');
  }

  /**
   * 現在のコンテンツを取得
   * @param {string} skillName - Skill名
   * @returns {Promise<string>}
   */
  async getCurrentContent(skillName) {
    const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
    return await fs.readFile(skillPath, 'utf-8');
  }

  /**
   * 履歴を記録
   * @param {Object} entry - 履歴エントリ
   * @returns {Promise<Object>}
   */
  async logHistory(entry) {
    const { skillName } = entry;
    const historyPath = path.join(SKILLS_DIR, skillName, 'optimization-history.json');

    // 既存の履歴を読み込み
    let history = {
      skillName,
      optimizations: [],
      currentScore: 0,
      converged: false,
      lastOptimized: null
    };

    try {
      const content = await fs.readFile(historyPath, 'utf-8');
      history = JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    // 新しいエントリを追加
    if (entry.action === 'ROLLBACK') {
      history.optimizations.push(entry);
    } else {
      history.optimizations.push(entry);
      history.currentScore = entry.scores?.after || history.currentScore;
      history.lastOptimized = entry.timestamp;
    }

    // 保存
    await fs.writeFile(historyPath, JSON.stringify(history, null, 2), 'utf-8');

    return { success: true, historyPath };
  }

  /**
   * 履歴を取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Object>}
   */
  async getHistory(skillName) {
    const historyPath = path.join(SKILLS_DIR, skillName, 'optimization-history.json');

    try {
      const content = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          skillName,
          optimizations: [],
          currentScore: 0,
          converged: false,
          lastOptimized: null
        };
      }
      throw error;
    }
  }

  /**
   * Skill実行をシミュレーション
   * @param {Object} skill - Skill
   * @param {Object} testCase - テストケース
   * @returns {Promise<Object>}
   */
  async simulateExecution(skill, testCase) {
    // 簡易版: テストケースの成功率を返す
    // 実際には、Skillの内容をLLMに渡して実行結果を取得する

    // テストケースに成功フラグがある場合はそれを使用
    if (testCase.success !== undefined) {
      return {
        success: testCase.success,
        score: testCase.success ? 1 : 0
      };
    }

    // デフォルト: ランダムなスコア（0.5-1.0）
    const score = 0.5 + Math.random() * 0.5;
    return {
      success: score > 0.7,
      score
    };
  }
}

export const skillsUpdateService = new SkillsUpdateService();

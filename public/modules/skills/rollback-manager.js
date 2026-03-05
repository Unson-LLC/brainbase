/**
 * ロールバック管理エンジン
 * 問題発生時に以前のバージョンに戻す機能を提供
 */
import { HistoryLogger } from './history-logger.js';
import { SkillUpdater } from './skill-updater.js';

export class RollbackManager {
  constructor() {
    this.historyLogger = new HistoryLogger();
    this.skillUpdater = new SkillUpdater();
  }

  /**
   * ロールバック
   * @param {string} skillName - Skill名
   * @param {string} targetTimestamp - ロールバック先のタイムスタンプ
   * @returns {Promise<Object>} ロールバック結果
   */
  async rollback(skillName, targetTimestamp) {
    try {
      console.log(`[RollbackManager] Rolling back ${skillName} to ${targetTimestamp}...`);

      // 履歴を取得
      const history = await this.historyLogger.load(skillName);

      // 対象バージョンを検索
      const targetVersion = history.optimizations.find(
        opt => opt.timestamp === targetTimestamp
      );

      if (!targetVersion) {
        throw new Error('Target version not found');
      }

      // バックアップから取得
      const backupContent = await this.skillUpdater.getBackup(skillName, targetTimestamp);

      if (!backupContent) {
        throw new Error('Backup content not found');
      }

      // 現在のコンテンツを取得（ロールバック前のバックアップとして保存）
      const currentContent = await this.skillUpdater.getCurrentContent(skillName);

      // ロールバック実行（現在のコンテンツをバックアップに保存してから更新）
      const result = await this.skillUpdater.update(skillName, backupContent, {
        action: 'rollback',
        from: new Date().toISOString(),
        to: targetTimestamp,
        reason: 'Manual rollback'
      });

      // 履歴に記録
      await this.historyLogger.log({
        skillName,
        timestamp: new Date().toISOString(),
        action: 'ROLLBACK',
        targetTimestamp,
        targetIteration: targetVersion.iteration,
        metadata: {
          previousScore: history.currentScore,
          targetScore: targetVersion.scores.after
        }
      });

      console.log(`[RollbackManager] Rollback completed: ${result.backupPath}`);

      return {
        success: true,
        targetVersion,
        backupPath: result.backupPath
      };
    } catch (error) {
      console.error('[RollbackManager] Rollback failed:', error);
      throw error;
    }
  }

  /**
   * イテレーション番号でロールバック
   * @param {string} skillName - Skill名
   * @param {number} targetIteration - 対象イテレーション
   * @returns {Promise<Object>}
   */
  async rollbackToIteration(skillName, targetIteration) {
    const history = await this.historyLogger.load(skillName);

    const targetVersion = history.optimizations.find(
      opt => opt.iteration === targetIteration
    );

    if (!targetVersion) {
      throw new Error(`Iteration ${targetIteration} not found`);
    }

    return this.rollback(skillName, targetVersion.timestamp);
  }

  /**
   * 最良バージョンにロールバック
   * @param {string} skillName - Skill名
   * @returns {Promise<Object>}
   */
  async rollbackToBest(skillName) {
    const history = await this.historyLogger.load(skillName);
    const summary = this.historyLogger.generateSummary(history);

    if (!summary.bestIteration) {
      throw new Error('No best iteration found');
    }

    const bestVersion = summary.bestIteration.data;
    return this.rollback(skillName, bestVersion.timestamp);
  }

  /**
   * 直前のバージョンにロールバック
   * @param {string} skillName - Skill名
   * @returns {Promise<Object>}
   */
  async rollbackToPrevious(skillName) {
    const history = await this.historyLogger.load(skillName);

    if (!history.optimizations || history.optimizations.length < 2) {
      throw new Error('No previous version found');
    }

    const previousVersion = history.optimizations[history.optimizations.length - 2];
    return this.rollback(skillName, previousVersion.timestamp);
  }

  /**
   * ロールバック可能なバージョンを一覧表示
   * @param {string} skillName - Skill名
   * @returns {Promise<Array>}
   */
  async listRollbackTargets(skillName) {
    const history = await this.historyLogger.load(skillName);

    if (!history.optimizations || history.optimizations.length === 0) {
      return [];
    }

    return history.optimizations.map(opt => ({
      iteration: opt.iteration,
      timestamp: opt.timestamp,
      score: opt.scores.after,
      improvement: opt.scores.improvement,
      changes: opt.changes?.length || 0
    }));
  }

  /**
   * ロールバックプレビュー（実際にロールバックせずに差分を表示）
   * @param {string} skillName - Skill名
   * @param {string} targetTimestamp - ロールバック先のタイムスタンプ
   * @returns {Promise<Object>}
   */
  async previewRollback(skillName, targetTimestamp) {
    try {
      // 現在のコンテンツ
      const currentContent = await this.skillUpdater.getCurrentContent(skillName);

      // ロールバック先のコンテンツ
      const targetContent = await this.skillUpdater.getBackup(skillName, targetTimestamp);

      if (!targetContent) {
        throw new Error('Target backup not found');
      }

      // 差分計算
      const diff = this.skillUpdater.calculateDiff(currentContent, targetContent);

      // 履歴情報
      const history = await this.historyLogger.load(skillName);
      const targetVersion = history.optimizations.find(
        opt => opt.timestamp === targetTimestamp
      );

      return {
        skillName,
        targetTimestamp,
        targetIteration: targetVersion?.iteration,
        targetScore: targetVersion?.scores.after,
        currentScore: history.currentScore,
        diff
      };
    } catch (error) {
      console.error('[RollbackManager] Preview failed:', error);
      throw error;
    }
  }

  /**
   * ロールバックレポートを生成
   * @param {Object} preview - プレビュー結果
   * @returns {string}
   */
  formatRollbackReport(preview) {
    return `
# Rollback Preview: ${preview.skillName}

## Target Version
- Iteration: ${preview.targetIteration}
- Timestamp: ${preview.targetTimestamp}
- Score: ${(preview.targetScore * 100).toFixed(1)}%

## Current Version
- Score: ${(preview.currentScore * 100).toFixed(1)}%

## Impact
- Score Change: ${((preview.targetScore - preview.currentScore) * 100).toFixed(1)}%
- Lines Changed: ${preview.diff.summary.totalChanges}
  - Added: ${preview.diff.summary.linesAdded}
  - Removed: ${preview.diff.summary.linesRemoved}
  - Modified: ${preview.diff.summary.linesModified}

## Recommendation
${this._getRollbackRecommendation(preview)}

---

${this.skillUpdater.formatDiff(preview.diff)}
`;
  }

  /**
   * ロールバック推奨を取得
   * @param {Object} preview - プレビュー結果
   * @returns {string}
   * @private
   */
  _getRollbackRecommendation(preview) {
    const scoreDelta = preview.targetScore - preview.currentScore;

    if (scoreDelta > 0.05) {
      return `✅ **Recommended**: Target version has significantly better score (+${(scoreDelta * 100).toFixed(1)}%)`;
    } else if (scoreDelta > 0) {
      return `⚠️ **Consider**: Target version has slightly better score (+${(scoreDelta * 100).toFixed(1)}%)`;
    } else if (scoreDelta === 0) {
      return `ℹ️ **Neutral**: Target version has the same score`;
    } else {
      return `❌ **Not Recommended**: Target version has worse score (${(scoreDelta * 100).toFixed(1)}%)`;
    }
  }
}

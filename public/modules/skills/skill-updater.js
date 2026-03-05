/**
 * Skill更新エンジン
 * SKILL.mdファイルを更新し、バックアップを作成
 */
export class SkillUpdater {
  /**
   * Skillを更新
   * @param {string} skillName - Skill名
   * @param {string} newContent - 新しいコンテンツ
   * @param {Object} metadata - メタデータ
   * @returns {Promise<Object>} 更新結果
   */
  async update(skillName, newContent, metadata = {}) {
    try {
      const response = await fetch('/api/skills/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName, newContent, metadata })
      });

      if (!response.ok) {
        throw new Error(`Update failed: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`[SkillUpdater] Updated ${skillName}: ${result.backupPath}`);

      return result;
    } catch (error) {
      console.error('[SkillUpdater] Failed to update skill:', error);
      throw error;
    }
  }

  /**
   * 更新前のバックアップを取得
   * @param {string} skillName - Skill名
   * @returns {Promise<Array>} バックアップリスト
   */
  async listBackups(skillName) {
    try {
      const response = await fetch(`/api/skills/backups/${skillName}`);

      if (!response.ok) {
        throw new Error(`Failed to list backups: ${response.statusText}`);
      }

      const data = await response.json();
      return data.backups || [];
    } catch (error) {
      console.error('[SkillUpdater] Failed to list backups:', error);
      return [];
    }
  }

  /**
   * バックアップからコンテンツを取得
   * @param {string} skillName - Skill名
   * @param {string} backupTimestamp - バックアップのタイムスタンプ
   * @returns {Promise<string>} バックアップコンテンツ
   */
  async getBackup(skillName, backupTimestamp) {
    try {
      const response = await fetch(`/api/skills/backups/${skillName}/${backupTimestamp}`);

      if (!response.ok) {
        throw new Error(`Failed to get backup: ${response.statusText}`);
      }

      const data = await response.json();
      return data.content;
    } catch (error) {
      console.error('[SkillUpdater] Failed to get backup:', error);
      throw error;
    }
  }

  /**
   * 現在のコンテンツを取得
   * @param {string} skillName - Skill名
   * @returns {Promise<string>}
   */
  async getCurrentContent(skillName) {
    try {
      const response = await fetch(`/api/skills/content/${skillName}`);

      if (!response.ok) {
        throw new Error(`Failed to get content: ${response.statusText}`);
      }

      const data = await response.json();
      return data.content;
    } catch (error) {
      console.error('[SkillUpdater] Failed to get current content:', error);
      throw error;
    }
  }

  /**
   * 変更差分を計算
   * @param {string} oldContent - 旧コンテンツ
   * @param {string} newContent - 新コンテンツ
   * @returns {Object} 差分情報
   */
  calculateDiff(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const added = [];
    const removed = [];
    const modified = [];

    const maxLength = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLength; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined) {
        added.push({ line: i + 1, content: newLine });
      } else if (newLine === undefined) {
        removed.push({ line: i + 1, content: oldLine });
      } else if (oldLine !== newLine) {
        modified.push({ line: i + 1, old: oldLine, new: newLine });
      }
    }

    return {
      added,
      removed,
      modified,
      summary: {
        linesAdded: added.length,
        linesRemoved: removed.length,
        linesModified: modified.length,
        totalChanges: added.length + removed.length + modified.length
      }
    };
  }

  /**
   * 差分をフォーマット（人間可読形式）
   * @param {Object} diff - 差分情報
   * @returns {string}
   */
  formatDiff(diff) {
    let output = `## Changes Summary\n\n`;
    output += `- Lines Added: ${diff.summary.linesAdded}\n`;
    output += `- Lines Removed: ${diff.summary.linesRemoved}\n`;
    output += `- Lines Modified: ${diff.summary.linesModified}\n`;
    output += `- Total Changes: ${diff.summary.totalChanges}\n\n`;

    if (diff.added.length > 0) {
      output += `### Added Lines\n\n`;
      diff.added.forEach(a => {
        output += `Line ${a.line}: + ${a.content}\n`;
      });
      output += `\n`;
    }

    if (diff.removed.length > 0) {
      output += `### Removed Lines\n\n`;
      diff.removed.forEach(r => {
        output += `Line ${r.line}: - ${r.content}\n`;
      });
      output += `\n`;
    }

    if (diff.modified.length > 0) {
      output += `### Modified Lines\n\n`;
      diff.modified.forEach(m => {
        output += `Line ${m.line}:\n`;
        output += `  - ${m.old}\n`;
        output += `  + ${m.new}\n`;
      });
    }

    return output;
  }
}

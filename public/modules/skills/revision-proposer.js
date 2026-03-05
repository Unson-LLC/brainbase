/**
 * 修正案提示エンジン
 * 改善候補を構造化された修正案として提示
 */
export class RevisionProposer {
  /**
   * 修正案を提示
   * @param {Object} candidate - 改善候補
   * @param {string} skillName - Skill名
   * @param {Object} metadata - メタデータ
   * @returns {Object} 修正案
   */
  propose(candidate, skillName, metadata = {}) {
    return {
      skillName,
      timestamp: new Date().toISOString(),
      revision: {
        content: candidate.generalized_content || candidate.revised_content,
        changes: this._extractChanges(candidate),
        reasoning: this._extractReasoning(candidate),
        metadata: {
          ...metadata,
          generalizationLevel: this._calculateGeneralizationLevel(candidate),
          complexity: this._calculateComplexity(candidate)
        }
      },
      risk: this._assessRisk(candidate),
      impact: this._assessImpact(candidate)
    };
  }

  /**
   * 変更内容を抽出
   * @param {Object} candidate - 改善候補
   * @returns {Array} 変更リスト
   * @private
   */
  _extractChanges(candidate) {
    const changes = [];

    // naive段階の変更
    if (candidate.changes) {
      changes.push(...candidate.changes);
    }

    // triangulated段階の追加変更
    if (candidate.additionalChanges) {
      changes.push(...candidate.additionalChanges);
    }

    // generalized段階の汎用化
    if (candidate.generalizations) {
      changes.push(...candidate.generalizations);
    }

    return changes;
  }

  /**
   * 理由を抽出
   * @param {Object} candidate - 改善候補
   * @returns {string} 理由
   * @private
   */
  _extractReasoning(candidate) {
    const reasonings = [];

    if (candidate.reasoning) {
      reasonings.push(candidate.reasoning);
    }

    if (candidate.refinementReasoning) {
      reasonings.push(`Refinement: ${candidate.refinementReasoning}`);
    }

    if (candidate.generalizationReasoning) {
      reasonings.push(`Generalization: ${candidate.generalizationReasoning}`);
    }

    return reasonings.join('\n\n');
  }

  /**
   * 汎用化レベルを計算
   * @param {Object} candidate - 改善候補
   * @returns {string} レベル（low/medium/high）
   * @private
   */
  _calculateGeneralizationLevel(candidate) {
    if (candidate.generalizations && candidate.generalizations.length > 0) {
      return candidate.generalizations.length > 3 ? 'high' : 'medium';
    }
    return 'low';
  }

  /**
   * 複雑度を計算
   * @param {Object} candidate - 改善候補
   * @returns {string} 複雑度（low/medium/high）
   * @private
   */
  _calculateComplexity(candidate) {
    const content = candidate.generalized_content || candidate.revised_content || '';
    const lines = content.split('\n').length;

    if (lines > 500) return 'high';
    if (lines > 200) return 'medium';
    return 'low';
  }

  /**
   * リスクを評価
   * @param {Object} candidate - 改善候補
   * @returns {Object} リスク評価
   * @private
   */
  _assessRisk(candidate) {
    const changes = this._extractChanges(candidate);
    const changeCount = changes.length;

    // 変更量によるリスク判定
    let riskLevel = 'low';
    if (changeCount > 50) {
      riskLevel = 'high';
    } else if (changeCount > 10) {
      riskLevel = 'medium';
    }

    // 変更タイプによるリスク判定
    const hasArchitectureChange = changes.some(c =>
      c.toLowerCase().includes('architecture') ||
      c.toLowerCase().includes('subagent') ||
      c.toLowerCase().includes('phase')
    );

    if (hasArchitectureChange) {
      riskLevel = riskLevel === 'high' ? 'critical' : 'high';
    }

    return {
      level: riskLevel,
      changeCount,
      hasArchitectureChange,
      reasoning: this._getRiskReasoning(riskLevel, changeCount, hasArchitectureChange)
    };
  }

  /**
   * リスク理由を取得
   * @param {string} level - リスクレベル
   * @param {number} changeCount - 変更数
   * @param {boolean} hasArchitectureChange - アーキテクチャ変更の有無
   * @returns {string}
   * @private
   */
  _getRiskReasoning(level, changeCount, hasArchitectureChange) {
    const reasons = [];

    if (changeCount > 50) {
      reasons.push('Large number of changes (>50)');
    } else if (changeCount > 10) {
      reasons.push('Moderate number of changes (10-50)');
    }

    if (hasArchitectureChange) {
      reasons.push('Includes architecture/structure changes');
    }

    return reasons.join('; ');
  }

  /**
   * 影響を評価
   * @param {Object} candidate - 改善候補
   * @returns {Object} 影響評価
   * @private
   */
  _assessImpact(candidate) {
    const changes = this._extractChanges(candidate);

    // 影響範囲の分類
    const impactAreas = {
      instructions: changes.some(c => c.toLowerCase().includes('instruction')),
      examples: changes.some(c => c.toLowerCase().includes('example')),
      structure: changes.some(c => c.toLowerCase().includes('section') || c.toLowerCase().includes('format')),
      logic: changes.some(c => c.toLowerCase().includes('logic') || c.toLowerCase().includes('flow')),
      subagents: changes.some(c => c.toLowerCase().includes('subagent') || c.toLowerCase().includes('agent'))
    };

    const affectedAreas = Object.entries(impactAreas)
      .filter(([_, affected]) => affected)
      .map(([area, _]) => area);

    return {
      affectedAreas,
      scope: affectedAreas.length > 3 ? 'wide' : affectedAreas.length > 1 ? 'medium' : 'narrow',
      reasoning: `Affects: ${affectedAreas.join(', ')}`
    };
  }

  /**
   * 修正案をフォーマット（人間可読形式）
   * @param {Object} proposal - 修正案
   * @returns {string}
   */
  formatForHuman(proposal) {
    return `
# Skill Revision Proposal: ${proposal.skillName}

**Generated**: ${proposal.timestamp}

## Changes
${proposal.revision.changes.map((c, i) => `${i + 1}. ${c}`).join('\n')}

## Reasoning
${proposal.revision.reasoning}

## Risk Assessment
- **Level**: ${proposal.risk.level}
- **Change Count**: ${proposal.risk.changeCount}
- **Architecture Change**: ${proposal.risk.hasArchitectureChange ? 'Yes' : 'No'}
- **Reasoning**: ${proposal.risk.reasoning}

## Impact Assessment
- **Scope**: ${proposal.impact.scope}
- **Affected Areas**: ${proposal.impact.affectedAreas.join(', ')}
- **Reasoning**: ${proposal.impact.reasoning}

## Metadata
- **Generalization Level**: ${proposal.revision.metadata.generalizationLevel}
- **Complexity**: ${proposal.revision.metadata.complexity}

## Revised Content
\`\`\`
${proposal.revision.content}
\`\`\`
`;
  }
}

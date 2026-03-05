/**
 * KERNEL準拠確保エンジン
 * 改善候補がKERNEL 6原則に準拠しているかチェックし、修正する
 */
export class KERNELAligner {
  constructor({ kernelPrinciples }) {
    this.kernelPrinciples = kernelPrinciples;
    this.COMPLIANCE_THRESHOLD = 0.9; // 90%以上のスコアで合格
  }

  /**
   * KERNEL準拠に整列
   * @param {Object} candidate - 改善候補
   * @returns {Promise<Object>} 整列後の候補
   */
  async align(candidate) {
    const content = candidate.generalized_content || candidate.revised_content;

    // 準拠チェック
    const complianceCheck = await this._checkCompliance(content);

    if (complianceCheck.score >= this.COMPLIANCE_THRESHOLD) {
      console.log('[KERNELAligner] Candidate already compliant');
      return candidate; // 既に準拠している
    }

    console.log(`[KERNELAligner] Compliance score: ${complianceCheck.score.toFixed(2)}, fixing...`);

    // 準拠修正
    const alignedCandidate = await this._fixCompliance(candidate, complianceCheck);

    return alignedCandidate;
  }

  /**
   * KERNEL準拠をチェック
   * @param {string} content - Skill本文
   * @returns {Promise<Object>} 準拠チェック結果
   * @private
   */
  async _checkCompliance(content) {
    const prompt = `
Evaluate Skill content against KERNEL 6 principles:
1. Knowledge: Domain knowledge explicitness
2. Explicitness: Instruction clarity
3. Reusability: Generic design
4. Non-redundancy: Duplication elimination
5. Error-resilience: Failure recovery
6. Linguistic Precision: Terminology accuracy

Skill Content:
${content}

KERNEL Principles:
${JSON.stringify(this.kernelPrinciples, null, 2)}

Output JSON:
{
  "knowledge": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "explicitness": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "reusability": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "non_redundancy": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "error_resilience": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "linguistic_precision": { "score": 0-1, "diagnosis": "...", "issues": ["..."] },
  "score": 0-1 (average of 6 dimensions)
}
`;

    try {
      const response = await fetch('/api/skills/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        throw new Error(`LLM API failed: ${response.statusText}`);
      }

      const data = await response.json();
      return JSON.parse(data.result);
    } catch (error) {
      console.error('[KERNELAligner] Failed to check compliance:', error);
      // デフォルト値
      return {
        score: 0.5,
        knowledge: { score: 0.5, diagnosis: 'Not evaluated', issues: [] },
        explicitness: { score: 0.5, diagnosis: 'Not evaluated', issues: [] },
        reusability: { score: 0.5, diagnosis: 'Not evaluated', issues: [] },
        non_redundancy: { score: 0.5, diagnosis: 'Not evaluated', issues: [] },
        error_resilience: { score: 0.5, diagnosis: 'Not evaluated', issues: [] },
        linguistic_precision: { score: 0.5, diagnosis: 'Not evaluated', issues: [] }
      };
    }
  }

  /**
   * KERNEL準拠を修正
   * @param {Object} candidate - 候補
   * @param {Object} complianceCheck - 準拠チェック結果
   * @returns {Promise<Object>}
   * @private
   */
  async _fixCompliance(candidate, complianceCheck) {
    const content = candidate.generalized_content || candidate.revised_content;

    const prompt = `
Fix KERNEL compliance issues in the candidate Skill content.

Current Candidate:
${content}

Compliance Issues:
${JSON.stringify(complianceCheck, null, 2)}

For each dimension with score < 0.9, apply fixes to improve compliance.

Output JSON:
{
  "aligned_content": "KERNEL-compliant Skill content",
  "fixes": ["list of fixes applied"],
  "reasoning": "how these fixes improve compliance",
  "improved_scores": {
    "knowledge": 0-1,
    "explicitness": 0-1,
    "reusability": 0-1,
    "non_redundancy": 0-1,
    "error_resilience": 0-1,
    "linguistic_precision": 0-1
  }
}
`;

    try {
      const response = await fetch('/api/skills/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        throw new Error(`LLM API failed: ${response.statusText}`);
      }

      const data = await response.json();
      const result = JSON.parse(data.result);

      // 候補を更新
      return {
        ...candidate,
        aligned_content: result.aligned_content,
        kernel_fixes: result.fixes,
        kernel_reasoning: result.reasoning,
        kernel_scores: result.improved_scores
      };
    } catch (error) {
      console.error('[KERNELAligner] Failed to fix compliance:', error);
      return candidate; // フォールバック: 元の候補を返す
    }
  }

  /**
   * 各次元のスコアを取得
   * @param {Object} complianceCheck - 準拠チェック結果
   * @returns {Object} 次元別スコア
   */
  getDimensionScores(complianceCheck) {
    return {
      knowledge: complianceCheck.knowledge?.score || 0,
      explicitness: complianceCheck.explicitness?.score || 0,
      reusability: complianceCheck.reusability?.score || 0,
      non_redundancy: complianceCheck.non_redundancy?.score || 0,
      error_resilience: complianceCheck.error_resilience?.score || 0,
      linguistic_precision: complianceCheck.linguistic_precision?.score || 0
    };
  }

  /**
   * 最も弱い次元を取得
   * @param {Object} complianceCheck - 準拠チェック結果
   * @returns {Object} 最弱次元
   */
  getWeakestDimension(complianceCheck) {
    const scores = this.getDimensionScores(complianceCheck);
    const entries = Object.entries(scores);
    const weakest = entries.reduce((min, [key, value]) =>
      value < min.value ? { key, value } : min,
      { key: entries[0][0], value: entries[0][1] }
    );

    return {
      dimension: weakest.key,
      score: weakest.value,
      diagnosis: complianceCheck[weakest.key]?.diagnosis || 'No diagnosis',
      issues: complianceCheck[weakest.key]?.issues || []
    };
  }

  /**
   * 準拠レポートを生成
   * @param {Object} complianceCheck - 準拠チェック結果
   * @returns {string}
   */
  generateComplianceReport(complianceCheck) {
    const scores = this.getDimensionScores(complianceCheck);
    const weakest = this.getWeakestDimension(complianceCheck);

    return `
## KERNEL Compliance Report

**Overall Score**: ${(complianceCheck.score * 100).toFixed(1)}% ${complianceCheck.score >= this.COMPLIANCE_THRESHOLD ? '✅' : '❌'}

### Dimension Scores
- **Knowledge**: ${(scores.knowledge * 100).toFixed(1)}%
- **Explicitness**: ${(scores.explicitness * 100).toFixed(1)}%
- **Reusability**: ${(scores.reusability * 100).toFixed(1)}%
- **Non-redundancy**: ${(scores.non_redundancy * 100).toFixed(1)}%
- **Error-resilience**: ${(scores.error_resilience * 100).toFixed(1)}%
- **Linguistic Precision**: ${(scores.linguistic_precision * 100).toFixed(1)}%

### Weakest Dimension
**${weakest.dimension}** (${(weakest.score * 100).toFixed(1)}%)
- Diagnosis: ${weakest.diagnosis}
- Issues: ${weakest.issues.length > 0 ? weakest.issues.join(', ') : 'None'}
`;
  }
}

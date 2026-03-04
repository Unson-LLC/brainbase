/**
 * テキスト勾配計算エンジン
 * Skill本文と期待値の差分を3種類（structural/semantic/KERNEL）で計算
 */
export class GradientCalculator {
  constructor({ kernelPrinciples }) {
    this.kernelPrinciples = kernelPrinciples;
  }

  /**
   * テキスト勾配を計算
   * @param {string} skillContent - Skill本文
   * @param {string} expectedOutcome - 期待される結果
   * @param {string} actualOutcome - 実際の結果
   * @returns {Promise<Object>} テキスト勾配
   */
  async calculateGradient(skillContent, expectedOutcome, actualOutcome) {
    // 1. Structural Diff（構造差分）
    const structuralDiff = await this._computeStructuralDiff(
      skillContent,
      expectedOutcome,
      actualOutcome
    );

    // 2. Semantic Diff（意味差分）
    const semanticDiff = await this._computeSemanticDiff(
      skillContent,
      expectedOutcome,
      actualOutcome
    );

    // 3. KERNEL Compliance（6原則準拠）
    const kernelCompliance = await this._checkKERNELCompliance(
      skillContent,
      this.kernelPrinciples
    );

    // 総合スコア計算
    const overallScore = this._aggregateScore({
      structural: structuralDiff.score,
      semantic: semanticDiff.score,
      kernel: kernelCompliance.score
    });

    return {
      structural: structuralDiff,
      semantic: semanticDiff,
      kernel: kernelCompliance,
      overallScore
    };
  }

  /**
   * 構造差分を計算
   * @param {string} content - Skill本文
   * @param {string} expected - 期待される結果
   * @param {string} actual - 実際の結果
   * @returns {Promise<Object>}
   * @private
   */
  async _computeStructuralDiff(content, expected, actual) {
    const prompt = `
Compare the expected outcome with the actual outcome of a Skill execution.
Identify structural differences:
- Missing elements (sections, code samples, examples)
- Incorrect elements (wrong patterns, outdated code)
- Excessive elements (redundant explanations, duplicate code)

Skill Content:
${content}

Expected Outcome:
${expected}

Actual Outcome:
${actual}

Output JSON:
{
  "missing": ["list of missing elements"],
  "incorrect": ["list of incorrect elements"],
  "excessive": ["list of excessive elements"],
  "score": 0-1 (1 = no structural issues)
}
`;

    try {
      const result = await this._callLLM(prompt);
      return JSON.parse(result);
    } catch (error) {
      console.error('[GradientCalculator] Failed to compute structural diff:', error);
      return {
        missing: [],
        incorrect: [],
        excessive: [],
        score: 0.5 // デフォルトスコア
      };
    }
  }

  /**
   * 意味差分を計算
   * @param {string} content - Skill本文
   * @param {string} expected - 期待される結果
   * @param {string} actual - 実際の結果
   * @returns {Promise<Object>}
   * @private
   */
  async _computeSemanticDiff(content, expected, actual) {
    const prompt = `
Analyze the semantic gap between expected and actual outcomes.
Identify reasoning gaps, ambiguities, and inconsistencies.

Skill Content:
${content}

Expected Outcome:
${expected}

Actual Outcome:
${actual}

Output JSON:
{
  "reasoning_gaps": ["list of logical leaps"],
  "ambiguities": ["list of ambiguous instructions"],
  "inconsistencies": ["list of contradictions"],
  "score": 0-1 (1 = no semantic issues)
}
`;

    try {
      const result = await this._callLLM(prompt);
      return JSON.parse(result);
    } catch (error) {
      console.error('[GradientCalculator] Failed to compute semantic diff:', error);
      return {
        reasoning_gaps: [],
        ambiguities: [],
        inconsistencies: [],
        score: 0.5 // デフォルトスコア
      };
    }
  }

  /**
   * KERNEL準拠をチェック
   * @param {string} content - Skill本文
   * @param {Object} principles - KERNEL 6原則
   * @returns {Promise<Object>}
   * @private
   */
  async _checkKERNELCompliance(content, principles) {
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
${JSON.stringify(principles, null, 2)}

Output JSON:
{
  "knowledge": { "score": 0-1, "diagnosis": "..." },
  "explicitness": { "score": 0-1, "diagnosis": "..." },
  "reusability": { "score": 0-1, "diagnosis": "..." },
  "non_redundancy": { "score": 0-1, "diagnosis": "..." },
  "error_resilience": { "score": 0-1, "diagnosis": "..." },
  "linguistic_precision": { "score": 0-1, "diagnosis": "..." },
  "score": 0-1 (average of 6 dimensions)
}
`;

    try {
      const result = await this._callLLM(prompt);
      return JSON.parse(result);
    } catch (error) {
      console.error('[GradientCalculator] Failed to check KERNEL compliance:', error);
      return {
        knowledge: { score: 0.5, diagnosis: 'Not evaluated' },
        explicitness: { score: 0.5, diagnosis: 'Not evaluated' },
        reusability: { score: 0.5, diagnosis: 'Not evaluated' },
        non_redundancy: { score: 0.5, diagnosis: 'Not evaluated' },
        error_resilience: { score: 0.5, diagnosis: 'Not evaluated' },
        linguistic_precision: { score: 0.5, diagnosis: 'Not evaluated' },
        score: 0.5 // デフォルトスコア
      };
    }
  }

  /**
   * 総合スコアを計算
   * @param {Object} scores - 各差分のスコア
   * @returns {number}
   * @private
   */
  _aggregateScore({ structural, semantic, kernel }) {
    const weights = { structural: 0.4, semantic: 0.3, kernel: 0.3 };
    return (
      structural * weights.structural +
      semantic * weights.semantic +
      kernel * weights.kernel
    );
  }

  /**
   * LLMを呼び出し（API経由）
   * @param {string} prompt - プロンプト
   * @returns {Promise<string>}
   * @private
   */
  async _callLLM(prompt) {
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
      return data.result;
    } catch (error) {
      console.error('[GradientCalculator] LLM API call failed:', error);
      throw error;
    }
  }
}

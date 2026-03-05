/**
 * 改善候補生成エンジン
 * テキスト勾配を元に、Skill本文の修正案を3段階で生成
 * Stage 1: 仮実装（最速で通す）
 * Stage 2: 三角測量（複数ケースで検証）
 * Stage 3: 明白な実装（汎用化）
 */
export class CandidateGenerator {
  /**
   * 改善候補を生成
   * @param {string} skillContent - Skill本文
   * @param {Object} textGradient - テキスト勾配
   * @param {Array} usageHistory - 使用履歴
   * @returns {Promise<Object>} 改善候補（naive/triangulated/final）
   */
  async generate(skillContent, textGradient, usageHistory) {
    console.log('[CandidateGenerator] Starting 3-stage generation...');

    // Stage 1: 仮実装（最速で通す）
    const naiveCandidate = await this._generateNaive(skillContent, textGradient);
    console.log('[CandidateGenerator] Stage 1 (naive) completed');

    // Stage 2: 三角測量（複数ケースで検証）
    const triangulatedCandidate = await this._triangulate(
      naiveCandidate,
      usageHistory
    );
    console.log('[CandidateGenerator] Stage 2 (triangulated) completed');

    // Stage 3: 明白な実装（汎用化）
    const finalCandidate = await this._generalize(triangulatedCandidate);
    console.log('[CandidateGenerator] Stage 3 (final) completed');

    return {
      naive: naiveCandidate,
      triangulated: triangulatedCandidate,
      final: finalCandidate
    };
  }

  /**
   * Stage 1: 仮実装を生成
   * @param {string} content - Skill本文
   * @param {Object} gradient - テキスト勾配
   * @returns {Promise<Object>}
   * @private
   */
  async _generateNaive(content, gradient) {
    const prompt = `
Given the Skill content and text gradient, propose a naive improvement.
Focus on addressing the most critical issues first.

Skill Content:
${content}

Text Gradient:
${JSON.stringify(gradient, null, 2)}

Output JSON:
{
  "revised_content": "improved Skill content",
  "changes": ["list of changes made"],
  "reasoning": "why these changes address the gradient"
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
      console.error('[CandidateGenerator] Failed to generate naive candidate:', error);
      throw error;
    }
  }

  /**
   * Stage 2: 三角測量で検証・改善
   * @param {Object} naiveCandidate - 仮実装候補
   * @param {Array} usageHistory - 使用履歴
   * @returns {Promise<Object>}
   * @private
   */
  async _triangulate(naiveCandidate, usageHistory) {
    // 使用履歴からテストケースを抽出
    const testCases = this._extractTestCases(usageHistory);

    if (testCases.length === 0) {
      console.warn('[CandidateGenerator] No test cases available, skipping triangulation');
      return naiveCandidate;
    }

    // 各テストケースで検証
    const validations = await Promise.all(
      testCases.map(tc => this._validateCandidate(naiveCandidate, tc))
    );

    const allPassed = validations.every(v => v.success);

    if (allPassed) {
      console.log('[CandidateGenerator] All test cases passed');
      return naiveCandidate;
    }

    // 失敗ケースを元に修正
    const failedCases = validations.filter(v => !v.success);
    console.log(`[CandidateGenerator] ${failedCases.length} test cases failed, refining...`);

    const refinedCandidate = await this._refineCandidate(naiveCandidate, failedCases);
    return refinedCandidate;
  }

  /**
   * Stage 3: 汎用化
   * @param {Object} triangulatedCandidate - 三角測量済み候補
   * @returns {Promise<Object>}
   * @private
   */
  async _generalize(triangulatedCandidate) {
    const prompt = `
Generalize the triangulated candidate to handle broader use cases.
Remove hard-coded values, extract patterns, add flexibility.

Triangulated Candidate:
${triangulatedCandidate.revised_content}

Previous Changes:
${JSON.stringify(triangulatedCandidate.changes, null, 2)}

Output JSON:
{
  "generalized_content": "final improved Skill content",
  "generalizations": ["list of generalizations made"],
  "reasoning": "why this is more reusable"
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
      console.error('[CandidateGenerator] Failed to generalize candidate:', error);
      throw error;
    }
  }

  /**
   * 使用履歴からテストケースを抽出
   * @param {Array} usageHistory - 使用履歴
   * @returns {Array} テストケース
   * @private
   */
  _extractTestCases(usageHistory) {
    // 最大5件のテストケースを抽出
    return usageHistory
      .filter(h => h.learnings && h.learnings.length > 0)
      .slice(0, 5)
      .map(h => ({
        sessionId: h.sessionId,
        success: h.success,
        learnings: h.learnings,
        metrics: h.metrics
      }));
  }

  /**
   * 候補を検証
   * @param {Object} candidate - 候補
   * @param {Object} testCase - テストケース
   * @returns {Promise<Object>} 検証結果
   * @private
   */
  async _validateCandidate(candidate, testCase) {
    const prompt = `
Validate if the improved Skill content would have produced better results for this test case.

Improved Skill Content:
${candidate.revised_content}

Test Case:
- Session ID: ${testCase.sessionId}
- Success: ${testCase.success}
- Learnings: ${JSON.stringify(testCase.learnings, null, 2)}

Would the improved Skill have prevented failures or improved outcomes?

Output JSON:
{
  "success": true/false,
  "reasoning": "why it would/wouldn't work",
  "issues": ["list of remaining issues"]
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
      console.error('[CandidateGenerator] Failed to validate candidate:', error);
      return { success: false, reasoning: 'Validation failed', issues: [error.message] };
    }
  }

  /**
   * 候補を修正
   * @param {Object} candidate - 元の候補
   * @param {Array} failedCases - 失敗したテストケース
   * @returns {Promise<Object>}
   * @private
   */
  async _refineCandidate(candidate, failedCases) {
    const prompt = `
Refine the candidate Skill content to address the failed test cases.

Current Candidate:
${candidate.revised_content}

Failed Test Cases:
${JSON.stringify(failedCases, null, 2)}

Output JSON:
{
  "revised_content": "refined Skill content",
  "changes": ["list of additional changes made"],
  "reasoning": "how these changes address the failures"
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
      console.error('[CandidateGenerator] Failed to refine candidate:', error);
      return candidate; // フォールバック: 元の候補を返す
    }
  }
}

/**
 * A/Bテスト管理エンジン
 * 新旧Skillsを並行実行し、統計的有意性を検証
 */
export class ABTestManager {
  /**
   * A/Bテストを実行
   * @param {Object} originalSkill - 元のSkill
   * @param {Object} candidateSkill - 改善候補Skill
   * @param {Array} testCases - テストケース
   * @returns {Promise<Object>} テスト結果
   */
  async runTest(originalSkill, candidateSkill, testCases) {
    console.log(`[ABTestManager] Running A/B test with ${testCases.length} test cases...`);

    // 並行実行
    const results = await Promise.all(
      testCases.map(tc => this._runParallel(originalSkill, candidateSkill, tc))
    );

    // スコア集計
    const originalScores = results.map(r => r.originalScore);
    const candidateScores = results.map(r => r.candidateScore);

    const avgOriginal = this._average(originalScores);
    const avgCandidate = this._average(candidateScores);

    const improvement = avgCandidate - avgOriginal;

    // 統計的有意性検定（t検定）
    const significant = this._tTest(originalScores, candidateScores);

    const decision = this._makeDecision(improvement, significant);

    console.log(`[ABTestManager] Test completed: ${decision}`);
    console.log(`  Original avg: ${avgOriginal.toFixed(3)}`);
    console.log(`  Candidate avg: ${avgCandidate.toFixed(3)}`);
    console.log(`  Improvement: ${(improvement * 100).toFixed(1)}%`);
    console.log(`  Significant: ${significant ? 'Yes' : 'No'}`);

    return {
      originalAvg: avgOriginal,
      candidateAvg: avgCandidate,
      improvement,
      significant,
      decision,
      details: results
    };
  }

  /**
   * 並行実行
   * @param {Object} original - 元のSkill
   * @param {Object} candidate - 改善候補Skill
   * @param {Object} testCase - テストケース
   * @returns {Promise<Object>}
   * @private
   */
  async _runParallel(original, candidate, testCase) {
    const [originalResult, candidateResult] = await Promise.all([
      this._execute(original, testCase),
      this._execute(candidate, testCase)
    ]);

    return {
      testCaseId: testCase.id || testCase.sessionId,
      originalScore: this._scoreResult(originalResult),
      candidateScore: this._scoreResult(candidateResult),
      originalResult,
      candidateResult
    };
  }

  /**
   * Skillを実行（シミュレーション）
   * @param {Object} skill - Skill
   * @param {Object} testCase - テストケース
   * @returns {Promise<Object>}
   * @private
   */
  async _execute(skill, testCase) {
    // 実際には、Skillの内容をLLMに渡して実行結果を取得する
    // ここでは簡易版として、テストケースの成功率を返す
    try {
      const response = await fetch('/api/skills/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill, testCase })
      });

      if (!response.ok) {
        throw new Error(`Simulation failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[ABTestManager] Execution failed:', error);
      return { success: false, score: 0, error: error.message };
    }
  }

  /**
   * 実行結果をスコア化
   * @param {Object} result - 実行結果
   * @returns {number} スコア（0-1）
   * @private
   */
  _scoreResult(result) {
    if (result.error) return 0;
    if (result.score !== undefined) return result.score;
    return result.success ? 1 : 0;
  }

  /**
   * 平均を計算
   * @param {Array} scores - スコア配列
   * @returns {number}
   * @private
   */
  _average(scores) {
    if (scores.length === 0) return 0;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  /**
   * t検定（統計的有意性検定）
   * @param {Array} sample1 - サンプル1
   * @param {Array} sample2 - サンプル2
   * @returns {boolean} 有意かどうか（p < 0.05）
   * @private
   */
  _tTest(sample1, sample2) {
    if (sample1.length < 2 || sample2.length < 2) return false;

    const mean1 = this._average(sample1);
    const mean2 = this._average(sample2);

    const variance1 = this._variance(sample1, mean1);
    const variance2 = this._variance(sample2, mean2);

    const n1 = sample1.length;
    const n2 = sample2.length;

    // Welch's t-test
    const tStat = Math.abs(mean1 - mean2) / Math.sqrt(variance1 / n1 + variance2 / n2);

    // 自由度（簡易版）
    const df = n1 + n2 - 2;

    // t値の閾値（p < 0.05, df ≈ 10-20の場合、t ≈ 2.0-2.1）
    const tCritical = 2.0;

    return tStat > tCritical;
  }

  /**
   * 分散を計算
   * @param {Array} sample - サンプル
   * @param {number} mean - 平均
   * @returns {number}
   * @private
   */
  _variance(sample, mean) {
    if (sample.length < 2) return 0;
    const squaredDiffs = sample.map(s => Math.pow(s - mean, 2));
    return squaredDiffs.reduce((sum, d) => sum + d, 0) / (sample.length - 1);
  }

  /**
   * デプロイ判断
   * @param {number} improvement - 改善率
   * @param {boolean} significant - 統計的有意性
   * @returns {string} 判断（DEPLOY/CONTINUE/REJECT）
   * @private
   */
  _makeDecision(improvement, significant) {
    if (improvement > 0.05 && significant) {
      return 'DEPLOY'; // 有意な改善（5%以上）
    } else if (improvement > 0 && !significant) {
      return 'CONTINUE'; // 改善傾向だがサンプル不足
    } else {
      return 'REJECT'; // 改善なし or 劣化
    }
  }

  /**
   * テスト結果をフォーマット（人間可読形式）
   * @param {Object} result - テスト結果
   * @returns {string}
   */
  formatResult(result) {
    return `
# A/B Test Result

**Decision**: ${result.decision}

## Scores
- Original Average: ${(result.originalAvg * 100).toFixed(1)}%
- Candidate Average: ${(result.candidateAvg * 100).toFixed(1)}%
- Improvement: ${(result.improvement * 100).toFixed(1)}%
- Statistically Significant: ${result.significant ? 'Yes' : 'No'}

## Recommendation
${this._getRecommendation(result)}

## Details
${result.details.map((d, i) => `
### Test Case ${i + 1} (${d.testCaseId})
- Original Score: ${(d.originalScore * 100).toFixed(1)}%
- Candidate Score: ${(d.candidateScore * 100).toFixed(1)}%
- Improvement: ${((d.candidateScore - d.originalScore) * 100).toFixed(1)}%
`).join('\n')}
`;
  }

  /**
   * 推奨アクションを取得
   * @param {Object} result - テスト結果
   * @returns {string}
   * @private
   */
  _getRecommendation(result) {
    switch (result.decision) {
      case 'DEPLOY':
        return '✅ Deploy the candidate Skill. Significant improvement detected.';
      case 'CONTINUE':
        return '⚠️ Continue testing with more test cases. Improvement trend detected but not statistically significant.';
      case 'REJECT':
        return '❌ Reject the candidate Skill. No improvement or performance degradation detected.';
      default:
        return 'Unknown decision';
    }
  }
}

#!/usr/bin/env node
/**
 * Skills最適化レポート生成スクリプト
 * evaluation-results.jsonからMarkdownレポートを生成
 */
import fs from 'fs/promises';

/**
 * コマンドライン引数をパース
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    input: 'evaluation-results.json',
    output: 'skills-optimization-report.md'
  };

  args.forEach(arg => {
    if (arg.startsWith('--input=')) {
      options.input = arg.split('=')[1];
    } else if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    }
  });

  return options;
}

/**
 * リスク分類
 */
function classifyRisk(score) {
  if (score < 0.5) return { level: 'high', emoji: '🔴', label: 'High' };
  if (score < 0.7) return { level: 'medium', emoji: '🟡', label: 'Medium' };
  return { level: 'low', emoji: '🟢', label: 'Low' };
}

/**
 * レポート生成
 */
async function generateReport(results) {
  const now = new Date().toISOString();

  // リスク別に分類
  const highRisk = results.filter(r => r.kernelScore < 0.5);
  const mediumRisk = results.filter(r => r.kernelScore >= 0.5 && r.kernelScore < 0.7);
  const lowRisk = results.filter(r => r.kernelScore >= 0.7);

  let report = `# Skills Optimization Report\n\n`;
  report += `**Generated**: ${now}\n`;
  report += `**Total Skills Evaluated**: ${results.length}\n\n`;

  // サマリーテーブル
  report += `## Summary\n\n`;
  report += `| Risk Level | Count | Percentage |\n`;
  report += `|------------|-------|------------|\n`;
  report += `| 🔴 High | ${highRisk.length} | ${(highRisk.length / results.length * 100).toFixed(1)}% |\n`;
  report += `| 🟡 Medium | ${mediumRisk.length} | ${(mediumRisk.length / results.length * 100).toFixed(1)}% |\n`;
  report += `| 🟢 Low | ${lowRisk.length} | ${(lowRisk.length / results.length * 100).toFixed(1)}% |\n\n`;

  // High Risk詳細
  if (highRisk.length > 0) {
    report += `## 🔴 High-Risk Skills (Immediate Action Required)\n\n`;
    report += `These skills have KERNEL scores below 50% and require comprehensive rewrite.\n\n`;

    highRisk
      .sort((a, b) => a.kernelScore - b.kernelScore) // 最低スコア順
      .forEach((skill, index) => {
        report += `### ${index + 1}. ${skill.skillName}\n`;
        report += `**KERNEL Score**: ${(skill.kernelScore * 100).toFixed(1)}%\n\n`;
        report += `**Recommendations**:\n`;
        report += `- 🚨 URGENT: Comprehensive rewrite required\n`;
        report += `- Review all 6 KERNEL principles in [docs/KERNEL-PRINCIPLES.md](./docs/KERNEL-PRINCIPLES.md)\n`;
        report += `- Add missing sections (Context, Constraints, Success Criteria)\n`;
        report += `- Ensure domain knowledge is explicitly documented\n`;
        report += `- Clarify error handling and edge cases\n\n`;
      });
  }

  // Medium Risk詳細
  if (mediumRisk.length > 0) {
    report += `## 🟡 Medium-Risk Skills (Improvement Recommended)\n\n`;
    report += `These skills have KERNEL scores between 50-70% and would benefit from optimization.\n\n`;

    mediumRisk
      .sort((a, b) => a.kernelScore - b.kernelScore) // 最低スコア順
      .slice(0, 10) // 最大10件表示
      .forEach((skill, index) => {
        report += `### ${index + 1}. ${skill.skillName}\n`;
        report += `**KERNEL Score**: ${(skill.kernelScore * 100).toFixed(1)}%\n\n`;
        report += `**Recommendations**:\n`;
        report += `- Enhance clarity and explicitness\n`;
        report += `- Add more examples and usage scenarios\n`;
        report += `- Review for redundancy and verbosity\n\n`;
      });

    if (mediumRisk.length > 10) {
      report += `_...and ${mediumRisk.length - 10} more medium-risk skills. See detailed results below._\n\n`;
    }
  }

  // 全体詳細テーブル
  report += `## Detailed Results\n\n`;
  report += `| Skill | KERNEL | Risk | Completeness | Conciseness |\n`;
  report += `|-------|--------|------|--------------|-------------|\n`;

  results
    .sort((a, b) => a.kernelScore - b.kernelScore) // 最低スコア順
    .forEach(skill => {
      const risk = classifyRisk(skill.kernelScore);
      const kernelPct = (skill.kernelScore * 100).toFixed(1);
      const completenessPct = (skill.dimensions.completeness * 100).toFixed(1);
      const concisenessPct = (skill.dimensions.conciseness * 100).toFixed(1);

      report += `| ${skill.skillName} | ${kernelPct}% | ${risk.emoji} | ${completenessPct}% | ${concisenessPct}% |\n`;
    });

  // フッター
  report += `\n---\n\n`;
  report += `## Next Steps\n\n`;
  report += `1. **High-Risk Skills**: Prioritize comprehensive rewrite\n`;
  report += `2. **Medium-Risk Skills**: Schedule for weekly optimization batch\n`;
  report += `3. **Low-Risk Skills**: Monitor and maintain current quality\n\n`;
  report += `For detailed evaluation criteria, see [docs/KERNEL-PRINCIPLES.md](./docs/KERNEL-PRINCIPLES.md).\n`;

  return report;
}

/**
 * メイン処理
 */
async function main() {
  const options = parseArgs();

  console.log(`📋 Generating optimization report from ${options.input}...`);

  // 評価結果を読み込み
  const resultsJson = await fs.readFile(options.input, 'utf-8');
  const results = JSON.parse(resultsJson);

  console.log(`  Found ${results.length} skills`);

  // レポート生成
  const report = await generateReport(results);

  // 出力
  await fs.writeFile(options.output, report);
  console.log(`✅ Report generated: ${options.output}`);

  // コンソールにもサマリー表示
  const highRisk = results.filter(r => r.kernelScore < 0.5);
  const mediumRisk = results.filter(r => r.kernelScore >= 0.5 && r.kernelScore < 0.7);
  const lowRisk = results.filter(r => r.kernelScore >= 0.7);

  console.log('\n📊 Summary:');
  console.log(`  🔴 High Risk: ${highRisk.length}`);
  console.log(`  🟡 Medium Risk: ${mediumRisk.length}`);
  console.log(`  🟢 Low Risk: ${lowRisk.length}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

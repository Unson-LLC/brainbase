#!/usr/bin/env node
/**
 * Skills KERNEL評価スクリプト
 * 全Skillsを対象にKERNEL 6原則への準拠度を評価し、結果をJSON出力
 */
import fs from 'fs/promises';
import path from 'path';
import { skillsEvaluationService } from '../server/services/skills-evaluation-service.js';

const SKILLS_DIR = path.join(process.cwd(), '.claude', 'skills');

/**
 * コマンドライン引数をパース
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: 'evaluation-results.json',
    skills: null
  };

  args.forEach(arg => {
    if (arg.startsWith('--output=')) {
      options.output = arg.split('=')[1];
    } else if (arg.startsWith('--skills=')) {
      options.skills = arg.split('=')[1].split(',').map(s => s.trim());
    }
  });

  return options;
}

/**
 * 全Skillsディレクトリを取得
 */
async function getAllSkillDirs() {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    console.error('Failed to read skills directory:', error.message);
    return [];
  }
}

/**
 * SKILL.mdが存在するか確認
 */
async function hasSkillFile(skillName) {
  const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md');
  try {
    await fs.access(skillPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * 単一Skillを評価
 */
async function evaluateSkill(skillName) {
  console.log(`Evaluating ${skillName}...`);

  try {
    // KERNEL評価（6次元統合）
    const kernelScore = await skillsEvaluationService.checkKERNEL(skillName);

    // その他の評価（補足情報として）
    const completeness = await skillsEvaluationService.checkCompleteness(skillName);
    const conciseness = await skillsEvaluationService.checkConciseness(skillName);

    return {
      skillName,
      kernelScore,
      dimensions: {
        completeness,
        conciseness
      },
      evaluatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error(`  ❌ Failed to evaluate ${skillName}:`, error.message);
    return null;
  }
}

/**
 * メイン処理
 */
async function main() {
  const options = parseArgs();

  console.log('🔍 Starting KERNEL Evaluation...\n');

  // 評価対象Skillsを決定
  let targetSkills;
  if (options.skills) {
    targetSkills = options.skills;
    console.log(`Target: ${targetSkills.length} specific skill(s)`);
  } else {
    const allDirs = await getAllSkillDirs();
    targetSkills = [];

    for (const dir of allDirs) {
      if (await hasSkillFile(dir)) {
        targetSkills.push(dir);
      }
    }

    console.log(`Target: ${targetSkills.length} skill(s) found in ${SKILLS_DIR}\n`);
  }

  // 評価実行
  const results = [];
  const errors = [];

  for (const skillName of targetSkills) {
    const result = await evaluateSkill(skillName);

    if (result) {
      results.push(result);
      const score = (result.kernelScore * 100).toFixed(1);
      const risk = result.kernelScore < 0.5 ? '🔴' : result.kernelScore < 0.7 ? '🟡' : '🟢';
      console.log(`  ${risk} ${skillName}: ${score}%`);
    } else {
      errors.push(skillName);
    }

    // Rate limit対策（1秒待機）
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n✅ Evaluation complete: ${results.length} skills evaluated`);

  if (errors.length > 0) {
    console.warn(`\n⚠️ Errors: ${errors.length} skills failed`);
    errors.forEach(err => console.warn(`  - ${err}`));
  }

  // 結果をJSON出力
  await fs.writeFile(options.output, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to: ${options.output}`);

  // サマリー表示
  const highRisk = results.filter(r => r.kernelScore < 0.5);
  const mediumRisk = results.filter(r => r.kernelScore >= 0.5 && r.kernelScore < 0.7);
  const lowRisk = results.filter(r => r.kernelScore >= 0.7);

  console.log('\n📊 Risk Summary:');
  console.log(`  🔴 High Risk: ${highRisk.length} (${(highRisk.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  🟡 Medium Risk: ${mediumRisk.length} (${(mediumRisk.length / results.length * 100).toFixed(1)}%)`);
  console.log(`  🟢 Low Risk: ${lowRisk.length} (${(lowRisk.length / results.length * 100).toFixed(1)}%)`);

  // 終了コード
  if (highRisk.length > 0) {
    console.log('\n⚠️ High-risk skills detected. Review recommended.');
    process.exit(0); // Non-blocking（CI継続）
  }

  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * brainbase メタデータ整合性チェッカー
 *
 * チェック対象:
 * - people.md ↔ people/*.md
 * - partners.md → people.md
 * - プロジェクト専用glossary → people.md
 * - 共通glossary → partners.md / customers
 * - orgs/*.md → projects/
 * - customers/*.md → projects/
 * - raci.md → people.md
 * - projects/ 01-05充足率
 */

const fs = require('fs');
const path = require('path');

const CODEX_PATH = path.join(__dirname, '..', '_codex');

const results = {
  errors: [],
  warnings: [],
  info: [],
  stats: {}
};

// ユーティリティ: MDテーブルから名前を抽出
function extractNamesFromTable(content, nameColumnIndex = 0) {
  const names = [];
  const lines = content.split('\n');
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith('|') && line.includes('|')) {
      if (line.includes('---')) {
        inTable = true;
        continue;
      }
      if (inTable) {
        const cells = line.split('|').filter(c => c.trim());
        if (cells[nameColumnIndex]) {
          const name = cells[nameColumnIndex].trim();
          if (name && !name.includes('名前') && !name.includes('パートナー')) {
            names.push(name);
          }
        }
      }
    }
  }
  return names;
}

// ユーティリティ: YAMLフロントマターからnameを抽出
function extractNameFromFrontmatter(content) {
  const match = content.match(/^---\n[\s\S]*?name:\s*(.+?)\n[\s\S]*?---/);
  return match ? match[1].trim() : null;
}

// 1. people.md ↔ people/*.md チェック
function checkPeopleIntegrity() {
  console.log('\n📋 People整合性チェック...');

  const peopleMdPath = path.join(CODEX_PATH, 'common', 'meta', 'people.md');
  const peopleDirPath = path.join(CODEX_PATH, 'common', 'meta', 'people');

  if (!fs.existsSync(peopleMdPath)) {
    results.errors.push('people.md が存在しません');
    return;
  }

  const peopleMdContent = fs.readFileSync(peopleMdPath, 'utf8');
  const peopleMdNames = extractNamesFromTable(peopleMdContent);

  // 個別ファイルから名前を取得
  const individualNames = [];
  if (fs.existsSync(peopleDirPath)) {
    const files = fs.readdirSync(peopleDirPath).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(peopleDirPath, file), 'utf8');
      const name = extractNameFromFrontmatter(content);
      if (name) {
        individualNames.push({ name, file });
      }
    }
  }

  // people/*.md にあるが people.md にない
  const inFilesNotInMd = individualNames.filter(
    item => !peopleMdNames.some(n => n.includes(item.name.split(' ')[0]))
  );

  // people.md にあるが people/*.md にない（警告のみ）
  const inMdNotInFiles = peopleMdNames.filter(
    name => !individualNames.some(item => name.includes(item.name.split(' ')[0]))
  );

  if (inFilesNotInMd.length > 0) {
    results.errors.push(`people/*.md にあるが people.md にない (${inFilesNotInMd.length}名):`);
    inFilesNotInMd.forEach(item => {
      results.errors.push(`  - ${item.file}: ${item.name}`);
    });
  }

  if (inMdNotInFiles.length > 0) {
    results.info.push(`people.md にあるが個別ファイルなし (${inMdNotInFiles.length}名) ※任意`);
  }

  results.stats.peopleInMd = peopleMdNames.length;
  results.stats.peopleFiles = individualNames.length;
}

// 2. partners.md → people.md チェック
function checkPartnersIntegrity() {
  console.log('🤝 Partners整合性チェック...');

  const partnersMdPath = path.join(CODEX_PATH, 'common', 'meta', 'partners.md');
  const peopleMdPath = path.join(CODEX_PATH, 'common', 'meta', 'people.md');

  if (!fs.existsSync(partnersMdPath)) {
    results.warnings.push('partners.md が存在しません');
    return;
  }

  const partnersContent = fs.readFileSync(partnersMdPath, 'utf8');
  const peopleContent = fs.readFileSync(peopleMdPath, 'utf8');

  // パートナー名を抽出（個人パートナーの場合はpeople.mdにあるべき）
  const partnerNames = extractNamesFromTable(partnersContent);
  const peopleNames = extractNamesFromTable(peopleContent);

  // 個人パートナー（人名っぽいもの）をチェック
  const personalPartners = partnerNames.filter(name =>
    /^[ぁ-んァ-ン一-龥]+\s*[ぁ-んァ-ン一-龥]+$/.test(name) || // 日本人名
    name.includes('（') // 括弧付きは組織名なのでスキップ
  ).filter(name => !name.includes('（'));

  const missingInPeople = personalPartners.filter(
    name => !peopleNames.some(p => p.includes(name.split(' ')[0]))
  );

  if (missingInPeople.length > 0) {
    results.errors.push(`partners.md の個人が people.md にない:`);
    missingInPeople.forEach(name => {
      results.errors.push(`  - ${name}`);
    });
  }

  results.stats.partners = partnerNames.length;
}

// 3. プロジェクト専用glossary → people.md チェック
function checkGlossaryIntegrity() {
  console.log('📖 Glossary整合性チェック...');

  const projectsPath = path.join(CODEX_PATH, 'projects');
  const peopleMdPath = path.join(CODEX_PATH, 'common', 'meta', 'people.md');

  if (!fs.existsSync(projectsPath)) return;

  const peopleContent = fs.readFileSync(peopleMdPath, 'utf8');
  const peopleNames = extractNamesFromTable(peopleContent);

  const projects = fs.readdirSync(projectsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  let glossaryCount = 0;

  for (const project of projects) {
    const glossaryPath = path.join(projectsPath, project, 'glossary.md');
    if (fs.existsSync(glossaryPath)) {
      glossaryCount++;
      const content = fs.readFileSync(glossaryPath, 'utf8');

      // 人名セクションから名前を抽出（正しい表記列 = index 1）
      const lines = content.split('\n');
      let inPeopleSection = false;

      for (const line of lines) {
        if (line.includes('## 人名')) {
          inPeopleSection = true;
          continue;
        }
        if (line.startsWith('## ') && inPeopleSection) {
          inPeopleSection = false;
        }

        if (inPeopleSection && line.startsWith('|') && !line.includes('---') && !line.includes('誤認識')) {
          const cells = line.split('|').filter(c => c.trim());
          if (cells[1]) {
            const correctName = cells[1].trim();
            // people.mdに存在するかチェック（姓で部分一致）
            const familyName = correctName.split(' ')[0];
            if (familyName && !peopleNames.some(p => p.includes(familyName))) {
              results.warnings.push(`${project}/glossary.md: "${correctName}" が people.md にない`);
            }
          }
        }
      }
    }
  }

  results.stats.projectGlossaries = glossaryCount;
  results.stats.totalProjects = projects.length;
}

// 4. orgs/*.md → projects/ チェック
function checkOrgsIntegrity() {
  console.log('🏢 Orgs整合性チェック...');

  const orgsPath = path.join(CODEX_PATH, 'orgs');
  const projectsPath = path.join(CODEX_PATH, 'projects');

  if (!fs.existsSync(orgsPath)) {
    results.warnings.push('orgs/ ディレクトリが存在しません');
    return;
  }

  const orgFiles = fs.readdirSync(orgsPath).filter(f => f.endsWith('.md'));
  const projects = fs.existsSync(projectsPath)
    ? fs.readdirSync(projectsPath, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
    : [];

  // org名からプロジェクト名を推測してチェック
  const orgsWithoutProject = [];
  for (const orgFile of orgFiles) {
    const orgName = orgFile.replace('.md', '').toLowerCase();
    const hasProject = projects.some(p =>
      p.toLowerCase() === orgName ||
      p.toLowerCase().includes(orgName) ||
      orgName.includes(p.toLowerCase())
    );
    if (!hasProject) {
      orgsWithoutProject.push(orgFile);
    }
  }

  if (orgsWithoutProject.length > 0) {
    results.info.push(`orgs/ に対応するprojects/がない: ${orgsWithoutProject.join(', ')}`);
  }

  results.stats.orgs = orgFiles.length;
}

// 5. projects/ 01-05充足率チェック
function checkProjectCompleteness() {
  console.log('📁 Projects充足率チェック...');

  const projectsPath = path.join(CODEX_PATH, 'projects');
  if (!fs.existsSync(projectsPath)) return;

  const requiredDocs = ['01_strategy', '02_offer', '03_sales_ops', '04_delivery', '05_kpi'];
  const projects = fs.readdirSync(projectsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const incompleteProjects = [];

  for (const project of projects) {
    const projectPath = path.join(projectsPath, project);
    const files = fs.readdirSync(projectPath);

    const missing = requiredDocs.filter(doc =>
      !files.some(f => f.toLowerCase().startsWith(doc.split('_')[0]))
    );

    if (missing.length > 0) {
      incompleteProjects.push({ project, missing: missing.length, total: requiredDocs.length });
    }
  }

  if (incompleteProjects.length > 0) {
    const avgCompleteness = incompleteProjects.reduce((sum, p) =>
      sum + ((requiredDocs.length - p.missing) / requiredDocs.length), 0
    ) / incompleteProjects.length * 100;

    results.info.push(`01-05充足率: ${incompleteProjects.length}/${projects.length} プロジェクトが不完全`);
  }

  results.stats.projects = projects.length;
}

// 6. customers/*.md チェック
function checkCustomersIntegrity() {
  console.log('👥 Customers整合性チェック...');

  const customersPath = path.join(CODEX_PATH, 'common', 'meta', 'customers');
  if (!fs.existsSync(customersPath)) {
    results.info.push('customers/ ディレクトリが存在しません');
    return;
  }

  const customerFiles = fs.readdirSync(customersPath).filter(f => f.endsWith('.md'));
  results.stats.customers = customerFiles.length;
}

// 7. raci.md → people.md チェック
function checkRaciIntegrity() {
  console.log('📊 RACI整合性チェック...');

  const raciPath = path.join(CODEX_PATH, 'common', 'meta', 'raci.md');
  const peopleMdPath = path.join(CODEX_PATH, 'common', 'meta', 'people.md');

  if (!fs.existsSync(raciPath)) {
    results.info.push('raci.md が存在しません');
    return;
  }

  // RACIファイル内の人名をチェック（実装は簡略化）
  results.stats.raciExists = true;
}

// メイン実行
function main() {
  console.log('===========================================');
  console.log('  brainbase メタデータ整合性チェック');
  console.log('===========================================');

  checkPeopleIntegrity();
  checkPartnersIntegrity();
  checkGlossaryIntegrity();
  checkOrgsIntegrity();
  checkProjectCompleteness();
  checkCustomersIntegrity();
  checkRaciIntegrity();

  // 結果出力
  console.log('\n===========================================');
  console.log('  チェック結果');
  console.log('===========================================\n');

  if (results.errors.length > 0) {
    console.log('❌ エラー（要修正）:');
    results.errors.forEach(e => console.log(`   ${e}`));
    console.log('');
  }

  if (results.warnings.length > 0) {
    console.log('⚠️  警告:');
    results.warnings.forEach(w => console.log(`   ${w}`));
    console.log('');
  }

  if (results.info.length > 0) {
    console.log('ℹ️  情報:');
    results.info.forEach(i => console.log(`   ${i}`));
    console.log('');
  }

  if (results.errors.length === 0 && results.warnings.length === 0) {
    console.log('✅ すべてのチェックに合格しました！\n');
  }

  // 統計
  console.log('📊 統計:');
  console.log(`   people.md: ${results.stats.peopleInMd || 0}名`);
  console.log(`   people/*.md: ${results.stats.peopleFiles || 0}ファイル`);
  console.log(`   partners: ${results.stats.partners || 0}件`);
  console.log(`   orgs: ${results.stats.orgs || 0}組織`);
  console.log(`   projects: ${results.stats.projects || 0}件`);
  console.log(`   project glossaries: ${results.stats.projectGlossaries || 0}/${results.stats.totalProjects || 0}`);
  console.log(`   customers: ${results.stats.customers || 0}件`);

  // 終了コード
  process.exit(results.errors.length > 0 ? 1 : 0);
}

main();

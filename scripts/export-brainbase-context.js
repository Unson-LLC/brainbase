#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CODEX_PATH = path.join(__dirname, '..', '_codex');
const OUTPUT_PATH = path.join(__dirname, '..', 'context-output');

// brainbaseプロジェクト → slack-classify-bot側の別名マッピング
// 同じコンテキストを複数の名前で出力する
const PROJECT_ALIASES = {
  'techknight': ['tech-knight-board', 'aitle'],
  'ncom': ['dialogai'],
};

// 複数プロジェクトを結合する特殊マッピング
const COMBINED_PROJECTS = {
  'unson-board': {
    include: ['baao', 'brainbase', 'mywa', 'salestailor', 'senrigan', 'techknight', 'zeims'],
    exclude: ['ncom']
  },
  'unson-os': {
    include: ['baao', 'brainbase', 'mywa', 'salestailor', 'senrigan', 'techknight', 'zeims'],
    exclude: ['ncom']
  },
};

function readMarkdownFiles(dirPath) {
  const content = [];

  if (!fs.existsSync(dirPath)) {
    return content;
  }

  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      content.push(...readMarkdownFiles(fullPath));
    } else if (item.name.endsWith('.md')) {
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      content.push({
        file: path.relative(CODEX_PATH, fullPath),
        content: fileContent
      });
    }
  }

  return content;
}

function exportProjectContext(projectId) {
  const projectPath = path.join(CODEX_PATH, 'projects', projectId);

  if (!fs.existsSync(projectPath)) {
    console.log(`  Skip: ${projectId} (no _codex/projects/${projectId})`);
    return null;
  }

  const context = {
    project_id: projectId,
    exported_at: new Date().toISOString(),
    project_docs: [],
    related_customers: [],
    related_people: [],
    related_orgs: [],
    glossary: []
  };

  // 0. 共通用語集を読み込む
  const commonGlossaryPath = path.join(CODEX_PATH, 'common', 'meta', 'glossary.md');
  if (fs.existsSync(commonGlossaryPath)) {
    const glossaryContent = fs.readFileSync(commonGlossaryPath, 'utf8');
    context.glossary.push({
      file: 'common/meta/glossary.md',
      content: glossaryContent
    });
  }

  // 0.1 プロジェクト固有の用語集があれば追加
  const projectGlossaryPath = path.join(projectPath, 'glossary.md');
  if (fs.existsSync(projectGlossaryPath)) {
    const projectGlossaryContent = fs.readFileSync(projectGlossaryPath, 'utf8');
    context.glossary.push({
      file: `projects/${projectId}/glossary.md`,
      content: projectGlossaryContent
    });
  }

  // 1. プロジェクトドキュメント
  context.project_docs = readMarkdownFiles(projectPath);

  // 2. 関連する顧客情報を探す
  const customersPath = path.join(CODEX_PATH, 'common', 'meta', 'customers');
  if (fs.existsSync(customersPath)) {
    const customerFiles = fs.readdirSync(customersPath).filter(f => f.endsWith('.md'));
    for (const file of customerFiles) {
      const filePath = path.join(customersPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      // プロジェクトIDが含まれている顧客ファイルを関連として追加
      if (content.toLowerCase().includes(projectId.toLowerCase())) {
        context.related_customers.push({
          file: `common/meta/customers/${file}`,
          content: content
        });
      }
    }
  }

  // 3. 関連する人物情報を探す
  const peoplePath = path.join(CODEX_PATH, 'common', 'meta', 'people');
  if (fs.existsSync(peoplePath)) {
    const peopleFiles = fs.readdirSync(peoplePath).filter(f => f.endsWith('.md'));
    for (const file of peopleFiles) {
      const filePath = path.join(peoplePath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      // プロジェクトIDが含まれている人物ファイルを関連として追加
      if (content.toLowerCase().includes(projectId.toLowerCase())) {
        context.related_people.push({
          file: `common/meta/people/${file}`,
          content: content
        });
      }
    }
  }

  // 4. 組織情報
  const orgsPath = path.join(CODEX_PATH, 'orgs');
  if (fs.existsSync(orgsPath)) {
    const orgFiles = fs.readdirSync(orgsPath).filter(f => f.endsWith('.md'));
    for (const file of orgFiles) {
      const filePath = path.join(orgsPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.toLowerCase().includes(projectId.toLowerCase())) {
        context.related_orgs.push({
          file: `orgs/${file}`,
          content: content
        });
      }
    }
  }

  return context;
}

function formatContextAsText(context) {
  let text = `# プロジェクトコンテキスト: ${context.project_id}\n\n`;
  text += `エクスポート日時: ${context.exported_at}\n\n`;

  // 用語集を最初に配置（LLMが最初に参照できるように）
  if (context.glossary && context.glossary.length > 0) {
    text += `## 用語集（固有名詞の正しい表記）\n\n`;
    text += `**重要**: 以下の用語集に従って、音声認識の誤りを修正してください。\n\n`;
    for (const doc of context.glossary) {
      text += `${doc.content}\n\n---\n\n`;
    }
  }

  if (context.project_docs.length > 0) {
    text += `## プロジェクトドキュメント\n\n`;
    for (const doc of context.project_docs) {
      text += `### ${doc.file}\n\n${doc.content}\n\n---\n\n`;
    }
  }

  if (context.related_customers.length > 0) {
    text += `## 関連顧客情報\n\n`;
    for (const doc of context.related_customers) {
      text += `### ${doc.file}\n\n${doc.content}\n\n---\n\n`;
    }
  }

  if (context.related_people.length > 0) {
    text += `## 関連人物情報\n\n`;
    for (const doc of context.related_people) {
      text += `### ${doc.file}\n\n${doc.content}\n\n---\n\n`;
    }
  }

  if (context.related_orgs.length > 0) {
    text += `## 関連組織情報\n\n`;
    for (const doc of context.related_orgs) {
      text += `### ${doc.file}\n\n${doc.content}\n\n---\n\n`;
    }
  }

  return text;
}

function main() {
  console.log('=== Brainbase Context Export ===\n');

  // 出力ディレクトリ作成
  if (!fs.existsSync(OUTPUT_PATH)) {
    fs.mkdirSync(OUTPUT_PATH, { recursive: true });
  }

  // プロジェクト一覧取得
  const projectsPath = path.join(CODEX_PATH, 'projects');
  if (!fs.existsSync(projectsPath)) {
    console.error('Error: _codex/projects not found');
    process.exit(1);
  }

  const projects = fs.readdirSync(projectsPath, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`Found ${projects.length} projects: ${projects.join(', ')}\n`);

  let exported = 0;

  for (const projectId of projects) {
    console.log(`Processing: ${projectId}`);

    const context = exportProjectContext(projectId);

    if (context) {
      // テキスト形式で出力（LLMに渡しやすい）
      const textContent = formatContextAsText(context);
      const outputFile = path.join(OUTPUT_PATH, `${projectId}.txt`);
      fs.writeFileSync(outputFile, textContent);

      const stats = {
        docs: context.project_docs.length,
        customers: context.related_customers.length,
        people: context.related_people.length,
        orgs: context.related_orgs.length
      };

      console.log(`  Exported: ${outputFile}`);
      console.log(`  Stats: ${stats.docs} docs, ${stats.customers} customers, ${stats.people} people, ${stats.orgs} orgs`);
      exported++;

      // エイリアスがあれば同じ内容を別名でも出力
      const aliases = PROJECT_ALIASES[projectId] || [];
      for (const alias of aliases) {
        const aliasFile = path.join(OUTPUT_PATH, `${alias}.txt`);
        fs.writeFileSync(aliasFile, textContent);
        console.log(`  Alias: ${aliasFile}`);
      }
    }
  }

  console.log(`\n=== Done: ${exported} projects exported to ${OUTPUT_PATH} ===`);

  // 複合コンテキストの生成
  console.log('\n=== Generating combined contexts ===\n');

  for (const [combinedName, config] of Object.entries(COMBINED_PROJECTS)) {
    console.log(`Processing combined: ${combinedName}`);

    let combinedText = `# 複合プロジェクトコンテキスト: ${combinedName}\n\n`;
    combinedText += `エクスポート日時: ${new Date().toISOString()}\n`;
    combinedText += `含まれるプロジェクト: ${config.include.join(', ')}\n\n`;
    combinedText += `---\n\n`;

    for (const projectId of config.include) {
      const sourceFile = path.join(OUTPUT_PATH, `${projectId}.txt`);
      if (fs.existsSync(sourceFile)) {
        const content = fs.readFileSync(sourceFile, 'utf8');
        combinedText += content;
        combinedText += `\n\n${'='.repeat(80)}\n\n`;
      }
    }

    const outputFile = path.join(OUTPUT_PATH, `${combinedName}.txt`);
    fs.writeFileSync(outputFile, combinedText);
    console.log(`  Exported: ${outputFile} (${Math.round(combinedText.length / 1024)}KB)`);
  }
}

main();

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

// .envファイルを読み込む
dotenv.config();

const inputDir = process.argv[2];
const outputDir = process.argv[3];

if (!inputDir || !outputDir) {
  console.error(
    "Usage: npx tsx extract-sales-context.ts <input-txt-directory> <output-directory>",
  );
  process.exit(1);
}

// 環境変数からAPIキーを取得
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("❌ ANTHROPIC_API_KEY環境変数が設定されていません");
  console.error("以下のコマンドで設定してください：");
  console.error('export ANTHROPIC_API_KEY="your-api-key"');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

interface SalesContext {
  company_name: string;
  industry: string;
  vision_mission: {
    vision: string;
    mission: string;
    core_values: string[];
  };
  key_businesses: string[];
  key_strategies: string[];
  technologies: string[];
  sustainability_focus: string[];
  sales_approach_context: string; // 変更: 営業アプローチの視点
  potential_needs_and_challenges: string[]; // 新規: 潜在的なニーズ・課題
  decision_making_context: {
    // 新規: 意思決定コンテキスト
    key_departments: string[];
    decision_factors: string[];
  };
  budget_investment_areas: string[]; // 新規: 投資領域
  talking_points: string[];
  recent_initiatives: string[];
}

const EXTRACTION_PROMPT = `あなたは日本の上場企業に対して営業を行う際に必要な情報を統合報告書から抽出する専門家です。

**重要**: これらの企業に営業するための情報を抽出してください。企業が自社の営業に使う情報ではありません。

以下のテキストから、この企業に営業メールを送ったり、商談を行う際に役立つ情報を構造化して抽出してください。

# 抽出する情報

1. **company_name**: 企業名（正式名称）
2. **industry**: 業種（1-2語で簡潔に）
3. **vision_mission**:
   - vision: ビジョン（企業が目指す姿）
   - mission: ミッション（使命）
   - core_values: 企業の核となる価値観（3-5個）
4. **key_businesses**: 主要事業領域（3-7個）
5. **key_strategies**: 重点戦略・取り組み（3-7個）
6. **technologies**: 注目すべき技術・イノベーション（3-7個）
7. **sustainability_focus**: サステナビリティ重点項目（3-5個）
8. **sales_approach_context**: この企業に営業する際の基本アプローチ文（100-150文字、「御社は...」という視点で記述）
9. **potential_needs_and_challenges**: 統合報告書から読み取れる潜在的なニーズ・課題・痛点（3-5個）
10. **decision_making_context**: 意思決定コンテキスト
    - key_departments: 重要な部門・組織（3-5個）
    - decision_factors: 意思決定で重視される要素（3-5個、例: コスト削減、DX推進、グローバル展開など）
11. **budget_investment_areas**: 投資している領域・予算配分先（3-5個、具体的な金額があれば含む）
12. **talking_points**: 営業で刺さるポイント（3-5個、具体的な数字や固有名詞含む）
13. **recent_initiatives**: 最近の重要な取り組み・ニュース（3-5個、年月含む）

# 出力形式

必ず以下のJSON形式で出力してください：

\`\`\`json
{
  "company_name": "...",
  "industry": "...",
  "vision_mission": {
    "vision": "...",
    "mission": "...",
    "core_values": ["...", "..."]
  },
  "key_businesses": ["...", "..."],
  "key_strategies": ["...", "..."],
  "technologies": ["...", "..."],
  "sustainability_focus": ["...", "..."],
  "sales_approach_context": "御社は...",
  "potential_needs_and_challenges": ["...", "..."],
  "decision_making_context": {
    "key_departments": ["...", "..."],
    "decision_factors": ["...", "..."]
  },
  "budget_investment_areas": ["...", "..."],
  "talking_points": ["...", "..."],
  "recent_initiatives": ["...", "..."]
}
\`\`\`

# 注意事項

- 情報が見つからない項目は空の配列または空文字列にしてください
- 具体的な数値・固有名詞を重視してください
- **営業担当者がこの企業にアプローチする際に使える情報**を優先してください
- sales_approach_contextは「御社は...」という視点で、営業する側が使う文章にしてください
- JSONのみを出力し、説明文は不要です`;

async function extractSalesContext(
  txtContent: string,
  companyFileName: string,
): Promise<SalesContext | null> {
  try {
    console.log(`  📊 Claude APIで分析中: ${companyFileName}`);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\n# 統合報告書テキスト\n\n${txtContent.slice(0, 100000)}`, // 最初の100,000文字のみ
        },
      ],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // JSONブロックを抽出
    const jsonMatch =
      responseText.match(/```json\n([\s\S]*?)\n```/) ||
      responseText.match(/({[\s\S]*})/);
    if (!jsonMatch) {
      console.error(
        `  ❌ JSON形式の応答が見つかりませんでした: ${companyFileName}`,
      );
      return null;
    }

    const salesContext = JSON.parse(jsonMatch[1]) as SalesContext;
    return salesContext;
  } catch (error) {
    console.error(`  ❌ エラー発生 (${companyFileName}):`, error);
    return null;
  }
}

function generateMarkdownSummary(context: SalesContext): string {
  return `# ${context.company_name} - 営業コンテキスト

## 企業概要
- **業種**: ${context.industry}
- **ビジョン**: ${context.vision_mission.vision}
- **ミッション**: ${context.vision_mission.mission}

## 企業の核となる価値観
${context.vision_mission.core_values.map((v) => `- ${v}`).join("\n")}

## 主要事業
${context.key_businesses.map((b) => `- ${b}`).join("\n")}

## 重点戦略
${context.key_strategies.map((s) => `- ${s}`).join("\n")}

## 注目技術・イノベーション
${context.technologies.map((t) => `- ${t}`).join("\n")}

## サステナビリティ重点
${context.sustainability_focus.map((s) => `- ${s}`).join("\n")}

## 営業アプローチ文
${context.sales_approach_context}

## 潜在的なニーズ・課題
${context.potential_needs_and_challenges.map((n) => `- ${n}`).join("\n")}

## 意思決定コンテキスト

### 重要な部門・組織
${context.decision_making_context.key_departments.map((d) => `- ${d}`).join("\n")}

### 意思決定で重視される要素
${context.decision_making_context.decision_factors.map((f) => `- ${f}`).join("\n")}

## 投資領域
${context.budget_investment_areas.map((b) => `- ${b}`).join("\n")}

## 刺さるポイント（営業トーク例）
${context.talking_points.map((p, i) => `${i + 1}. ${p}`).join("\n")}

## 最近の重要な取り組み
${context.recent_initiatives.map((i) => `- ${i}`).join("\n")}

---
*このコンテキストはClaude APIによって自動生成されました*
`;
}

async function processAllFiles() {
  const txtFiles = fs
    .readdirSync(inputDir)
    .filter((file) => file.endsWith(".txt"));

  // 出力ディレクトリ作成
  const jsonDir = path.join(outputDir, "json");
  const markdownDir = path.join(outputDir, "markdown");
  fs.mkdirSync(jsonDir, { recursive: true });
  fs.mkdirSync(markdownDir, { recursive: true });

  console.log(`\n🚀 ${txtFiles.length}社の営業コンテキスト抽出を開始...\n`);

  const results: { [key: string]: SalesContext } = {};
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < txtFiles.length; i++) {
    const txtFile = txtFiles[i];
    const companyKey = txtFile.replace(".txt", "");

    console.log(`[${i + 1}/${txtFiles.length}] ${companyKey}`);

    try {
      const txtContent = fs.readFileSync(path.join(inputDir, txtFile), "utf8");
      const salesContext = await extractSalesContext(txtContent, txtFile);

      if (salesContext) {
        // JSON保存
        fs.writeFileSync(
          path.join(jsonDir, `${companyKey}.json`),
          JSON.stringify(salesContext, null, 2),
          "utf8",
        );

        // Markdown保存
        const markdown = generateMarkdownSummary(salesContext);
        fs.writeFileSync(
          path.join(markdownDir, `${companyKey}.md`),
          markdown,
          "utf8",
        );

        results[companyKey] = salesContext;
        console.log(`  ✅ 完了\n`);
        successCount++;
      } else {
        failCount++;
      }

      // API Rate Limit対策（少し待機）
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`  ❌ 処理失敗: ${txtFile}`, error);
      failCount++;
    }
  }

  // インデックスファイル生成
  const indexData = {
    generated_at: new Date().toISOString(),
    total_companies: txtFiles.length,
    successful: successCount,
    failed: failCount,
    companies: Object.keys(results).map((key) => ({
      key,
      name: results[key].company_name,
      industry: results[key].industry,
    })),
  };

  fs.writeFileSync(
    path.join(outputDir, "index.json"),
    JSON.stringify(indexData, null, 2),
    "utf8",
  );

  console.log(`\n✨ 処理完了！`);
  console.log(`   成功: ${successCount}社`);
  console.log(`   失敗: ${failCount}社`);
  console.log(`\n📁 出力先:`);
  console.log(`   JSON: ${jsonDir}`);
  console.log(`   Markdown: ${markdownDir}`);
  console.log(`   Index: ${path.join(outputDir, "index.json")}`);
}

processAllFiles().catch(console.error);

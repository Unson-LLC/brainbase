import fs from "fs";
import * as pdfParseModule from "pdf-parse";

const pdfParse = (pdfParseModule as any).default || pdfParseModule;

const pdfPath = process.argv[2];
const outputPath = process.argv[3];

if (!pdfPath) {
  console.error("Usage: npx tsx extract-pdf-text.ts <pdf-path> [output-path]");
  process.exit(1);
}

async function extractPdfText() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(dataBuffer);
    const text = data.text;

    if (outputPath) {
      fs.writeFileSync(outputPath, text, "utf8");
      console.log(`テキストを抽出しました: ${outputPath}`);
      console.log(`ページ数: ${data.numpages}`);
      console.log(`文字数: ${text.length}`);
    } else {
      console.log(text);
    }
  } catch (error) {
    console.error("PDF解析エラー:", error);
    process.exit(1);
  }
}

extractPdfText();

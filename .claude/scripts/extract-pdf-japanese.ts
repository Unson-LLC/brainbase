import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = process.argv[2];
const outputPath = process.argv[3];

if (!pdfPath) {
  console.error(
    "Usage: npx tsx extract-pdf-japanese.ts <pdf-path> [output-path]",
  );
  process.exit(1);
}

async function extractPdfText() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);

    // CMapの設定
    const cMapUrl = path.join(
      __dirname,
      "../../node_modules/pdfjs-dist/cmaps/",
    );

    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      cMapUrl: cMapUrl,
      cMapPacked: true,
      standardFontDataUrl: path.join(
        __dirname,
        "../../node_modules/pdfjs-dist/standard_fonts/",
      ),
    });

    const pdf = await loadingTask.promise;

    let fullText = "";

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      fullText += pageText + "\n\n";
    }

    if (outputPath) {
      fs.writeFileSync(outputPath, fullText, "utf8");
      console.log(`テキストを抽出しました: ${outputPath}`);
      console.log(`ページ数: ${pdf.numPages}`);
      console.log(`文字数: ${fullText.length}`);
    } else {
      console.log(fullText);
    }
  } catch (error) {
    console.error("PDF解析エラー:", error);
    process.exit(1);
  }
}

extractPdfText();

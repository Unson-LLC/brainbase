import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const pdfPath = process.argv[2];
const outputPath = process.argv[3];

if (!pdfPath) {
  console.error(
    "Usage: npx tsx extract-pdf-with-pdfjs.ts <pdf-path> [output-path]",
  );
  process.exit(1);
}

async function extractPdfText() {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);

    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
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

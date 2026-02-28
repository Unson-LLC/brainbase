import fs from "fs";
import path from "path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfDir = process.argv[2];
const outputDir = process.argv[3];

if (!pdfDir || !outputDir) {
  console.error(
    "Usage: npx tsx extract-all-pdfs.ts <pdf-directory> <output-directory>",
  );
  process.exit(1);
}

async function extractPdfText(pdfPath: string, outputPath: string) {
  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const uint8Array = new Uint8Array(dataBuffer);

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

    fs.writeFileSync(outputPath, fullText, "utf8");
    console.log(
      `✅ ${path.basename(pdfPath)} -> ${path.basename(outputPath)} (${pdf.numPages}ページ, ${fullText.length}文字)`,
    );
  } catch (error) {
    console.error(`❌ ${path.basename(pdfPath)}: エラー -`, error);
  }
}

async function processAllPdfs() {
  const pdfFiles = fs
    .readdirSync(pdfDir)
    .filter((file) => file.endsWith(".pdf"));

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`📁 ${pdfFiles.length}個のPDFファイルを処理します...\n`);

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(pdfDir, pdfFile);
    const txtFile = pdfFile.replace(".pdf", ".txt");
    const outputPath = path.join(outputDir, txtFile);

    await extractPdfText(pdfPath, outputPath);
  }

  console.log(`\n✨ 全${pdfFiles.length}ファイルの処理が完了しました！`);
}

processAllPdfs();

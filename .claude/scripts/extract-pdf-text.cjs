const fs = require("fs");
const pdfParse = require("pdf-parse");

const pdfPath = process.argv[2];
const outputPath = process.argv[3];

if (!pdfPath) {
  console.error("Usage: node extract-pdf-text.js <pdf-path> [output-path]");
  process.exit(1);
}

const dataBuffer = fs.readFileSync(pdfPath);

pdfParse(dataBuffer)
  .then(function (data) {
    const text = data.text;

    if (outputPath) {
      fs.writeFileSync(outputPath, text, "utf8");
      console.log(`テキストを抽出しました: ${outputPath}`);
      console.log(`ページ数: ${data.numpages}`);
      console.log(`文字数: ${text.length}`);
    } else {
      console.log(text);
    }
  })
  .catch(function (error) {
    console.error("PDF解析エラー:", error);
    process.exit(1);
  });

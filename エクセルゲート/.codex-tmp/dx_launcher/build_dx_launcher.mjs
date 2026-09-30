import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/tama2025mini/work/from_justcalc_to_html/outputs/dx_guide_excel_launcher";
const guideSource = "/Users/tama2025mini/work/ドキュメント作成html/DXプロジェクト8段階ガイド.html";
const dashboardSource = "/Users/tama2025mini/work/ドキュメント作成html/プロジェクト進捗ボード.html";
const guideName = "DXプロジェクト8段階ガイド.html";
const dashboardName = "プロジェクト進捗ボード.html";
const workbookName = "DXプロジェクト8段階ガイドを開く.xlsx";
const workbookPath = `${outputDir}/${workbookName}`;
const previewPath = "/Users/tama2025mini/work/from_justcalc_to_html/.codex-tmp/dx_launcher/preview.png";

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(guideSource, `${outputDir}/${guideName}`);
await fs.copyFile(dashboardSource, `${outputDir}/${dashboardName}`);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("ガイドを開く");
sheet.showGridLines = false;
sheet.tabColor = "#176B5B";

const fontFamily = "Arial";
const body = sheet.getRange("A1:G25");
body.format.fill = "#F3F1EB";
body.format.font = { name: fontFamily, size: 11, color: "#172B31" };
body.format.verticalAlignment = "center";

sheet.getRange("A1:A25").format.columnWidth = 3;
sheet.getRange("B1:B25").format.columnWidth = 15;
sheet.getRange("C1:C25").format.columnWidth = 15;
sheet.getRange("D1:D25").format.columnWidth = 15;
sheet.getRange("E1:E25").format.columnWidth = 15;
sheet.getRange("F1:F25").format.columnWidth = 15;
sheet.getRange("G1:G25").format.columnWidth = 3;

sheet.getRange("1:1").format.rowHeight = 12;
sheet.getRange("2:2").format.rowHeight = 28;
sheet.getRange("3:3").format.rowHeight = 22;
sheet.getRange("4:4").format.rowHeight = 10;
sheet.getRange("5:5").format.rowHeight = 18;
sheet.getRange("6:7").format.rowHeight = 28;
sheet.getRange("8:8").format.rowHeight = 10;
sheet.getRange("9:10").format.rowHeight = 21;
sheet.getRange("11:11").format.rowHeight = 12;
sheet.getRange("12:12").format.rowHeight = 25;
sheet.getRange("13:20").format.rowHeight = 24;
sheet.getRange("21:21").format.rowHeight = 12;
sheet.getRange("22:24").format.rowHeight = 22;

sheet.mergeCells("B2:F2");
sheet.getRange("B2").values = [["DXプロジェクト 8段階ガイド"]];
sheet.getRange("B2:F2").format.font = { name: fontFamily, size: 16, bold: true, color: "#19353A" };
sheet.getRange("B2:F2").format.horizontalAlignment = "left";

sheet.mergeCells("B3:F3");
sheet.getRange("B3").values = [["Excelから、ガイドを既定のブラウザで開きます。"]];
sheet.getRange("B3:F3").format.font = { name: fontFamily, size: 10, color: "#68777A", italic: true };

sheet.mergeCells("B5:F5");
sheet.getRange("B5").values = [["ガイドを開く"]];
sheet.getRange("B5:F5").format.font = { name: fontFamily, size: 10, bold: true, color: "#176B5B" };
sheet.getRange("B5:F5").format.borders = { bottom: { style: "thin", color: "#176B5B" } };

sheet.mergeCells("B6:F7");
sheet.getRange("B6").values = [["DXプロジェクト8段階ガイドをブラウザで開く"]];
sheet.getRange("B6:F7").format.fill = "#176B5B";
sheet.getRange("B6:F7").format.font = { name: fontFamily, size: 13, bold: true, color: "#FFFFFF", underline: "single" };
sheet.getRange("B6:F7").format.horizontalAlignment = "center";
sheet.getRange("B6:F7").format.verticalAlignment = "center";
sheet.getRange("B6:F7").format.borders = { preset: "outside", style: "medium", color: "#0F5145" };

sheet.mergeCells("B9:F9");
sheet.getRange("B9").values = [["使い方：上の緑色のリンクをクリックします。"]];
sheet.getRange("B9:F9").format.font = { name: fontFamily, size: 10, bold: true, color: "#172B31" };
sheet.mergeCells("B10:F10");
sheet.getRange("B10").values = [["確認画面が出た場合は、リンクを開く操作を許可してください。"]];
sheet.getRange("B10:F10").format.font = { name: fontFamily, size: 10, color: "#68777A" };

sheet.mergeCells("B12:F12");
sheet.getRange("B12").values = [["ガイドの8段階"]];
sheet.getRange("B12:F12").format.fill = "#19353A";
sheet.getRange("B12:F12").format.font = { name: fontFamily, size: 10, bold: true, color: "#FFFFFF" };
sheet.getRange("B12:F12").format.horizontalAlignment = "left";

const stages = [
  "自分の困りごとを見つける",
  "仲間を集め、現状分析シートを作る",
  "ステークホルダーインタビュー・改善シート1修正",
  "目標設定シートを作る",
  "MVPを作成",
  "miharaDBに実際に載せてみる",
  "ユーザーインタビューを行う",
  "実務実装する",
];

for (let index = 0; index < stages.length; index += 1) {
  const row = 13 + index;
  sheet.mergeCells(`B${row}:F${row}`);
  sheet.getRange(`B${row}`).values = [[`STEP ${index + 1}　${stages[index]}`]];
  const stageRange = sheet.getRange(`B${row}:F${row}`);
  stageRange.format.fill = index % 2 === 0 ? "#FFFEFB" : "#F8F7F2";
  stageRange.format.font = { name: fontFamily, size: 10, color: "#365457" };
  stageRange.format.borders = { bottom: { style: "thin", color: "#DCDED8" } };
}

sheet.mergeCells("B22:F23");
sheet.getRange("B22").values = [["このフォルダ内で使用してください。フォルダを移動した場合は、Excelのリンク先を更新してください。"]];
sheet.getRange("B22:F23").format.fill = "#FFF5EC";
sheet.getRange("B22:F23").format.font = { name: fontFamily, size: 10, color: "#8A4525" };
sheet.getRange("B22:F23").format.wrapText = true;
sheet.getRange("B22:F23").format.borders = { preset: "outside", style: "thin", color: "#E77742" };

sheet.mergeCells("B24:F24");
sheet.getRange("B24").values = [["同梱：Excel、ガイドHTML、ダッシュボードHTML"]];
sheet.getRange("B24:F24").format.font = { name: fontFamily, size: 9, color: "#68777A" };

workbook.recalculate();

const keyCheck = await workbook.inspect({
  kind: "table",
  range: "ガイドを開く!B2:F24",
  include: "values,formulas",
  tableMaxRows: 30,
  tableMaxCols: 8,
  maxChars: 12000,
});
console.log("KEY_CHECK");
console.log(keyCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log("ERROR_SCAN");
console.log(errors.ndjson);

const preview = await workbook.render({
  sheetName: "ガイドを開く",
  range: "A1:G25",
  scale: 2,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(workbookPath);
await fs.rm(`${workbookPath}.inspect.ndjson`, { force: true });
await fs.rm(`${outputDir}/preview.png`, { force: true });

console.log(JSON.stringify({
  outputDir,
  workbook: workbookPath,
  guide: `${outputDir}/${guideName}`,
  dashboard: `${outputDir}/${dashboardName}`,
  preview: previewPath,
}));

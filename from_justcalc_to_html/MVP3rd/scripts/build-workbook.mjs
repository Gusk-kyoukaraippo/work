import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outputDir = path.join(projectRoot, "workbook");
await fs.mkdir(outputDir, { recursive: true });

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("操作パネル");
sheet.showGridLines = false;

const ink = "#17324D";
const muted = "#52677A";
const line = "#CCD7E0";
const paleBlue = "#EDF4FA";

sheet.getRange("A1:O46").format.fill = "#F7F9FB";
sheet.getRange("A1:O46").format.font = { name: "Yu Gothic UI", size: 11, color: ink };
sheet.getRange("A1:A46").format.columnWidth = 3;
sheet.getRange("O1:O46").format.columnWidth = 3;
for (const column of "BCDEFGHIJKLMN") sheet.getRange(`${column}:${column}`).format.columnWidth = 10;

sheet.getRange("B2:N2").merge();
sheet.getRange("B2").values = [["MVP3  一時保存・正式保存"]];
sheet.getRange("B2:N2").format = {
  fill: "#FFFFFF",
  font: { name: "Yu Gothic UI", size: 22, bold: true, color: ink },
  horizontalAlignment: "left",
  verticalAlignment: "center",
  rowHeight: 36
};

sheet.getRange("B3:N3").merge();
sheet.getRange("B3").values = [[""]];
sheet.getRange("B3:N3").format = {
  fill: "#F7F9FB",
  font: { name: "Yu Gothic UI", size: 11, bold: true, color: ink },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  rowHeight: 25
};

sheet.getRange("B4:N6").merge();
sheet.getRange("B4").values = [["正式保存の記録はありません\n\n「編集する」から作業を始めてください。"]];
sheet.getRange("B4:N6").format = {
  fill: "#FFF5CC",
  font: { name: "Yu Gothic UI", size: 14, bold: true, color: ink },
  borders: { preset: "all", style: "medium", color: "#D9B84A" },
  wrapText: true,
  horizontalAlignment: "left",
  verticalAlignment: "center",
  rowHeight: 31
};

sheet.getRange("B7:N7").merge();
sheet.getRange("B7").values = [[""]];
sheet.getRange("B7:N7").format = {
  fill: "#F7F9FB",
  font: { name: "Yu Gothic UI", size: 9, color: muted },
  horizontalAlignment: "left",
  verticalAlignment: "center",
  rowHeight: 22
};

function card(range, title, message) {
  const [top, body] = range;
  sheet.getRange(top).merge();
  sheet.getRange(top.split(":")[0]).values = [[title]];
  sheet.getRange(top).format = {
    fill: paleBlue,
    font: { name: "Yu Gothic UI", size: 13, bold: true, color: ink },
    borders: { preset: "all", style: "thin", color: line },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    rowHeight: 26
  };
  sheet.getRange(body).merge();
  sheet.getRange(body.split(":")[0]).values = [[message]];
  sheet.getRange(body).format = {
    fill: "#FFFFFF",
    font: { name: "Yu Gothic UI", size: 12, color: ink },
    borders: { preset: "all", style: "thin", color: line },
    wrapText: true,
    horizontalAlignment: "left",
    verticalAlignment: "center",
    rowHeight: 25
  };
}

card(["B10:N10", "B11:N15"], "正式保存：最新版", "正式保存の記録はありません");

sheet.getRange("B18:N18").merge();
sheet.getRange("B18").values = [["通常の操作（上から順に進みます）"]];
sheet.getRange("B18:N18").format = {
  fill: "#F7F9FB",
  font: { name: "Yu Gothic UI", size: 14, bold: true, color: ink },
  verticalAlignment: "center"
};

function button(range, label, color, fontSize = 11) {
  sheet.getRange(range).merge();
  sheet.getRange(range.split(":")[0]).values = [[label]];
  sheet.getRange(range).format = {
    fill: color,
    font: { name: "Yu Gothic UI", size: fontSize, bold: true, color: "#FFFFFF" },
    borders: { preset: "outside", style: "thin", color },
    wrapText: true,
    horizontalAlignment: "center",
    verticalAlignment: "center",
    rowHeight: 26
  };
}

button("B20:G22", "閲覧する", "#5B748B");
button("H20:N22", "編集する", "#1769AA");
button("B24:N26", "一時保存ファイルをExcelに正式保存する", "#147A55", 10);
button("B28:N30", "終了する", "#4A5663", 12);

sheet.getRange("B33:N37").merge();
sheet.getRange("B33").values = [["数字やデータはこのExcelへ直接入力しません。HTMLで作業終了用の一時保存ファイルを作成した後、「一時保存ファイルをExcelに正式保存する」を押してください。\n\nPCの「ダウンロード」には一時保存ファイル（JSON）が残ります。正式保存完了後、削除目安を過ぎた本アプリのファイルだけを整理してください。"]];
sheet.getRange("B33:N37").format = {
  fill: "#F2F6F9",
  font: { name: "Yu Gothic UI", size: 11, color: muted },
  borders: { preset: "all", style: "thin", color: "#D7E0E8" },
  wrapText: true,
  horizontalAlignment: "left",
  verticalAlignment: "center",
  rowHeight: 25
};

sheet.getRange("B40:N40").merge();
sheet.getRange("B40").values = [["管理者用（通常の利用者は操作不要）"]];
sheet.getRange("B40:N40").format = {
  fill: "#F7F9FB",
  font: { name: "Yu Gothic UI", size: 10, bold: true, color: "#5B748B" },
  horizontalAlignment: "left",
  verticalAlignment: "center"
};
button("B42:F44", "ログチェック（管理者向け）", "#5B748B", 10);

sheet.freezePanes.freezeRows(2);

const workbookPath = path.join(outputDir, "MVP3rd-operation-panel-template.xlsx");
const previewPath = path.join(outputDir, "MVP3rd-operation-panel-preview.png");
const readOnlyPreviewPath = path.join(outputDir, "MVP3rd-operation-panel-readonly-preview.png");
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(workbookPath);
const preview = await workbook.render({ sheetName: "操作パネル", range: "A1:O46", scale: 1.3, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const readOnlyWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const readOnlySheet = readOnlyWorkbook.worksheets.getItem("操作パネル");
readOnlySheet.getRange("A1:O46").format.fill = "#F7F9FB";
readOnlySheet.getRange("B2:N2").format.fill = "#FFFFFF";
readOnlySheet.getRange("B4:N6").format.fill = "#FFF5CC";
readOnlySheet.getRange("B7:N7").format.fill = "#F7F9FB";
readOnlySheet.getRange("B10:N10").format.fill = paleBlue;
readOnlySheet.getRange("B11:N15").format.fill = "#FFFFFF";
readOnlySheet.getRange("B20:G22").format.fill = "#5B748B";
readOnlySheet.getRange("B28:N30").format.fill = "#4A5663";
readOnlySheet.getRange("B33:N37").format.fill = "#F2F6F9";
readOnlySheet.getRange("B42:F44").format.fill = "#5B748B";
readOnlySheet.getRange("B3").values = [["このExcelは読み取り専用で開いています。閲覧のみ利用できます。"]];
readOnlySheet.getRange("B3:N3").format = {
  fill: "#5B748B",
  font: { name: "Yu Gothic UI", size: 11, bold: true, color: "#FFFFFF" },
  borders: { preset: "all", style: "thin", color: "#485C6E" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  rowHeight: 25
};
readOnlySheet.getRange("B4").values = [["正式保存の記録はありません\n\nこのExcelでは閲覧だけできます。"]];
readOnlySheet.getRange("B33").values = [["通常利用者は「閲覧する」を利用してください。「ログチェック（管理者向け）」は管理者確認用のため、通常は操作不要です。"]];
for (const disabledRange of ["H20:N22", "B24:N26"]) {
  readOnlySheet.getRange(disabledRange).format.fill = "#AEB8C1";
}
const readOnlyPreview = await readOnlyWorkbook.render({ sheetName: "操作パネル", range: "A1:O46", scale: 1.3, format: "png" });
await fs.writeFile(readOnlyPreviewPath, new Uint8Array(await readOnlyPreview.arrayBuffer()));

const inspection = await workbook.inspect({
  kind: "sheet,region",
  sheetId: "操作パネル",
  range: "B2:N44",
  maxChars: 5000,
  tableMaxRows: 44,
  tableMaxCols: 14
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 2000
});
console.log(inspection.ndjson);
console.log(formulaErrors.ndjson);
console.log(JSON.stringify({ workbookPath, previewPath, readOnlyPreviewPath }));

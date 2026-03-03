#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HEADERS = [
  "Доп. объявление",
  "Название группы",
  "Фраза (с минус-словами)",
  "Тип объявления",
  "Заголовок 1",
  "Заголовок 2",
  "Текст",
  "Ссылка",
  "Регион",
  "Ставка",
  "Заголовки быстрых ссылок",
  "Описания быстрых ссылок",
  "Адреса быстрых ссылок",
  "Уточнения"
];

const ALIASES = {
  additional_ad: "Доп. объявление",
  group: "Название группы",
  group_name: "Название группы",
  phrase: "Фраза (с минус-словами)",
  keyword: "Фраза (с минус-словами)",
  ad_type: "Тип объявления",
  title1: "Заголовок 1",
  title2: "Заголовок 2",
  text: "Текст",
  description: "Текст",
  url: "Ссылка",
  region: "Регион",
  bid: "Ставка",
  sitelink_titles: "Заголовки быстрых ссылок",
  sitelink_descriptions: "Описания быстрых ссылок",
  sitelink_urls: "Адреса быстрых ссылок",
  clarifications: "Уточнения"
};

const COLUMN_LETTERS = "ABCDEFGHIJKLMN".split("");

function usage() {
  console.log(`Usage:
  node scripts/build_direct_xlsx.mjs --input <rows.json> --output <result.xlsx>
  [--template <template.xlsx>]

Input JSON can be:
  - {"rows":[{...}, {...}]}
  - [{...}, {...}]

Each row can be:
  - object with Russian header names
  - object with alias keys (title1, text, group_name, etc.)
  - array of 14 values (A:N order)`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    i += 1;
  }
  return parsed;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function normalizeRow(row, rowIndex) {
  if (Array.isArray(row)) {
    const values = [];
    for (let i = 0; i < HEADERS.length; i += 1) {
      values.push(normalizeCellValue(row[i]));
    }
    return values;
  }

  if (typeof row !== "object" || row === null) {
    throw new Error(`Row ${rowIndex + 1} must be an object or array`);
  }

  const values = [];
  for (const header of HEADERS) {
    let value = row[header];
    if (value === undefined) {
      const aliasEntry = Object.entries(ALIASES).find(([, h]) => h === header);
      if (aliasEntry) {
        const [alias] = aliasEntry;
        value = row[alias];
      }
    }
    values.push(normalizeCellValue(value));
  }
  return values;
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildTextNode(value) {
  const escaped = escapeXml(value);
  if (value.startsWith(" ") || value.endsWith(" ")) {
    return `<t xml:space="preserve">${escaped}</t>`;
  }
  return `<t>${escaped}</t>`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["--help"] || !args["--input"] || !args["--output"]) {
    usage();
    process.exit(args["--help"] ? 0 : 1);
  }

  const inputPath = resolve(String(args["--input"]));
  const outputPath = resolve(String(args["--output"]));
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultTemplatePath = resolve(scriptDir, "..", "assets", "direct-commander-template.xlsx");
  const templatePath = args["--template"]
    ? resolve(String(args["--template"]))
    : defaultTemplatePath;

  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(raw) ? raw : raw.rows;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Input JSON must contain non-empty rows array");
  }

  const normalizedRows = rows.map((row, index) => normalizeRow(row, index));

  const strings = [];
  const stringIndex = new Map();

  function getSharedStringIndex(value) {
    if (!stringIndex.has(value)) {
      stringIndex.set(value, strings.length);
      strings.push(value);
    }
    return stringIndex.get(value);
  }

  function buildRowXml(rowNumber, values) {
    const cells = values
      .map((value, colIndex) => {
        const idx = getSharedStringIndex(value);
        return `<c r="${COLUMN_LETTERS[colIndex]}${rowNumber}" t="s"><v>${idx}</v></c>`;
      })
      .join("");
    return `<row r="${rowNumber}" spans="1:14" x14ac:dyDescent="0.25">${cells}</row>`;
  }

  const headerRowXml = buildRowXml(1, HEADERS);
  const bodyRowsXml = normalizedRows
    .map((values, i) => buildRowXml(i + 2, values))
    .join("");
  const maxRow = normalizedRows.length + 1;

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ` +
    `mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">` +
    `<dimension ref="A1:N${maxRow}"/>` +
    `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="0" outlineLevelCol="0" x14ac:dyDescent="55"/>` +
    `<sheetData>${headerRowXml}${bodyRowsXml}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="portrait" horizontalDpi="4294967295" verticalDpi="4294967295" scale="100" fitToWidth="1" fitToHeight="1"/>` +
    `</worksheet>`;

  const sharedStringsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `count="${(normalizedRows.length + 1) * HEADERS.length}" uniqueCount="${strings.length}">` +
    strings.map((value) => `<si>${buildTextNode(value)}</si>`).join("") +
    `</sst>`;

  const workDir = mkdtempSync(join(tmpdir(), "direct-xlsx-"));
  try {
    execFileSync("unzip", ["-oq", templatePath, "-d", workDir], { stdio: "pipe" });
    writeFileSync(join(workDir, "xl", "sharedStrings.xml"), sharedStringsXml, "utf8");
    writeFileSync(join(workDir, "xl", "worksheets", "sheet1.xml"), sheetXml, "utf8");

    mkdirSync(dirname(outputPath), { recursive: true });
    rmSync(outputPath, { force: true });
    execFileSync("zip", ["-qr", outputPath, "."], { cwd: workDir, stdio: "pipe" });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`Created: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}

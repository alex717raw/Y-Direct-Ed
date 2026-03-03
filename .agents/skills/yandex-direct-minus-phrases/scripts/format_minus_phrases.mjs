#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
format_minus_phrases.mjs — привести список минус-фраз к строке "через запятую" + выделить прогрев

Usage:
  node scripts/format_minus_phrases.mjs --in <file> [--out <dir>]

Input:
  - Строки, либо "через запятую/точку с запятой", либо markdown-списки.

Output:
  - all: 1 строка через запятую
  - hard: без прогрева
  - warm: прогревные (отдельно)
`.trim());
}

function normalizeSpaces(s) {
  return s.replaceAll("\u00A0", " ").replace(/\s+/g, " ").trim();
}

function normalizeForDedup(s) {
  return normalizeSpaces(s).toLowerCase().replaceAll("ё", "е");
}

function stripMarkdownBullet(s) {
  return s.replace(/^[-*]\s+/, "");
}

function stripLeadingMinusOperator(s) {
  // В поле минус-фраз Директа ведущий "-" обычно не нужен; убираем его, если он именно "оператор".
  const t = s.trimStart();
  if (t.startsWith("-") && t.length > 1) {
    const next = t[1];
    if (/[\p{L}\d"\[\+!]/u.test(next)) return t.slice(1).trimStart();
  }
  return s.trim();
}

function parsePhrases(raw) {
  const out = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    let t = normalizeSpaces(stripMarkdownBullet(line));
    if (!t) continue;

    // allow comma/semicolon-separated lists
    const parts = t.split(/[;,]/).map((p) => normalizeSpaces(p)).filter(Boolean);
    for (const p of parts) {
      const cleaned = normalizeSpaces(stripLeadingMinusOperator(p));
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

const WARM_PATTERNS = [
  /отзыв/iu,
  /обзор/iu,
  /форум/iu,
  /сравн/iu,
  /рейтинг/iu,
  /(?<![\p{L}\p{N}_])vs(?![\p{L}\p{N}_])/i,
  /(?<![\p{L}\p{N}_])топ(?![\p{L}\p{N}_])/iu,
  /как выбрать/iu,
  /как сделать/iu,
  /как установить/iu,
  /как собрать/iu,
  /как подключить/iu,
  /инструкц/iu,
  /своими руками/iu,
  /чертеж/iu,
  /схем/iu,
  /фото/iu,
  /картинк/iu,
  /видео/iu,
  /скачать/iu,
  /(?<![\p{L}\p{N}_])pdf(?![\p{L}\p{N}_])/i,
  /что лучше/iu,
  /лучши/iu,
];

function isWarm(phrase) {
  const p = normalizeForDedup(phrase);
  return WARM_PATTERNS.some((re) => re.test(p));
}

function joinComma(list) {
  return list.join(", ");
}

function dedupeKeepOrder(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalizeForDedup(item);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown arg: ${a} (use --help)`);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let raw = "";
  if (args.in) {
    const inPath = path.resolve(args.in);
    if (!fs.existsSync(inPath)) throw new Error(`File not found: ${inPath}`);
    raw = fs.readFileSync(inPath, "utf8");
  } else {
    // stdin fallback
    raw = fs.readFileSync(0, "utf8");
  }

  const parsed = dedupeKeepOrder(parsePhrases(raw));
  const warm = parsed.filter(isWarm);
  const hard = parsed.filter((p) => !isWarm(p));

  const result = {
    counts: { total: parsed.length, hard: hard.length, warm: warm.length },
    all: joinComma(parsed),
    hard: joinComma(hard),
    warm: joinComma(warm),
  };

  if (args.out) {
    const outDir = path.resolve(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "minus_phrases_all.txt"), result.all, "utf8");
    fs.writeFileSync(path.join(outDir, "minus_phrases_hard.txt"), result.hard, "utf8");
    fs.writeFileSync(path.join(outDir, "minus_phrases_warm.txt"), result.warm, "utf8");
    fs.writeFileSync(path.join(outDir, "minus_phrases_counts.json"), JSON.stringify(result.counts, null, 2), "utf8");
    result.outDir = outDir;
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(e?.stack ?? String(e));
  process.exit(1);
}

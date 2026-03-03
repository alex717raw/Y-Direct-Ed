#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
validate_minus_phrases.mjs — проверить минус-фразы (слова/лимиты/дубли)

Usage:
  node scripts/validate_minus_phrases.mjs --in <file> [--level group|campaign|master-site|master-app]

Notes:
  - По Директу: ≤ 7 слов на одну минус-фразу.
  - Ограничение по символам (без пробелов) зависит от места ввода (группа/кампания/мастер).
  - В минус-фразах допускаются только буквы/цифры/пробел и операторы: + - ! " [ ] (точка — только в десятичных дробях).
`.trim());
}

function normalizeToken(t) {
  return t.toLowerCase().replaceAll("ё", "е");
}

function stripLeadingMinusOperator(phrase) {
  // В поле минус-фраз ведущий "-" часто не нужен; убираем его, если он именно "оператор".
  const t = phrase.trimStart();
  if (t.startsWith("-") && t.length > 1) {
    const next = t[1];
    if (/[\p{L}\d"\[\+!]/u.test(next)) return t.slice(1).trimStart();
  }
  return phrase.trim();
}

function stripOuterOperators(phrase) {
  let p = stripLeadingMinusOperator(phrase);
  if (p.startsWith("-")) p = p.slice(1).trim();
  if (p.startsWith("[")) p = p.slice(1);
  if (p.endsWith("]")) p = p.slice(0, -1);
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
  return p.trim();
}

function estimateWordCount(phrase) {
  let p = stripOuterOperators(phrase);
  p = p.replaceAll("+", "");
  p = p.replaceAll("!", "");
  p = p.replace(/\s+/g, " ").trim();
  if (!p) return 0;
  return p.split(" ").filter(Boolean).length;
}

function hasBalancedPairs(s, open, close) {
  let depth = 0;
  for (const ch of s) {
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function validateAllowedCharsAndOperators(phrase) {
  const errors = [];
  const warnings = [];

  const p = stripLeadingMinusOperator(phrase);

  // Basic pair checks
  const quoteCount = [...p].filter((ch) => ch === '"').length;
  if (quoteCount % 2 !== 0) errors.push(`Unbalanced quotes (\")`);
  if (!hasBalancedPairs(p, "[", "]")) errors.push("Unbalanced brackets ([ ])");

  // Allowed characters
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (/[\p{L}\p{N}\s]/u.test(ch)) continue;
    if (ch === "-" || ch === "+" || ch === "!" || ch === '"' || ch === "[" || ch === "]" || ch === ".") continue;
    // Common invisible/typographic chars
    if (ch === "\u00A0") {
      warnings.push("Contains NBSP (non-breaking space) — replace with regular space");
      continue;
    }
    errors.push(`Forbidden character "${ch}" (U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})`);
  }

  // Dot is allowed only inside decimal fractions: 1.5, 10.25, etc.
  for (let i = 0; i < p.length; i++) {
    if (p[i] !== ".") continue;
    const prev = p[i - 1] ?? "";
    const next = p[i + 1] ?? "";
    if (!/\d/.test(prev) || !/\d/.test(next)) errors.push('Dot "." allowed only in decimal fractions (e.g., 1.5)');
  }

  // "+" and "!" must be a prefix operator for a word token: "+в", "!москву"
  const prefixOps = ["+", "!"];
  for (const op of prefixOps) {
    for (let i = 0; i < p.length; i++) {
      if (p[i] !== op) continue;
      const prev = p[i - 1] ?? "";
      const next = p[i + 1] ?? "";

      const prevOk = i === 0 || /\s/.test(prev) || prev === "[" || prev === '"';
      if (!prevOk) errors.push(`Operator "${op}" must start a token (use "${op}слово", not "слово${op}" or "сло${op}во")`);

      const nextOk = /[\p{L}\p{N}]/u.test(next);
      if (!nextOk) errors.push(`Operator "${op}" must be immediately followed by a word (use "${op}слово")`);
    }
  }

  // Soft hint: in minus-phrases, Direct supports only "+ ! [] \"\"" as operators (parentheses/pipe often break).
  if (/[()|]/.test(p)) errors.push('Operators "() |" are not allowed in minus-phrases');

  return { errors, warnings };
}

function normalizeForDup(phrase) {
  let p = stripOuterOperators(phrase);
  p = normalizeToken(p);
  p = p.replace(/\s+/g, " ").trim();
  return p;
}

function parsePhrases(raw) {
  const lines = raw.split(/\r?\n/);
  const parts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // allow comma/semicolon-separated lists
    for (const p of trimmed.split(/[;,]/)) {
      const t = p.trim();
      if (t) parts.push(t);
    }
  }
  return parts;
}

function getLimits(level) {
  const base = {
    maxWordsPerPhrase: 7,
    maxCharsNoSpaces: 4096,
    maxPhrases: 1_000_000,
  };

  if (level === "campaign") return { ...base, maxCharsNoSpaces: 20_000 };
  if (level === "master-site") return { ...base, maxCharsNoSpaces: 20_000 };
  if (level === "master-app") return { ...base, maxCharsNoSpaces: 20_000, maxPhrases: 200 };
  return base; // group / unknown
}

function main() {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--in") args.in = argv[++i];
    else if (a === "--level") args.level = argv[++i];
    else throw new Error(`Unknown arg: ${a} (use --help)`);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (!args.in) {
    printHelp();
    throw new Error("Missing --in <file>");
  }

  const inPath = path.resolve(args.in);
  if (!fs.existsSync(inPath)) throw new Error(`File not found: ${inPath}`);

  const raw = fs.readFileSync(inPath, "utf8");
  const phrases = parsePhrases(raw);
  const limits = getLimits(args.level);

  const errors = [];
  const warnings = [];

  if (phrases.length === 0) errors.push("No phrases found (file is empty?)");
  if (phrases.length > limits.maxPhrases) errors.push(`Too many phrases: ${phrases.length} > ${limits.maxPhrases} (level=${args.level})`);

  const dupMap = new Map();
  for (const p of phrases) {
    const wc = estimateWordCount(p);
    if (wc > limits.maxWordsPerPhrase) errors.push(`Too many words (${wc}): ${p}`);
    if (wc === 0) warnings.push(`Empty after normalization: ${p}`);

    const v = validateAllowedCharsAndOperators(p);
    for (const e of v.errors) errors.push(`${e}: ${p}`);
    for (const w of v.warnings) warnings.push(`${w}: ${p}`);

    const key = normalizeForDup(p);
    if (!key) continue;
    const prev = dupMap.get(key);
    if (prev) warnings.push(`Duplicate: "${prev}" == "${p}"`);
    else dupMap.set(key, p);
  }

  // Total field length check: join phrases with commas, remove spaces
  const joined = phrases.join(",");
  const totalCharsNoSpaces = joined.replace(/\s+/g, "").length;
  if (totalCharsNoSpaces > limits.maxCharsNoSpaces) {
    errors.push(`Total length too large (no spaces): ${totalCharsNoSpaces} > ${limits.maxCharsNoSpaces} (level=${args.level ?? "group/campaign"})`);
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        file: inPath,
        level: args.level ?? "group/campaign",
        phrases: phrases.length,
        unique: dupMap.size,
        totalCharsNoSpaces,
        limits,
        errors,
        warnings,
      },
      null,
      2,
    ),
  );

  process.exit(errors.length ? 1 : 0);
}

try {
  main();
} catch (e) {
  // eslint-disable-next-line no-console
  console.error(e?.stack ?? String(e));
  process.exit(1);
}

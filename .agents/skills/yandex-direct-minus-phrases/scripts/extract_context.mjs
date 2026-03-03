#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const RU_STOPWORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "по",
  "к",
  "ко",
  "от",
  "до",
  "за",
  "под",
  "над",
  "с",
  "со",
  "у",
  "о",
  "об",
  "про",
  "для",
  "без",
  "при",
  "через",
  "перед",
  "после",
  "между",
  "из",
  "не",
  "нет",
  "или",
  "а",
  "но",
  "как",
  "что",
  "это",
  "то",
  "же",
  "бы",
  "ли",
  "мы",
  "вы",
  "они",
  "он",
  "она",
  "оно",
  "я",
  "мне",
  "моя",
  "мой",
  "ваш",
  "ваша",
  "ваше",
  "ваши",
  "наш",
  "наша",
  "наше",
  "наши",
]);

const RU_PREPOSITIONS = new Set([
  "в",
  "во",
  "на",
  "по",
  "к",
  "ко",
  "от",
  "до",
  "за",
  "под",
  "над",
  "с",
  "со",
  "у",
  "о",
  "об",
  "про",
  "для",
  "без",
  "при",
  "через",
  "перед",
  "после",
  "между",
  "из",
]);

const WORD_RE = /[a-zа-яё0-9]+(?:[/-][a-zа-яё0-9]+)*/giu;
const SIZE_RE = /\b\d{2,4}[xх]\d{2,4}\b/giu;

function printHelp() {
  // eslint-disable-next-line no-console
  console.log(`
extract_context.mjs — извлечь тексты из объявлений/сайта/списков и собрать context.md

Usage:
  node scripts/extract_context.mjs --ads <file> [--site <url-or-path> ...] [--keywords <file> ...] [--out <dir>]

Examples:
  node scripts/extract_context.mjs --ads ./Directtext_dush_kab.csv --site https://example.com --out ./minus_phrases_ctx
  node scripts/extract_context.mjs --ads ./ads.csv --site ./saved-page.html --keywords ./keywords.txt
`.trim());
}

function normalizeText(s) {
  return s.replaceAll("\u00A0", " ").replace(/\s+/g, " ").trim();
}

function normalizeToken(t) {
  return t.toLowerCase().replaceAll("ё", "е");
}

function tokenize(text) {
  const matches = text.match(WORD_RE);
  if (!matches) return [];
  return matches.map((t) => normalizeToken(t));
}

function inc(map, key, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topEntries(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function decodeBasicEntities(html) {
  return html
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'");
}

function htmlToText(html) {
  let out = html;
  out = out.replace(/<script[\s\S]*?<\/script>/gi, " ");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, " ");
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  out = out.replace(/<[^>]+>/g, " ");
  out = decodeBasicEntities(out);
  return normalizeText(out);
}

function sniffDelimiter(headerLine) {
  const counts = {
    ",": (headerLine.match(/,/g) ?? []).length,
    ";": (headerLine.match(/;/g) ?? []).length,
    "\t": (headerLine.match(/\t/g) ?? []).length,
  };
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best?.[1] > 0 ? best[0] : ",";
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells;
}

async function readLines(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

function addTextToStats(text, stats, sizesMap) {
  const t = normalizeText(text);
  if (!t) return;

  const sizes = t.match(SIZE_RE) ?? [];
  for (const s of sizes) inc(sizesMap, normalizeToken(s));

  const tokens = tokenize(t);
  if (tokens.length === 0) return;

  for (const token of tokens) {
    inc(stats.tokensAll, token);
    if (!RU_STOPWORDS.has(token)) inc(stats.tokensNoStop, token);
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (RU_PREPOSITIONS.has(a)) inc(stats.prepBigrams, `${a} ${b}`);
  }
  for (let i = 0; i < tokens.length - 2; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const c = tokens[i + 2];
    if (RU_PREPOSITIONS.has(b)) inc(stats.xPrepYTrigrams, `${a} ${b} ${c}`);
  }
}

async function processAdsFile(adsPath, outDir, stats, warnings) {
  const ext = path.extname(adsPath).toLowerCase();
  const outFile = path.join(outDir, "ads_text.txt");
  const w = fs.createWriteStream(outFile, { encoding: "utf8" });
  let lineNum = 0;
  let delimiter = ",";

  if (!fs.existsSync(adsPath)) throw new Error(`Ads file not found: ${adsPath}`);

  if (ext === ".csv" || ext === ".tsv") {
    await readLines(adsPath, (line) => {
      lineNum++;
      if (lineNum === 1) {
        delimiter = ext === ".tsv" ? "\t" : sniffDelimiter(line);
        return; // skip header
      }

      const cells = splitCsvLine(line, delimiter);
      for (const rawCell of cells) {
        const cell = normalizeText(String(rawCell ?? ""));
        if (!cell) continue;
        if (!/[A-Za-zА-Яа-яЁё]/.test(cell)) continue;

        // split multi-value fields like "a||b||c"
        const parts = cell.split("||").map((p) => normalizeText(p)).filter(Boolean);
        for (const part of parts) {
          w.write(part + "\n");
          addTextToStats(part, stats.ads, stats.sizes);
          stats.adsLines++;
        }
      }
      stats.adsRows++;
    });
  } else {
    warnings.push(`Ads file extension "${ext || "(none)"}" — treating as plain text`);
    const text = fs.readFileSync(adsPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const t = normalizeText(line);
      if (!t) continue;
      w.write(t + "\n");
      addTextToStats(t, stats.ads, stats.sizes);
      stats.adsLines++;
    }
  }

  await new Promise((resolve) => w.end(resolve));
  return outFile;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "codex-minus-phrases-context/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function processSiteInputs(siteInputs, outDir, stats, warnings) {
  const outFile = path.join(outDir, "site_text.txt");
  const w = fs.createWriteStream(outFile, { encoding: "utf8" });

  for (const item of siteInputs) {
    const input = String(item ?? "").trim();
    if (!input) continue;

    let raw = "";
    try {
      if (/^https?:\/\//i.test(input)) raw = await fetchWithTimeout(input, 15_000);
      else raw = fs.readFileSync(input, "utf8");
    } catch (e) {
      warnings.push(`Site input failed (${input}): ${e?.message ?? String(e)}`);
      continue;
    }

    const text = /<\/?[a-z][\s\S]*>/i.test(raw) ? htmlToText(raw) : normalizeText(raw);
    if (!text) continue;

    w.write(`# Source: ${input}\n`);
    // Write in readable chunks
    const chunkSize = 180;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize).trim();
      if (!chunk) continue;
      w.write(chunk + "\n");
      addTextToStats(chunk, stats.site, stats.sizes);
      stats.siteLines++;
    }
    w.write("\n");
    stats.siteSources++;
  }

  await new Promise((resolve) => w.end(resolve));
  return outFile;
}

async function processKeywordFiles(keywordFiles, outDir, stats, warnings) {
  const outFile = path.join(outDir, "keywords_text.txt");
  const w = fs.createWriteStream(outFile, { encoding: "utf8" });

  for (const filePath of keywordFiles) {
    const p = String(filePath ?? "").trim();
    if (!p) continue;
    if (!fs.existsSync(p)) {
      warnings.push(`Keywords file not found: ${p}`);
      continue;
    }
    const text = fs.readFileSync(p, "utf8");
    w.write(`# Source: ${p}\n`);
    for (const line of text.split(/\r?\n/)) {
      const t = normalizeText(line);
      if (!t) continue;
      w.write(t + "\n");
      addTextToStats(t, stats.keywords, stats.sizes);
      stats.keywordLines++;
    }
    w.write("\n");
    stats.keywordSources++;
  }

  await new Promise((resolve) => w.end(resolve));
  return outFile;
}

function renderContextMd(args, stats, warnings, outDir) {
  const mdPath = path.join(outDir, "context.md");
  const now = new Date().toISOString();

  const lines = [];
  lines.push(`# Campaign context (minus-phrases)\n`);
  lines.push(`Generated: \`${now}\``);
  lines.push("");
  lines.push("## Inputs");
  if (args.ads) lines.push(`- Ads file: \`${args.ads}\``);
  if (args.site.length) lines.push(`- Site: ${args.site.map((s) => `\`${s}\``).join(", ")}`);
  if (args.keywords.length) lines.push(`- Keywords files: ${args.keywords.map((s) => `\`${s}\``).join(", ")}`);
  lines.push("");

  lines.push("## Stats");
  lines.push(`- Ads: rows=${stats.adsRows}, lines=${stats.adsLines}`);
  lines.push(`- Site: sources=${stats.siteSources}, lines=${stats.siteLines}`);
  lines.push(`- Keywords: sources=${stats.keywordSources}, lines=${stats.keywordLines}`);
  lines.push("");

  const topN = 40;
  const renderTop = (title, map) => {
    lines.push(`### ${title}`);
    const top = topEntries(map, topN);
    if (top.length === 0) {
      lines.push("_No data_");
      lines.push("");
      return;
    }
    lines.push(top.map(([k, v]) => `- ${k}: ${v}`).join("\n"));
    lines.push("");
  };

  renderTop("Top tokens (ads, no stopwords)", stats.ads.tokensNoStop);
  renderTop("Top tokens (site, no stopwords)", stats.site.tokensNoStop);
  if (stats.keywords.tokensNoStop.size) renderTop("Top tokens (keywords, no stopwords)", stats.keywords.tokensNoStop);

  const renderPrep = (title, map) => {
    lines.push(`### ${title}`);
    const top = topEntries(map, 30);
    if (top.length === 0) {
      lines.push("_No data_");
      lines.push("");
      return;
    }
    lines.push(top.map(([k, v]) => `- ${k}: ${v}`).join("\n"));
    lines.push("");
  };

  renderPrep("Preposition bigrams (ads): for operator + checks", stats.ads.prepBigrams);
  renderPrep("X + preposition + Y trigrams (ads): candidate patterns", stats.ads.xPrepYTrigrams);
  renderPrep("Preposition bigrams (site): for operator + checks", stats.site.prepBigrams);
  renderPrep("X + preposition + Y trigrams (site): candidate patterns", stats.site.xPrepYTrigrams);

  lines.push("### Sizes / dimensions (ads + site)");
  const sizesTop = topEntries(stats.sizes, 40);
  if (sizesTop.length === 0) lines.push("_No data_");
  else lines.push(sizesTop.map(([k, v]) => `- ${k}: ${v}`).join("\n"));
  lines.push("");

  if (warnings.length) {
    lines.push("## Warnings");
    lines.push(warnings.map((w) => `- ${w}`).join("\n"));
    lines.push("");
  }

  lines.push("## Next");
  lines.push("- Используй этот контекст вместе с файлами из `references/` и интернет-источниками, чтобы собрать минус-фразы.");
  lines.push("- Особое внимание удели конструкциям с предлогами (*для/из/с/без/по/на*) — часто нужен оператор `+`.");
  lines.push("");

  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
  return mdPath;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = { site: [], keywords: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--ads") args.ads = argv[++i];
    else if (a === "--site") args.site.push(argv[++i]);
    else if (a === "--keywords") args.keywords.push(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown arg: ${a} (use --help)`);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.ads && args.site.length === 0 && args.keywords.length === 0) {
    printHelp();
    throw new Error("Provide at least one input: --ads and/or --site and/or --keywords");
  }

  const outDir = path.resolve(args.out || "./minus_phrases_context");
  fs.mkdirSync(outDir, { recursive: true });

  const warnings = [];
  const stats = {
    adsRows: 0,
    adsLines: 0,
    siteSources: 0,
    siteLines: 0,
    keywordSources: 0,
    keywordLines: 0,
    sizes: new Map(),
    ads: { tokensAll: new Map(), tokensNoStop: new Map(), prepBigrams: new Map(), xPrepYTrigrams: new Map() },
    site: { tokensAll: new Map(), tokensNoStop: new Map(), prepBigrams: new Map(), xPrepYTrigrams: new Map() },
    keywords: { tokensAll: new Map(), tokensNoStop: new Map(), prepBigrams: new Map(), xPrepYTrigrams: new Map() },
  };

  const written = [];
  if (args.ads) written.push(await processAdsFile(path.resolve(args.ads), outDir, stats, warnings));
  if (args.site.length) written.push(await processSiteInputs(args.site, outDir, stats, warnings));
  if (args.keywords.length) written.push(await processKeywordFiles(args.keywords, outDir, stats, warnings));

  const mdPath = renderContextMd(args, stats, warnings, outDir);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ outDir, files: [...written.map((p) => path.relative(process.cwd(), p)), path.relative(process.cwd(), mdPath)] }, null, 2));
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e?.stack ?? String(e));
  process.exit(1);
});

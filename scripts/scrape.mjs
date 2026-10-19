#!/usr/bin/env node
/**
 * Scrape OpenCode Go usage limits + Artificial Analysis Intelligence Index.
 *
 * Sources:
 *   https://opencode.ai/v2/docs/console/go/       (server-rendered HTML tables)
 *   https://artificialanalysis.ai/leaderboards/models (RSC payload)
 *
 * Output:
 *   public/data/latest.json
 *   public/data/history/YYYY-MM-DD.json
 *   public/data/index.json
 *
 * No third-party dependencies.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "public", "data");
const HISTORY_DIR = path.join(DATA_DIR, "history");

const OPENCODE_URL = "https://opencode.ai/v2/docs/console/go/";
const AA_URL = "https://artificialanalysis.ai/leaderboards/models";
const USER_AGENT =
  "opencode-value-map/1.0 (static GitHub Pages dashboard; daily refresh)";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function plain(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Text outside of <small>/<del> (used for model names with promo notes). */
function cellName(html) {
  return plain(
    html
      .replace(/<small[\s\S]*?<\/small>/gi, " ")
      .replace(/<del[\s\S]*?<\/del>/gi, " ")
  );
}

function lastStrong(html) {
  const matches = [...html.matchAll(/<strong>([\s\S]*?)<\/strong>/gi)];
  if (!matches.length) return null;
  return plain(matches[matches.length - 1][1]);
}

function parseMoney(value) {
  if (value == null) return null;
  const cleaned = plain(value).trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  if (/^free$/i.test(cleaned)) return 0;
  const match = cleaned.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseIntLoose(value) {
  if (value == null) return null;
  const cleaned = plain(value).replace(/,/g, "");
  if (/unlimited/i.test(cleaned)) return "unlimited";
  const match = cleaned.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** Strip trailing qualifiers such as "(≤ 256K tokens)" or "(Off-Peak)". */
function baseName(name) {
  let value = name;
  // Remove repeatedly: "Model (variant) (note)"
  for (let i = 0; i < 4; i += 1) {
    const next = value.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (next === value) break;
    value = next;
  }
  return value.replace(/\s+/g, " ").trim();
}

function normalizeName(name) {
  return decodeEntities(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** OpenCode-only tier suffixes that Artificial Analysis omits from its names. */
const MATCH_SUFFIXES = new Set(["contributor", "free"]);

/** Normalise a model name and drop trailing tier suffixes for AA matching. */
function matchName(name) {
  const parts = normalizeName(name).split(" ").filter(Boolean);
  while (parts.length > 1 && MATCH_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

function tokens(name) {
  return normalizeName(name).split(" ").filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* OpenCode Go                                                         */
/* ------------------------------------------------------------------ */

function extractTables(html) {
  const tables = [];
  const tableRe = /<table>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html))) {
    const body = tableMatch[1];
    const header = [...body.matchAll(/<th>([\s\S]*?)<\/th>/gi)].map((m) =>
      plain(m[1])
    );
    const rows = [];
    const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(body))) {
      const cells = [...rowMatch[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map(
        (m) => m[1]
      );
      if (cells.length) rows.push(cells);
    }
    tables.push({ header, rows });
  }
  return tables;
}

function findTables(tables, headerIncludes, expected) {
  const found = tables.filter((table) =>
    table.header.some((h) => h.toLowerCase().includes(headerIncludes))
  );
  if (found.length < expected) {
    throw new Error(
      `Expected ${expected} table(s) with header "${headerIncludes}", found ${found.length}`
    );
  }
  return found;
}

function parseOpencode(html) {
  const tables = extractTables(html);

  // Page order: Go pricing, Go Plus pricing, Go requests, Go Plus requests.
  const pricingTables = findTables(tables, "monthly limit", 2);
  const requestTables = findTables(tables, "requests per month", 2);

  if (pricingTables[0].rows.length < 5) {
    throw new Error("OpenCode pricing table looks empty; layout may have changed");
  }

  const plans = {
    go: { label: "Go", price: 10, models: {} },
    "go-plus": { label: "Go Plus", price: 40, models: {} },
  };

  for (const [index, key] of ["go", "go-plus"].entries()) {
    const pricing = pricingTables[index];
    const requests = requestTables[index];

    const requestByName = new Map();
    for (const row of requests.rows) {
      if (row.length < 4) continue;
      const name = baseName(cellName(row[0]));
      // Prefer the last <strong> value (promo override), otherwise the cell.
      const cell = row[row.length - 1];
      const value = lastStrong(cell) ?? cell;
      requestByName.set(normalizeName(name), parseIntLoose(value));
    }

    for (const row of pricing.rows) {
      if (row.length < 6) continue;
      const name = baseName(cellName(row[0]));
      if (!name) continue;
      const limitCell = row[row.length - 1];
      const limitText = lastStrong(limitCell) ?? plain(limitCell);
      const limit = /unlimited/i.test(limitText)
        ? "unlimited"
        : parseMoney(limitText);

      if (limit == null) continue;

      const noteMatch = limitCell.match(/<small>([\s\S]*?)<\/small>/i);
      const note = noteMatch ? plain(noteMatch[1]) : null;

      const model = plans[key].models[normalizeName(name)] ?? {
        name,
        input: null,
        output: null,
        cachedRead: null,
        cachedWrite: null,
        monthlyLimit: limit,
        monthlyRequests: requestByName.get(normalizeName(name)) ?? null,
        notes: [],
      };

      // Variants (peak/off-peak, context tiers) collapse into one model.
      // Keep the cheapest price tier for display.
      for (const [field, cellIndex] of [
        ["input", 1],
        ["output", 2],
        ["cachedRead", 3],
        ["cachedWrite", 4],
      ]) {
        const value = parseMoney(row[cellIndex]);
        if (value == null) continue;
        model[field] =
          model[field] == null ? value : Math.min(model[field], value);
      }

      if (note && !model.notes.includes(note)) model.notes.push(note);
      plans[key].models[normalizeName(name)] = model;
    }
  }

  return plans;
}

/* ------------------------------------------------------------------ */
/* Artificial Analysis                                                 */
/* ------------------------------------------------------------------ */

/** Concatenated Next.js RSC payload from a page's inline script chunks. */
function rscPayload(html) {
  const chunkRe =
    /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)<\/script>/gs;
  const chunks = [];
  let match;
  while ((match = chunkRe.exec(html))) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      // Ignore malformed chunks rather than failing the whole scrape.
    }
  }
  return chunks.join("");
}

/** Bracket-matched JSON array/object following `marker` in an RSC payload. */
function jsonAfter(payload, marker) {
  const at = payload.indexOf(marker);
  if (at === -1) return null;

  let index = at + marker.length;
  while (index < payload.length && /\s/.test(payload[index])) index += 1;

  const opener = payload[index];
  if (opener !== "[" && opener !== "{") return null;
  const closer = opener === "[" ? "]" : "}";
  const begin = index;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < payload.length; index += 1) {
    const char = payload[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(payload.slice(begin, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Every release in AA's catalogue, including the ones retired from the
 * leaderboard (`deprecated: true`). Their model pages still carry a score.
 */
function parseAaReleases(payload) {
  const releases = new Map();
  const releaseRe =
    /\{"slug":"([^"]+)","name":"([^"]+)","deprecated":(true|false),"releaseDate":("(?:[^"\\]|\\.)*"|null)/g;

  for (const match of payload.matchAll(releaseRe)) {
    const name = match[2];
    releases.set(match[1], {
      slug: match[1],
      name,
      baseName: baseName(name),
      deprecated: match[3] === "true",
      releaseDate: match[4] === "null" ? null : match[4].slice(1, -1),
    });
  }
  return [...releases.values()];
}

function parseArtificialAnalysis(html) {
  const payload = rscPayload(html);
  const raw = jsonAfter(payload, '"initialModels":');
  if (!Array.isArray(raw) || raw.length < 50) {
    throw new Error(
      `Unexpected AA model count: ${Array.isArray(raw) ? raw.length : 0}`
    );
  }

  const models = raw
    .filter(
      (model) =>
        model &&
        model.name &&
        typeof model.intelligenceIndex === "number" &&
        Number.isFinite(model.intelligenceIndex)
    )
    .map((model) => ({
      name: model.name,
      baseName: baseName(model.name),
      slug: model.slug ?? null,
      intelligence: model.intelligenceIndex,
      estimated: Boolean(model.intelligenceIndexIsEstimated),
      creator: model.modelCreatorName ?? null,
      openWeights: Boolean(model.isOpenWeights),
      contextWindow: model.contextWindowTokens ?? null,
      priceInput: model.price1mInputTokens ?? null,
      priceOutput: model.price1mOutputTokens ?? null,
    }));

  return { models, releases: parseAaReleases(payload) };
}

/**
 * Manual aliases where Artificial Analysis uses a different name.
 * OpenCode's "Contributor"/"Free" suffixes are stripped automatically, so only
 * genuine naming differences belong here. Keys/values are normalizeName() output.
 */
const AA_ALIASES = {
  "qwen3 8 flash": "qwen3 8 flash next",
};

function isNumericToken(token) {
  return /^\d+$/.test(token);
}

/** AA entries whose name matches an OpenCode model name. */
function findCandidates(opencodeName, entries) {
  const wanted = normalizeName(opencodeName);
  // AA has no "Contributor"/"Free" suffix; OpenCode adds it to some tiers.
  const target = matchName(AA_ALIASES[wanted] ?? wanted);
  const targetTokens = target.split(" ").filter(Boolean);

  return entries.filter((model) => {
    const candidate = normalizeName(model.baseName ?? model.name);
    if (candidate === target) return true;
    const candidateTokens = candidate.split(" ");
    // Allow AA revision suffixes, e.g. "DeepSeek V4 Pro 0813" or "Qwen3.8 Max (0902)".
    return (
      candidateTokens.length > targetTokens.length &&
      targetTokens.every((token, index) => candidateTokens[index] === token) &&
      candidateTokens.slice(targetTokens.length).every(isNumericToken)
    );
  });
}

function matchAa(opencodeName, aaModels) {
  const candidates = findCandidates(opencodeName, aaModels);
  if (!candidates.length) return null;
  // Multiple reasoning variants exist; use the strongest configuration.
  return candidates.reduce((best, current) =>
    current.intelligence > best.intelligence ? current : best
  );
}

const aaPageCache = new Map();

/**
 * AA keeps a page for every model it has tested, even after it is retired from
 * the leaderboard. Read the page's own record so those models keep a score.
 */
async function fetchAaPage(slug) {
  if (aaPageCache.has(slug)) return aaPageCache.get(slug);

  const promise = (async () => {
    const html = await fetchText(`https://artificialanalysis.ai/models/${slug}`);
    const current = jsonAfter(rscPayload(html), '"currentModel":');
    if (!current || typeof current.intelligenceIndex !== "number") return null;
    const name = current.name ?? slug;
    return {
      name,
      baseName: baseName(name),
      slug: current.slug ?? slug,
      intelligence: current.intelligenceIndex,
      estimated: Boolean(current.intelligenceIndexIsEstimated),
      creator: current.creator?.name ?? null,
      openWeights: Boolean(current.isOpenWeights),
      contextWindow: current.contextWindowTokens ?? null,
    };
  })();

  aaPageCache.set(slug, promise);
  return promise;
}

/** Fallback for models AA has retired from the leaderboard. */
async function matchAaPage(opencodeName, releases) {
  const candidates = findCandidates(opencodeName, releases);
  if (!candidates.length) return null;

  // Prefer an exact name match, then the most recently released one.
  const wanted = matchName(opencodeName);
  const exact = candidates.filter(
    (release) => matchName(release.name) === wanted
  );
  const chosen = (exact.length ? exact : candidates).sort((a, b) =>
    String(b.releaseDate ?? "").localeCompare(String(a.releaseDate ?? ""))
  )[0];

  try {
    return await fetchAaPage(chosen.slug);
  } catch (error) {
    console.warn(`  ${opencodeName}: could not read ${chosen.slug} (${error.message})`);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function serialiseModel(opencodeModel, aa) {
  return {
    name: opencodeModel.name,
    input: opencodeModel.input,
    output: opencodeModel.output,
    cachedRead: opencodeModel.cachedRead,
    cachedWrite: opencodeModel.cachedWrite,
    monthlyLimit: opencodeModel.monthlyLimit,
    monthlyRequests: opencodeModel.monthlyRequests,
    notes: opencodeModel.notes,
    aa: aa
      ? {
          name: aa.name,
          slug: aa.slug,
          intelligence: Number(aa.intelligence.toFixed(2)),
          estimated: aa.estimated,
          creator: aa.creator,
          openWeights: aa.openWeights,
          contextWindow: aa.contextWindow,
        }
      : null,
  };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function previousAaScores() {
  const latest = await readJson(path.join(DATA_DIR, "latest.json"));
  if (!latest?.models) return new Map();
  const map = new Map();
  for (const model of latest.models) {
    if (model.aa?.intelligence != null) {
      map.set(normalizeName(model.name), model.aa);
    }
  }
  return map;
}

async function main() {
  console.log("Fetching OpenCode Go usage limits…");
  const opencodeHtml = await fetchText(OPENCODE_URL);
  const plans = parseOpencode(opencodeHtml);
  console.log(
    `  parsed ${Object.keys(plans.go.models).length} Go models, ` +
      `${Object.keys(plans["go-plus"].models).length} Go Plus models`
  );

  console.log("Fetching Artificial Analysis leaderboard…");
  let aaModels = [];
  let aaReleases = [];
  try {
    const aaHtml = await fetchText(AA_URL);
    ({ models: aaModels, releases: aaReleases } = parseArtificialAnalysis(aaHtml));
    console.log(
      `  parsed ${aaModels.length} AA models, ${aaReleases.length} catalogued releases`
    );
  } catch (error) {
    console.warn(`  AA scrape failed: ${error.message}`);
    console.warn("  falling back to scores from the previous snapshot");
  }

  const fallback = aaModels.length ? new Map() : await previousAaScores();
  const models = [];
  const unmatched = [];
  const usedAliases = [];
  const retired = [];

  for (const model of Object.values(plans.go.models)) {
    let aa = aaModels.length
      ? matchAa(model.name, aaModels)
      : fallback.get(normalizeName(model.name)) ?? null;

    // AA retires models from the leaderboard long before OpenCode drops them,
    // so fall back to the score on the model's own AA page.
    if (!aa && aaModels.length) {
      aa = await matchAaPage(model.name, aaReleases);
      if (aa) retired.push(`${model.name} → ${aa.name}`);
    }

    if (!aa) {
      unmatched.push(model.name);
      continue;
    }
    const wanted = normalizeName(model.name);
    if (AA_ALIASES[wanted]) usedAliases.push(`${model.name} → ${aa.name}`);
    models.push(serialiseModel(model, aa));
  }

  models.sort((a, b) => {
    const scoreA = a.aa?.intelligence ?? -1;
    const scoreB = b.aa?.intelligence ?? -1;
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const generatedAt = now.toISOString();

  const payload = {
    generatedAt,
    sources: {
      opencode: OPENCODE_URL,
      artificialAnalysis: AA_URL,
      aaMethod:
        "Highest Artificial Analysis Intelligence Index configuration per model. Models retired from the AA leaderboard are read from their AA model page.",
    },
    plans: {
      go: { label: "Go", monthlyPrice: 10 },
      "go-plus": { label: "Go Plus", monthlyPrice: 40 },
    },
    models,
    unmatched,
  };

  // Only write the Go Plus plan data once per model (same model list).
  for (const key of ["go", "go-plus"]) {
    const map = plans[key].models;
    for (const model of models) {
      const source = map[normalizeName(model.name)];
      if (!source) continue;
      model[key] = {
        monthlyLimit: source.monthlyLimit,
        monthlyRequests: source.monthlyRequests,
      };
    }
  }

  // Degenerate guard: never publish a mostly-empty snapshot.
  if (models.length < 5) {
    throw new Error(`Only ${models.length} models matched; refusing to publish`);
  }

  await mkdir(HISTORY_DIR, { recursive: true });
  await writeFile(
    path.join(HISTORY_DIR, `${date}.json`),
    JSON.stringify(payload, null, 2) + "\n"
  );
  await writeFile(
    path.join(DATA_DIR, "latest.json"),
    JSON.stringify(payload, null, 2) + "\n"
  );

  const index = (await readJson(path.join(DATA_DIR, "index.json"), { dates: [] })) ?? {
    dates: [],
  };
  const dates = new Set(index.dates ?? []);
  dates.add(date);
  await writeFile(
    path.join(DATA_DIR, "index.json"),
    JSON.stringify(
      {
        dates: [...dates].sort(),
        updatedAt: generatedAt,
      },
      null,
      2
    ) + "\n"
  );

  console.log(`Wrote snapshot for ${date}`);
  console.log(`Matched ${models.length} models, ${unmatched.length} unmatched`);
  if (retired.length) console.log(`  from AA model pages: ${retired.join("; ")}`);
  if (unmatched.length) console.log(`  unmatched: ${unmatched.join(", ")}`);
  if (usedAliases.length) console.log(`  aliases: ${usedAliases.join("; ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

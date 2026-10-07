#!/usr/bin/env node
/**
 * check-semconv — are the GenAI telemetry attribute names in this code real?
 *
 * An agent that is instrumented with the wrong attribute name is *worse* than
 * one with no instrumentation at all. Nothing errors: the span is still
 * exported, the collector still accepts it, the backend still stores it. The
 * only symptom is a dashboard panel that stays empty, and a panel that is
 * empty because nothing happened looks exactly like a panel that is empty
 * because the attribute was misspelled.
 *
 * That makes attribute names worth a deterministic check, which is what this
 * script is. It reads source files, finds every `gen_ai.*` string, and asks
 * three questions no human judgement is needed for:
 *
 *   1. Is this attribute one the conventions actually define?
 *   2. Has it been renamed? (`gen_ai.system` became `gen_ai.provider.name`.)
 *   3. Are you recording token usage at all, or only the call itself?
 *
 * ── Honest limits, because they matter here ──────────────────────────────
 *
 * The GenAI semantic conventions are **not stable**. Every span and attribute
 * is marked `Development`, the conventions were moved out of the main
 * `semantic-conventions` repository at v1.42.0 into
 * `open-telemetry/semantic-conventions-genai`, and that repository has **no
 * tagged release**. So this script pins a dated snapshot (see SNAPSHOT below)
 * rather than pretending to track a version, and it will go out of date.
 * Re-check the registry when you bump it.
 *
 * This is a *name* checker. It does not and cannot tell you whether your spans
 * are correctly nested, whether a parent span is missing, or whether the value
 * you put in an attribute is the right one. A green run here means your names
 * are spelled the way a backend expects — not that your tracing is good.
 *
 * It matches strings textually, so it sees `"gen_ai.usage.input_tokens"` but
 * not a name you assemble at runtime (`"gen_ai.usage." + kind`). Code that
 * builds attribute names dynamically is invisible to this check.
 *
 * Usage:
 *   node scripts/check-semconv.js <path> [<path>...] [options]
 *
 * Options:
 *   --strict    Treat warnings as errors (recommended in CI).
 *   --json      Machine-readable output.
 *   --quiet     Print nothing on success.
 *   -h, --help  Show help.
 *
 * Exit codes: 0 clean, 1 problems found, 2 bad usage.
 */

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * The date the attribute registry below was read from
 * open-telemetry/semantic-conventions-genai. Everything in these conventions
 * is `Development` status, so this is a snapshot, not a version.
 */
const SNAPSHOT = "2026-10-07";

/**
 * Every `gen_ai.*` attribute the registry defines, read from
 * docs/registry/attributes/gen-ai.md on the SNAPSHOT date.
 *
 * Kept as a flat list on purpose: an unknown-attribute error has to be able to
 * say "did you mean", and that needs the whole set, not a prefix rule.
 */
const REGISTRY = new Set([
  "gen_ai.agent.description",
  "gen_ai.agent.id",
  "gen_ai.agent.name",
  "gen_ai.agent.version",
  "gen_ai.conversation.compacted",
  "gen_ai.conversation.id",
  "gen_ai.data_source.id",
  "gen_ai.embeddings.dimension.count",
  "gen_ai.evaluation.explanation",
  "gen_ai.evaluation.name",
  "gen_ai.evaluation.score.label",
  "gen_ai.evaluation.score.value",
  "gen_ai.input.messages",
  "gen_ai.main_agent.description",
  "gen_ai.main_agent.id",
  "gen_ai.main_agent.name",
  "gen_ai.memory.query.text",
  "gen_ai.memory.record.count",
  "gen_ai.memory.record.id",
  "gen_ai.memory.records",
  "gen_ai.memory.store.id",
  "gen_ai.operation.name",
  "gen_ai.output.messages",
  "gen_ai.output.type",
  "gen_ai.prompt.name",
  "gen_ai.prompt.variable",
  "gen_ai.prompt.version",
  "gen_ai.provider.name",
  "gen_ai.request.choice.count",
  "gen_ai.request.encoding_formats",
  "gen_ai.request.frequency_penalty",
  "gen_ai.request.max_tokens",
  "gen_ai.request.model",
  "gen_ai.request.presence_penalty",
  "gen_ai.request.previous_response.id",
  "gen_ai.request.reasoning.level",
  "gen_ai.request.seed",
  "gen_ai.request.stop_sequences",
  "gen_ai.request.stream",
  "gen_ai.request.stream_cursor",
  "gen_ai.request.temperature",
  "gen_ai.request.top_k",
  "gen_ai.request.top_p",
  "gen_ai.response.finish_reasons",
  "gen_ai.response.id",
  "gen_ai.response.model",
  "gen_ai.response.status",
  "gen_ai.response.time_to_first_chunk",
  "gen_ai.retrieval.documents",
  "gen_ai.retrieval.query.text",
  "gen_ai.retrieval.top_k",
  "gen_ai.skill.description",
  "gen_ai.skill.name",
  "gen_ai.skill.resource.name",
  "gen_ai.skill.source.uri",
  "gen_ai.system_instructions",
  "gen_ai.token.modality",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.id",
  "gen_ai.tool.call.result",
  "gen_ai.tool.definitions",
  "gen_ai.tool.description",
  "gen_ai.tool.name",
  "gen_ai.tool.type",
  "gen_ai.usage.audio.cache_read.input_tokens",
  "gen_ai.usage.audio.input_tokens",
  "gen_ai.usage.audio.output_tokens",
  "gen_ai.usage.cache_read.input_tokens",
  "gen_ai.usage.cache_write.input_tokens",
  "gen_ai.usage.image.cache_read.input_tokens",
  "gen_ai.usage.image.input_tokens",
  "gen_ai.usage.image.output_tokens",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.reasoning.output_tokens",
  "gen_ai.usage.text.cache_read.input_tokens",
  "gen_ai.usage.text.input_tokens",
  "gen_ai.usage.text.output_tokens",
  "gen_ai.workflow.name",
]);

/**
 * Attributes that were renamed or removed, mapped to what to use instead.
 *
 * These are the ones that actually bite, because 2025-era tutorials, blog
 * posts and model-provider examples are full of them, and so is a lot of
 * instrumentation written against semconv 1.27-1.36. `null` means the
 * attribute was dropped with no direct successor.
 *
 * Sources, read on the SNAPSHOT date: the deprecated-attribute registry in
 * open-telemetry/semantic-conventions (the GenAI conventions' previous home),
 * cross-checked against semantic-conventions#2046, which performed the rename.
 */
const DEPRECATED = new Map([
  ["gen_ai.system", "gen_ai.provider.name"],
  ["gen_ai.usage.prompt_tokens", "gen_ai.usage.input_tokens"],
  ["gen_ai.usage.completion_tokens", "gen_ai.usage.output_tokens"],
  ["gen_ai.prompt", "gen_ai.input.messages"],
  ["gen_ai.completion", "gen_ai.output.messages"],
  ["gen_ai.openai.request.seed", "gen_ai.request.seed"],
  ["gen_ai.openai.request.response_format", "gen_ai.output.type"],
  ["gen_ai.openai.request.service_tier", "openai.request.service_tier"],
  ["gen_ai.openai.response.service_tier", "openai.response.service_tier"],
  ["gen_ai.openai.response.system_fingerprint", "openai.response.system_fingerprint"],
  // Never existed in the conventions, but widely emitted anyway — several
  // frameworks add it by hand. Sum the input and output counters instead.
  ["gen_ai.usage.total_tokens", null],
]);

/** Valid values for `gen_ai.operation.name`, per the operation-name attribute. */
const OPERATIONS = new Set([
  "chat",
  "create_agent",
  "embeddings",
  "execute_tool",
  "generate_content",
  "invoke_agent",
  "invoke_workflow",
  "plan",
]);

/**
 * Attributes whose *values* are user or model content rather than metadata:
 * prompts, replies, tool arguments, retrieved documents, memories.
 *
 * Recording them is legitimate and often the entire point of a trace. It is
 * also how transcripts, customer records and secrets end up in a telemetry
 * backend that a wider group can read than the application itself, under a
 * retention policy nobody chose deliberately. So this is a warning that asks
 * for a decision, never an error.
 */
const CONTENT_BEARING = new Set([
  "gen_ai.input.messages",
  "gen_ai.output.messages",
  "gen_ai.system_instructions",
  "gen_ai.tool.call.arguments",
  "gen_ai.tool.call.result",
  "gen_ai.tool.definitions",
  "gen_ai.memory.query.text",
  "gen_ai.memory.records",
  "gen_ai.retrieval.documents",
  "gen_ai.retrieval.query.text",
  "gen_ai.prompt.variable",
]);

/** File extensions worth reading. Anything else is skipped. */
const SOURCE_EXTS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".py", ".go", ".java", ".kt", ".rb", ".rs", ".cs", ".php",
  ".json", ".yaml", ".yml", ".md",
]);

/** Directories never worth walking into. */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "__pycache__",
  "vendor", "target", ".venv", "venv",
]);

/** Marker that silences one rule on a line, or on a whole fenced block. */
const ALLOW = "semconv-allow";

/**
 * Levenshtein distance, capped — only used to offer a "did you mean" on an
 * unknown attribute, so an exact number beyond a few edits is not interesting.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * The closest registry attribute to `name`, if one is close enough to be worth
 * suggesting. The threshold scales with length so a short name does not match
 * everything.
 *
 * @param {string} name
 * @returns {string|null}
 */
function suggest(name) {
  let best = null;
  let bestDist = Infinity;
  for (const known of REGISTRY) {
    const d = editDistance(name, known);
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 4));
  return bestDist <= limit ? best : null;
}

/**
 * Pull every `gen_ai.*` attribute reference out of a file body, with its line
 * number, honouring the allow marker.
 *
 * The marker is honoured in three places, in order of how often you want each:
 *
 *   - on the line itself;
 *   - on the line immediately above, so you can leave a long line alone and
 *     put the marker and its reason in a comment above it;
 *   - on a fenced block's info string (```js semconv-allow), which exempts the
 *     whole block.
 *
 * A document explaining that `gen_ai.system` is deprecated has to be able to
 * write it down, and so does a code comment warning you off it — this repo has
 * been bitten twice by a guide that could not quote the thing it warned about.
 *
 * @param {string} body
 * @returns {{line: number, name: string, text: string, allowed: boolean}[]}
 */
function parseAttributes(body) {
  // A trailing [a-z0-9_] class, not [a-z0-9_.], so a sentence-ending dot or a
  // "gen_ai.usage." prefix in prose does not become part of the name.
  const re = /gen_ai(?:\.[a-z0-9_]+)+/gi;
  const found = [];
  const lines = String(body).split(/\r?\n/);
  let fence = null;
  let fenceAllowed = false;

  lines.forEach((line, idx) => {
    const delim = /^\s*(`{3,}|~{3,})/.exec(line);
    if (delim) {
      if (fence === null) {
        fence = delim[1];
        fenceAllowed = line.includes(ALLOW);
        return;
      }
      if (delim[1][0] === fence[0] && delim[1].length >= fence.length) {
        fence = null;
        fenceAllowed = false;
        return;
      }
    }
    const prev = idx > 0 ? lines[idx - 1] : "";
    const allowed = fenceAllowed || line.includes(ALLOW) || prev.includes(ALLOW);
    for (const m of line.matchAll(re)) {
      found.push({
        line: idx + 1,
        name: m[0].toLowerCase(),
        text: line.trim(),
        allowed,
      });
    }
  });
  return found;
}

/**
 * Find `gen_ai.operation.name` assignments whose value is a literal string, so
 * a typo'd operation can be reported.
 *
 * Deliberately line-scoped and conservative: it only fires when a quoted value
 * sits on the same line as the attribute. A value assembled elsewhere is not
 * guessed at, because a false positive on a correct codebase is how a check
 * gets switched off.
 *
 * @param {string} body
 * @returns {{line: number, value: string, text: string, allowed: boolean}[]}
 */
function parseOperationValues(body) {
  const hits = [];
  const lines = String(body).split(/\r?\n/);
  lines
    .forEach((line, idx) => {
      if (!/gen_ai\.operation\.name/i.test(line)) return;
      // Take the last quoted string on the line: on `set("gen_ai.operation.name", "chat")`
      // the first quoted run is the attribute key itself.
      const quoted = [...line.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]);
      const value = quoted.filter((v) => !/^gen_ai\./i.test(v)).pop();
      if (value === undefined || value === "") return;
      hits.push({
        line: idx + 1,
        value,
        text: line.trim(),
        allowed: line.includes(ALLOW) || (idx > 0 && lines[idx - 1].includes(ALLOW)),
      });
    });
  return hits;
}

/** Recursively collect candidate source files under `target`. */
function collectFiles(target, acc = []) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    acc.push(target);
    return acc;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, acc);
    } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Run every check over a set of paths.
 *
 * Pure with respect to the filesystem it is handed, so tests point it at
 * fixtures and nothing depends on the machine.
 *
 * @param {object} options
 * @param {string[]} options.paths  Files or directories to scan.
 * @param {string}   [options.root] Base for the reported relative paths.
 * @returns {{ok: boolean, errors: string[], warnings: string[], stats: object}}
 */
function checkSemconv({ paths, root = process.cwd() }) {
  const errors = [];
  const warnings = [];
  const stats = { files: 0, filesWithAttributes: 0, attributes: 0, deprecated: 0, unknown: 0 };

  const files = [];
  for (const p of paths) {
    const abs = path.resolve(root, p);
    if (!fs.existsSync(abs)) {
      errors.push(`path not found: ${p}`);
      continue;
    }
    collectFiles(abs, files);
  }

  for (const abs of files) {
    stats.files += 1;
    const rel = path.relative(root, abs).replace(/\\/g, "/") || path.basename(abs);
    let body;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch (err) {
      errors.push(`${rel}: could not be read (${err.message})`);
      continue;
    }

    const attrs = parseAttributes(body);
    const live = attrs.filter((a) => !a.allowed);
    if (attrs.length === 0) continue;
    stats.filesWithAttributes += 1;
    stats.attributes += live.length;

    for (const a of live) {
      if (DEPRECATED.has(a.name)) {
        stats.deprecated += 1;
        const replacement = DEPRECATED.get(a.name);
        errors.push(
          replacement === null
            ? `${rel}:${a.line} "${a.name}" is not part of the GenAI conventions. ` +
                "Sum gen_ai.usage.input_tokens and gen_ai.usage.output_tokens instead: " +
                `"${a.text}"`
            : `${rel}:${a.line} "${a.name}" was renamed to "${replacement}". ` +
                `A backend built for the current conventions will not match the old name: "${a.text}"`,
        );
        continue;
      }
      if (!REGISTRY.has(a.name)) {
        stats.unknown += 1;
        const hint = suggest(a.name);
        errors.push(
          `${rel}:${a.line} "${a.name}" is not an attribute the GenAI conventions ` +
            `define (snapshot ${SNAPSHOT})` +
            (hint ? `. Did you mean "${hint}"?` : ". Check the attribute registry.") +
            ` "${a.text}"`,
        );
      }
    }

    for (const op of parseOperationValues(body)) {
      if (op.allowed || OPERATIONS.has(op.value)) continue;
      errors.push(
        `${rel}:${op.line} "${op.value}" is not a valid gen_ai.operation.name. ` +
          `Use one of: ${[...OPERATIONS].join(", ")}: "${op.text}"`,
      );
    }

    // Does this file record what the call cost?
    const names = new Set(live.map((a) => a.name));
    const recordsUsage = [...names].some((n) => n.startsWith("gen_ai.usage."));
    const looksLikeACall = [...names].some(
      (n) => n === "gen_ai.operation.name" || n === "gen_ai.request.model",
    );
    if (looksLikeACall && !recordsUsage) {
      warnings.push(
        `${rel} traces a model call but records no gen_ai.usage.* token counts. ` +
          "Without them a trace tells you that something happened and not what it cost, " +
          "which is the half of the story people actually get asked about.",
      );
    }

    const content = [...names].filter((n) => CONTENT_BEARING.has(n));
    if (content.length > 0) {
      warnings.push(
        `${rel} records user or model content in ${content.join(", ")}. ` +
          "That is often the point of a trace, but it puts prompts, replies or retrieved " +
          "documents into your telemetry backend — decide the retention and access rules " +
          `deliberately, or redact before export. Mark the line with ${ALLOW} once you have.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings, stats };
}

// --- CLI ----------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(
      [
        "check-semconv — check GenAI telemetry attribute names against the",
        "                OpenTelemetry GenAI semantic conventions",
        "",
        "Usage:",
        "  node scripts/check-semconv.js <path> [<path>...] [options]",
        "",
        "Options:",
        "  --strict    Treat warnings as errors (recommended in CI).",
        "  --json      Machine-readable output.",
        "  --quiet     Print nothing on success.",
        "  -h, --help  Show this help.",
        "",
        "Examples:",
        "  node scripts/check-semconv.js src",
        "  node scripts/check-semconv.js src app --strict",
        "",
        `Attribute registry snapshot: ${SNAPSHOT}. These conventions are`,
        "Development status and still change — re-check when you bump it.",
        "",
        `Silence a finding with a ${ALLOW} marker, on the line itself, on the`,
        "line above it, or on a fenced block's info string to exempt the block.",
        "",
      ].join("\n"),
    );
    return 0;
  }

  const strict = args.includes("--strict");
  const json = args.includes("--json");
  const quiet = args.includes("--quiet");
  const paths = args.filter((a) => !a.startsWith("-"));

  if (paths.length === 0) {
    process.stderr.write("! no paths given. Try: node scripts/check-semconv.js src\n");
    return 2;
  }

  let result;
  try {
    result = checkSemconv({ paths });
  } catch (err) {
    process.stderr.write(`! check-semconv failed: ${err.message}\n`);
    return 2;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ ...result, snapshot: SNAPSHOT, strict }, null, 2)}\n`);
    return result.ok && (!strict || result.warnings.length === 0) ? 0 : 1;
  }

  const failing = !result.ok || (strict && result.warnings.length > 0);

  if (result.errors.length > 0) {
    process.stdout.write(`\n✗ check-semconv: ${result.errors.length} problem(s) found.\n\n`);
    for (const e of result.errors) process.stdout.write(`  • ${e}\n`);
    process.stdout.write("\n");
  }

  if (result.warnings.length > 0) {
    const label = strict ? "blocking under --strict" : "advisory";
    process.stdout.write(`${result.errors.length ? "" : "\n"}! check-semconv: ${result.warnings.length} warning(s) (${label}).\n\n`);
    for (const w of result.warnings) process.stdout.write(`  • ${w}\n`);
    process.stdout.write("\n");
  }

  if (failing) return 1;

  if (!quiet) {
    process.stdout.write(
      `✓ check-semconv: ${result.stats.files} file(s) scanned, ` +
        `${result.stats.attributes} gen_ai attribute(s) in ` +
        `${result.stats.filesWithAttributes} file(s), no problems ` +
        `(registry snapshot ${SNAPSHOT}).\n`,
    );
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  checkSemconv,
  parseAttributes,
  parseOperationValues,
  suggest,
  editDistance,
  collectFiles,
  REGISTRY,
  DEPRECATED,
  OPERATIONS,
  CONTENT_BEARING,
  SNAPSHOT,
  main,
};

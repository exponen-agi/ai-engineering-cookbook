#!/usr/bin/env node
/**
 * check-evals
 *
 * Deterministic gate for an eval suite (a "golden dataset"). It answers one
 * question without asking a model anything:
 *
 *   Is this dataset capable of failing?
 *
 * That is the question that matters. An eval suite is the only thing standing
 * between a prompt change and a quality regression, and a suite that cannot
 * fail is worse than no suite at all — it is a green tick that means nothing.
 * The ways a dataset quietly stops being able to fail are all mechanical:
 * a case with no assertion, a threshold nobody set, a regex that never
 * compiled, two cases that are secretly the same case, a file still full of
 * TODO placeholders.
 *
 * `docs/evaluation-and-observability.md` describes the practice; this script is
 * the executable form of the checks it asks you to do by eye. It deliberately
 * does NOT run your evals, call a model, or score anything — that is your eval
 * runner's job (promptfoo, DeepEval, or your own). This gate runs before the
 * runner, in a fraction of a second, with no API key and no network.
 *
 * The dataset format is the vendor-neutral one documented in
 * docs/evaluation-and-observability.md. Either shape is accepted:
 *
 *   A bare array:          [ {case}, {case} ]
 *   Or a wrapper object:   { "threshold": 0.9, "cases": [ {case}, {case} ] }
 *
 * No dependencies, no network, no LLM — plain JSON and string matching — so it
 * is safe to run in CI and identical on macOS, Windows and Linux.
 *
 * Usage:
 *   node scripts/check-evals.js [path ...] [options]
 *
 * Options:
 *   --dir <path>       File or directory to scan (repeatable). Default: ./evals
 *   --min-cases <n>    Warn below this many cases. Default: 10.
 *   --strict           Treat warnings as failures too.
 *   --json             Emit machine-readable JSON instead of text.
 *   --quiet            Print only on failure.
 *   -h, --help         Show help.
 *
 * Exit codes: 0 = clean, 1 = problems found, 2 = bad usage / nothing to scan.
 */

const fs = require("fs");
const path = require("path");

// --- the rules, encoded --------------------------------------------------
// These mirror the rules stated in docs/evaluation-and-observability.md.
// Changing one here without a matching change there makes the gate lie, so the
// numbers live in one place.
const RULES = {
  // "Start with ten to twenty cases." Below this is a warning, never an error:
  // a new suite has to start somewhere, and a gate that blocks case #1 is a
  // gate nobody adopts.
  minCases: 10,
  // A pass rate is a fraction. Anything outside this is a typo (someone meant
  // 90, not 0.9 — or the reverse).
  thresholdMin: 0,
  thresholdMax: 1,
  // Every key that counts as "this case can fail". A case with none of these
  // asserts nothing and will pass against literally any output.
  assertionKeys: [
    "expected_contains",
    "must_not_contain",
    "expected_equals",
    "expected_regex",
    "expected_json_schema",
    "rubric",
  ],
  // The subset above that a machine can settle on its own. Level 1 and 2 of
  // the scorer ladder in the guide. `rubric` is the Level 3 exception: it needs
  // a second model, which costs money and can be wrong.
  deterministicAssertionKeys: [
    "expected_contains",
    "must_not_contain",
    "expected_equals",
    "expected_regex",
    "expected_json_schema",
  ],
  // Text that means "I have not written this case yet". A dataset of these
  // passes trivially and reads, at a glance, like a real suite.
  placeholderPatterns: [/\bTODO\b/i, /\bFIXME\b/i, /\bTBD\b/i, /lorem ipsum/i, /\bXXX\b/],
};

/**
 * Things that must never be committed inside a dataset.
 *
 * Golden datasets are built by copying real runs out of a trace viewer, and a
 * real run can contain the key that made it. The dataset then goes into git,
 * where a key lives forever. These patterns are deliberately narrow — each
 * matches a credential format with a fixed, recognisable prefix — because a
 * secret scanner that fires on ordinary prose is a scanner people switch off.
 */
const SECRET_PATTERNS = [
  { id: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}/, why: "looks like an OpenAI-style API key" },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/, why: "looks like an Anthropic API key" },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/, why: "looks like an AWS access key ID" },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, why: "looks like a GitHub token" },
  { id: "google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, why: "looks like a Google API key" },
  { id: "slack-token", re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/, why: "looks like a Slack token" },
  {
    id: "private-key-block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    why: "contains a private key block",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the test suite can exercise them directly.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pull the case list and the declared threshold out of a parsed dataset.
 *
 * Accepts both documented shapes so a reader can start with a bare array and
 * add a wrapper later without the gate changing its mind about their file.
 *
 * @param {unknown} parsed Result of JSON.parse.
 * @returns {{ok: boolean, error?: string, cases: unknown[], threshold: unknown, hasThreshold: boolean}}
 */
function extractSuite(parsed) {
  const empty = { cases: [], threshold: undefined, hasThreshold: false };

  if (Array.isArray(parsed)) {
    return { ok: true, ...empty, cases: parsed };
  }
  if (parsed === null || typeof parsed !== "object") {
    return {
      ok: false,
      error: "the dataset must be a JSON array of cases, or an object with a \"cases\" array",
      ...empty,
    };
  }
  const obj = /** @type {Record<string, unknown>} */ (parsed);
  if (!Array.isArray(obj.cases)) {
    return {
      ok: false,
      error: 'the dataset object has no "cases" array',
      ...empty,
    };
  }
  return {
    ok: true,
    cases: obj.cases,
    threshold: obj.threshold,
    hasThreshold: Object.prototype.hasOwnProperty.call(obj, "threshold"),
  };
}

/**
 * Every string value reachable inside a value, flattened.
 *
 * Used by the placeholder and secret scans, which care about the text a case
 * contains and not about where in the object it sits.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function collectStrings(value) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") {
      out.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node !== null && typeof node === "object") {
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return out;
}

/**
 * Find anything in `text` that looks like a committed credential.
 *
 * @param {string} text
 * @returns {Array<{id: string, why: string}>}
 */
function findSecrets(text) {
  return SECRET_PATTERNS.filter((p) => p.re.test(text)).map(({ id, why }) => ({ id, why }));
}

/**
 * Normalise a case's input for duplicate detection.
 *
 * Two cases that differ only in whitespace or capitalisation are one case
 * wearing two hats: they cost twice the tokens and catch one bug.
 *
 * @param {unknown} input
 * @returns {string|null} null when the input is not comparable.
 */
function normaliseInput(input) {
  if (typeof input === "string") return input.trim().replace(/\s+/g, " ").toLowerCase();
  if (input !== null && typeof input === "object") return JSON.stringify(input);
  return null;
}

/**
 * Check one eval dataset file.
 *
 * @param {{relPath: string, content: string, minCases?: number}} file
 * @returns {Array<{level: "error"|"warn", code: string, file: string, line: number, message: string, fix: string}>}
 */
function checkDataset({ relPath, content, minCases = RULES.minCases }) {
  const findings = [];
  const add = (level, code, line, message, fix) =>
    findings.push({ level, code, file: relPath, line, message, fix });

  // --- it has to be JSON before anything else is knowable ------------------
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    add(
      "error",
      "invalid-json",
      1,
      `not valid JSON: ${err.message}`,
      "Fix the syntax. A dataset your runner cannot parse is a suite that never runs.",
    );
    return findings;
  }

  const suite = extractSuite(parsed);
  if (!suite.ok) {
    add(
      "error",
      "invalid-shape",
      1,
      suite.error,
      'Use either [ {case}, ... ] or { "threshold": 0.9, "cases": [ {case}, ... ] }.',
    );
    return findings;
  }

  // --- the threshold -------------------------------------------------------
  // "Set a threshold, not a vibe." Without one there is no definition of
  // failure, so the suite can report anything and block nothing.
  if (!suite.hasThreshold) {
    add(
      "error",
      "threshold-missing",
      1,
      "no pass-rate threshold is declared, so nothing defines what counts as a failure",
      'Add a top-level "threshold" between 0 and 1, e.g. "threshold": 0.9 for "90% of cases must pass".',
    );
  } else if (typeof suite.threshold !== "number" || Number.isNaN(suite.threshold)) {
    add(
      "error",
      "threshold-not-a-number",
      1,
      `"threshold" is ${JSON.stringify(suite.threshold)}, which is not a number`,
      'Use a number between 0 and 1, e.g. "threshold": 0.9.',
    );
  } else if (suite.threshold < RULES.thresholdMin || suite.threshold > RULES.thresholdMax) {
    add(
      "error",
      "threshold-out-of-range",
      1,
      `"threshold" is ${suite.threshold}; a pass rate is a fraction between ${RULES.thresholdMin} and ${RULES.thresholdMax}`,
      `Did you mean ${suite.threshold > 1 ? suite.threshold / 100 : suite.threshold}? 90% is written 0.9, not 90.`,
    );
  } else if (suite.threshold === 0) {
    add(
      "warn",
      "threshold-zero",
      1,
      'a threshold of 0 passes even when every single case fails',
      "Raise it to the pass rate you actually require, e.g. 0.9.",
    );
  }

  // --- the cases -----------------------------------------------------------
  if (suite.cases.length === 0) {
    add(
      "error",
      "no-cases",
      1,
      "the dataset contains no cases",
      "Add cases from real runs that went wrong. Ten real cases beat a thousand invented ones.",
    );
    return findings;
  }

  if (suite.cases.length < minCases) {
    add(
      "warn",
      "too-few-cases",
      1,
      `the dataset has ${suite.cases.length} case(s); a suite this small will miss most regressions`,
      `Grow it towards ${minCases}-20 cases, taking each one from a real run you saw go wrong.`,
    );
  }

  const seenIds = new Map();
  const seenInputs = new Map();
  let deterministicCases = 0;

  suite.cases.forEach((testCase, index) => {
    // Line numbers inside a JSON blob are not worth faking. The case index is
    // what a reader needs to find the entry, so report that and keep line 1.
    const where = `case ${index + 1}`;

    if (testCase === null || typeof testCase !== "object" || Array.isArray(testCase)) {
      add(
        "error",
        "case-not-an-object",
        1,
        `${where} is ${Array.isArray(testCase) ? "an array" : JSON.stringify(testCase)}, not an object`,
        'Each case is an object, e.g. { "id": "...", "input": "...", "expected_contains": ["..."] }.',
      );
      return;
    }

    const c = /** @type {Record<string, unknown>} */ (testCase);

    // --- id ----------------------------------------------------------------
    // An id is how a failure in CI becomes a thing you can look up. "Case 7
    // failed" sends someone counting array entries.
    if (typeof c.id !== "string" || c.id.trim() === "") {
      add(
        "error",
        "case-id-missing",
        1,
        `${where} has no "id", so a failure report cannot name it`,
        'Give every case a short stable id, e.g. "refund-policy-01".',
      );
    } else {
      const id = c.id.trim();
      if (seenIds.has(id)) {
        add(
          "error",
          "case-id-duplicate",
          1,
          `${where} reuses the id "${id}", already used by case ${seenIds.get(id)}`,
          "Ids must be unique — most runners silently keep only the last case with a given id.",
        );
      } else {
        seenIds.set(id, index + 1);
      }
    }

    // --- input -------------------------------------------------------------
    if (!("input" in c)) {
      add(
        "error",
        "case-input-missing",
        1,
        `${where} has no "input", so there is nothing to send to the model`,
        'Add the input the model receives, e.g. "input": "How long do I have to return an item?".',
      );
    } else if (typeof c.input === "string" && c.input.trim() === "") {
      add(
        "error",
        "case-input-empty",
        1,
        `${where} has an empty "input"`,
        "Put the real user message here — an empty input tests nothing.",
      );
    } else {
      const key = normaliseInput(c.input);
      if (key !== null) {
        if (seenInputs.has(key)) {
          add(
            "warn",
            "case-input-duplicate",
            1,
            `${where} has the same input as case ${seenInputs.get(key)}, ignoring whitespace and capitalisation`,
            "Two identical inputs cost twice the tokens and catch one bug. Delete one, or vary it deliberately.",
          );
        } else {
          seenInputs.set(key, index + 1);
        }
      }
    }

    // --- assertions --------------------------------------------------------
    const present = RULES.assertionKeys.filter((k) => k in c);
    if (present.length === 0) {
      add(
        "error",
        "case-no-assertion",
        1,
        `${where} asserts nothing, so it passes against any output the model produces`,
        `Add at least one of: ${RULES.assertionKeys.join(", ")}.`,
      );
    }
    if (present.some((k) => RULES.deterministicAssertionKeys.includes(k))) {
      deterministicCases += 1;
    }

    // Array-shaped assertions must actually be arrays of non-empty strings.
    // A bare string here is the single most common typo, and most runners
    // silently iterate it character by character.
    for (const key of ["expected_contains", "must_not_contain"]) {
      if (!(key in c)) continue;
      const value = c[key];
      if (!Array.isArray(value)) {
        add(
          "error",
          "assertion-not-an-array",
          1,
          `${where}: "${key}" is ${typeof value}, not an array`,
          `Wrap it in brackets: "${key}": ["30 days"].`,
        );
        continue;
      }
      if (value.length === 0) {
        add(
          "warn",
          "assertion-empty-array",
          1,
          `${where}: "${key}" is an empty array, which asserts nothing`,
          `Remove the key, or list the strings you mean to check.`,
        );
      }
      value.forEach((item, i) => {
        if (typeof item !== "string" || item.trim() === "") {
          add(
            "error",
            "assertion-not-a-string",
            1,
            `${where}: "${key}"[${i}] is ${JSON.stringify(item)}; every entry must be a non-empty string`,
            "Remove the entry, or replace it with the text you expect.",
          );
        }
      });
    }

    // The same string in both lists is a case that can never pass. It is
    // always a mistake, and it is invisible when the lists are long.
    if (Array.isArray(c.expected_contains) && Array.isArray(c.must_not_contain)) {
      const forbidden = new Set(c.must_not_contain.filter((s) => typeof s === "string"));
      for (const wanted of c.expected_contains) {
        if (typeof wanted === "string" && forbidden.has(wanted)) {
          add(
            "error",
            "assertion-contradiction",
            1,
            `${where}: "${wanted}" is required by expected_contains and forbidden by must_not_contain, so the case can never pass`,
            "Delete it from one of the two lists.",
          );
        }
      }
    }

    // A regex that does not compile is a case that errors instead of scoring,
    // and some runners count an errored case as a pass.
    if ("expected_regex" in c) {
      const patterns = Array.isArray(c.expected_regex) ? c.expected_regex : [c.expected_regex];
      patterns.forEach((pattern, i) => {
        if (typeof pattern !== "string") {
          add(
            "error",
            "regex-not-a-string",
            1,
            `${where}: "expected_regex"[${i}] is ${typeof pattern}, not a string`,
            'Write the pattern as a string, e.g. "expected_regex": "\\\\d{4}-\\\\d{2}-\\\\d{2}".',
          );
          return;
        }
        try {
          new RegExp(pattern);
        } catch (err) {
          add(
            "error",
            "regex-invalid",
            1,
            `${where}: "expected_regex"[${i}] does not compile: ${err.message}`,
            "Fix the pattern. Remember that a backslash must be doubled inside JSON.",
          );
        }
      });
    }

    // --- placeholders and secrets -------------------------------------------
    const strings = collectStrings(c);
    const joined = strings.join("\n");

    for (const pattern of RULES.placeholderPatterns) {
      if (pattern.test(joined)) {
        add(
          "warn",
          "case-placeholder-text",
          1,
          `${where} still contains placeholder text (${pattern.source.replace(/\\b/g, "")})`,
          "Replace it with the real input and the real expectation, or delete the case.",
        );
        break;
      }
    }

    for (const secret of findSecrets(joined)) {
      add(
        "error",
        "secret-in-dataset",
        1,
        `${where} ${secret.why}. Datasets are committed to git, where a credential lives forever`,
        `Remove it and rotate the credential. Replace it in the case with an obvious fake such as "sk-TEST-EXAMPLE".`,
      );
    }
  });

  // --- the scorer ladder ---------------------------------------------------
  // "Always try the cheapest scorer first." A suite made entirely of rubrics
  // is slow, costs money on every run, and — the part people miss — is scored
  // by a model that can be wrong. It is a legitimate choice, so this is a
  // warning that names the trade-off, not a block.
  if (suite.cases.length > 0 && deterministicCases === 0) {
    add(
      "warn",
      "judge-only-suite",
      1,
      "every case is scored by an LLM judge, so the suite is slow, costs money per run, and inherits the judge's mistakes",
      "Move whatever you can down to a deterministic check (expected_contains, expected_regex). Keep the judge for tone and reasoning quality.",
    );
  }

  return findings;
}

/**
 * Find every eval dataset under `target`.
 *
 * Accepts a single `.json` file or a directory of them, because both are things
 * a reader will point this at — one dataset, or an `evals/` folder.
 *
 * @param {string} target Absolute path.
 * @param {string} root Absolute path that printed paths are relative to.
 * @returns {Array<{relPath: string, absPath: string}>}
 */
function discoverDatasets(target, root) {
  // Resolve symlinks on both sides before comparing, for the same reason
  // check-skills.js does: macOS makes os.tmpdir() a symlink, and an unresolved
  // argument compared against a resolved root produces a screen of "../".
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  const realRoot = real(root);
  const rel = (p) => path.relative(realRoot, real(p)).split(path.sep).join("/") || path.basename(p);

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return [{ relPath: rel(target), absPath: target }];
  }

  const found = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".json")) continue;
    const abs = path.join(target, entry.name);
    found.push({ relPath: rel(abs), absPath: abs });
  }
  // Stable order, so output is identical on every platform and in every run.
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

const HELP = [
  "check-evals — validate an eval dataset before you trust it as a CI gate",
  "",
  "Usage: node scripts/check-evals.js [path ...] [--dir <path>] [--min-cases <n>]",
  "                                   [--strict] [--json] [--quiet]",
  "",
  "  Scans ./evals by default. Point it at a single dataset file or a folder",
  "  of them. It checks that the suite is CAPABLE OF FAILING — it does not run",
  "  your evals and never calls a model.",
  "",
  "Exit codes: 0 clean | 1 problems found | 2 usage error",
].join("\n");

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{targets: string[], minCases: number, strict: boolean, json: boolean, quiet: boolean, help: boolean, error?: string}}
 */
function parseArgs(argv) {
  const opts = {
    targets: [],
    minCases: RULES.minCases,
    strict: false,
    json: false,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") opts.strict = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--dir") {
      if (i + 1 >= argv.length) return { ...opts, error: "--dir needs a path" };
      opts.targets.push(argv[++i]);
    } else if (arg === "--min-cases") {
      if (i + 1 >= argv.length) return { ...opts, error: "--min-cases needs a number" };
      const raw = argv[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) {
        return { ...opts, error: `--min-cases needs a non-negative whole number, got "${raw}"` };
      }
      opts.minCases = value;
    } else if (arg.startsWith("-")) {
      return { ...opts, error: `unknown option "${arg}"` };
    } else {
      opts.targets.push(arg);
    }
  }
  if (opts.targets.length === 0) opts.targets.push("evals");
  return opts;
}

function main(argv = process.argv.slice(2), root = process.cwd()) {
  const opts = parseArgs(argv);

  if (opts.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (opts.error) {
    process.stderr.write(`! ${opts.error}\n\n${HELP}\n`);
    return 2;
  }

  const datasets = [];
  for (const target of opts.targets) {
    const abs = path.resolve(root, target);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`! no such file or directory: ${target}\n`);
      return 2;
    }
    datasets.push(...discoverDatasets(abs, root));
  }

  if (datasets.length === 0) {
    process.stderr.write(`! no .json dataset found under: ${opts.targets.join(", ")}\n`);
    return 2;
  }

  const findings = [];
  for (const dataset of datasets) {
    findings.push(
      ...checkDataset({
        relPath: dataset.relPath,
        content: fs.readFileSync(dataset.absPath, "utf8"),
        minCases: opts.minCases,
      }),
    );
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");
  const failed = errors.length > 0 || (opts.strict && warnings.length > 0);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        { ok: !failed, scanned: datasets.map((d) => d.relPath), errors, warnings },
        null,
        2,
      ) + "\n",
    );
    return failed ? 1 : 0;
  }

  for (const finding of [...errors, ...warnings]) {
    const tag = finding.level === "error" ? "✗ error" : "! warning";
    process.stdout.write(`${tag}  ${finding.file}  [${finding.code}]\n`);
    process.stdout.write(`         ${finding.message}\n`);
    process.stdout.write(`         → ${finding.fix}\n\n`);
  }

  if (failed) {
    process.stdout.write(
      `✗ check-evals: ${datasets.length} dataset(s) scanned, ${errors.length} error(s), ${warnings.length} warning(s).\n`,
    );
  } else if (!opts.quiet) {
    process.stdout.write(
      `✓ check-evals: ${datasets.length} dataset(s) scanned, no errors` +
        (warnings.length ? `, ${warnings.length} warning(s).\n` : ".\n"),
    );
  }

  return failed ? 1 : 0;
}

// Only run the CLI when invoked directly, so the test suite can require() the
// pure helpers without the process exiting.
if (require.main === module) {
  process.exit(main());
}

module.exports = {
  RULES,
  SECRET_PATTERNS,
  extractSuite,
  collectStrings,
  findSecrets,
  normaliseInput,
  checkDataset,
  discoverDatasets,
  parseArgs,
  main,
};

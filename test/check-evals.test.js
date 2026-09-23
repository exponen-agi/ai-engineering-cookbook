/**
 * Unit tests for scripts/check-evals.js — the eval dataset gate.
 *
 * This gate exists to answer one question: can this eval suite actually fail?
 * So the tests care most about the false negative — a dataset that is broken
 * in a way that makes it pass everything, and that the gate waves through.
 * Each "silently always passes" shape below (no assertion, no threshold,
 * contradictory assertions, a regex that never compiled) gets its own test.
 *
 * The second thing they guard is the opposite failure: a gate that fires on a
 * good dataset. A gate people switch off catches nothing, so the
 * "a well-formed dataset produces no findings at all" test is load-bearing.
 *
 * Fixtures are written to a throwaway temp directory, so nothing here depends
 * on any dataset that happens to live in the repo. Paths are built with
 * path.join and child processes are spawned via process.execPath, so the suite
 * behaves identically on macOS, Windows and Linux.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "scripts", "check-evals.js");
const {
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
} = require(SCRIPT);

// ─────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────

/** One valid case; `n` keeps ids and inputs distinct. */
function validCase(n) {
  return {
    id: `case-${n}`,
    input: `Question number ${n}?`,
    expected_contains: [`answer ${n}`],
  };
}

/** A suite that should pass cleanly: a threshold and enough distinct cases. */
function validSuite(overrides = {}) {
  return {
    threshold: 0.9,
    cases: Array.from({ length: RULES.minCases }, (_, i) => validCase(i + 1)),
    ...overrides,
  };
}

/** Run checkDataset over an object, as the CLI would after reading a file. */
function check(suite, opts = {}) {
  return checkDataset({
    relPath: "evals/dataset.json",
    content: typeof suite === "string" ? suite : JSON.stringify(suite),
    ...opts,
  });
}

/** The finding codes produced, for terse assertions. */
const codes = (findings) => findings.map((f) => f.code);

/** Write dataset files into a fresh temp dir and return its path. */
function makeEvalsDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cookbook-evals-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(dir, name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────
// extractSuite — accepting both documented shapes
// ─────────────────────────────────────────────────────────────────────────

test("extractSuite accepts a bare array of cases", () => {
  const got = extractSuite([{ id: "a" }]);
  assert.equal(got.ok, true);
  assert.equal(got.cases.length, 1);
  assert.equal(got.hasThreshold, false);
});

test("extractSuite accepts a wrapper object with cases and threshold", () => {
  const got = extractSuite({ threshold: 0.8, cases: [{ id: "a" }] });
  assert.equal(got.ok, true);
  assert.equal(got.cases.length, 1);
  assert.equal(got.threshold, 0.8);
  assert.equal(got.hasThreshold, true);
});

test("extractSuite distinguishes a threshold of 0 from a missing threshold", () => {
  // Object.hasOwnProperty, not truthiness — 0 is a real (bad) choice a reader
  // can make, and it must be reported differently from never setting one.
  const zero = extractSuite({ threshold: 0, cases: [] });
  assert.equal(zero.hasThreshold, true);
  assert.equal(zero.threshold, 0);
  assert.equal(extractSuite({ cases: [] }).hasThreshold, false);
});

test("extractSuite rejects a wrapper object with no cases array", () => {
  const got = extractSuite({ threshold: 0.9 });
  assert.equal(got.ok, false);
  assert.match(got.error, /no "cases" array/);
});

test("extractSuite rejects JSON that is neither an array nor an object", () => {
  for (const value of ["a string", 42, null, true]) {
    assert.equal(extractSuite(value).ok, false, `${JSON.stringify(value)} should be rejected`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ─────────────────────────────────────────────────────────────────────────

test("collectStrings gathers strings from nested objects and arrays", () => {
  const got = collectStrings({ a: "one", b: ["two", { c: "three" }], d: 4, e: null });
  assert.deepEqual(got.sort(), ["one", "three", "two"]);
});

test("normaliseInput makes whitespace and capitalisation irrelevant", () => {
  assert.equal(normaliseInput("  Hello   World  "), normaliseInput("hello world"));
});

test("normaliseInput compares object inputs structurally and ignores uncomparable ones", () => {
  assert.equal(normaliseInput({ a: 1 }), normaliseInput({ a: 1 }));
  assert.equal(normaliseInput(42), null);
});

test("findSecrets recognises each credential format it claims to", () => {
  const samples = {
    "openai-key": "sk-abcdefghijklmnopqrstuvwxyz0123",
    "anthropic-key": "sk-ant-abcdefghijklmnopqrstuvwxyz",
    "aws-access-key": "AKIAIOSFODNN7EXAMPLE",
    "github-token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    // "AIza" plus exactly 35 characters — the real Google key length.
    "google-key": "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "slack-token": "xoxb-1234567890-abcdefghij",
    "private-key-block": "-----BEGIN RSA PRIVATE KEY-----",
  };
  for (const [id, sample] of Object.entries(samples)) {
    assert.ok(
      findSecrets(sample).some((s) => s.id === id),
      `${id} was not detected in ${sample}`,
    );
  }
  // Every pattern the script ships must be covered by the table above, so a
  // new pattern cannot be added without a test proving it works.
  assert.deepEqual(
    SECRET_PATTERNS.map((p) => p.id).sort(),
    Object.keys(samples).sort(),
  );
});

test("findSecrets stays quiet on ordinary prose", () => {
  const prose = "The customer asked about a refund within 30 days. Ask them to check their email.";
  assert.deepEqual(findSecrets(prose), []);
});

// ─────────────────────────────────────────────────────────────────────────
// The happy path — the test that keeps the gate adoptable
// ─────────────────────────────────────────────────────────────────────────

test("a well-formed dataset produces no findings at all", () => {
  assert.deepEqual(check(validSuite()), []);
});

test("a bare array with enough cases is accepted apart from the missing threshold", () => {
  const cases = Array.from({ length: RULES.minCases }, (_, i) => validCase(i + 1));
  assert.deepEqual(codes(check(cases)), ["threshold-missing"]);
});

test("every documented assertion key counts as a real assertion", () => {
  for (const key of RULES.assertionKeys) {
    const value =
      key === "expected_contains" || key === "must_not_contain"
        ? ["something"]
        : key === "expected_json_schema"
          ? { type: "object" }
          : "something";
    const suite = validSuite({
      cases: [{ id: "only", input: "hello", [key]: value }],
    });
    assert.ok(
      !codes(check(suite, { minCases: 0 })).includes("case-no-assertion"),
      `"${key}" should count as an assertion`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Malformed files
// ─────────────────────────────────────────────────────────────────────────

test("a file that is not JSON is an error, and scanning stops there", () => {
  const findings = check("{ not json");
  assert.deepEqual(codes(findings), ["invalid-json"]);
});

test("a dataset with the wrong top-level shape is an error", () => {
  assert.deepEqual(codes(check('"just a string"')), ["invalid-shape"]);
});

test("an empty dataset is an error, not a pass", () => {
  // The whole point of the gate: zero cases scores 100% and blocks nothing.
  assert.ok(codes(check({ threshold: 0.9, cases: [] })).includes("no-cases"));
});

// ─────────────────────────────────────────────────────────────────────────
// The threshold — "set a threshold, not a vibe"
// ─────────────────────────────────────────────────────────────────────────

test("a missing threshold is an error", () => {
  const suite = validSuite();
  delete suite.threshold;
  assert.deepEqual(codes(check(suite)), ["threshold-missing"]);
});

test("a threshold that is not a number is an error", () => {
  assert.ok(codes(check(validSuite({ threshold: "0.9" }))).includes("threshold-not-a-number"));
});

test("a threshold above 1 is an error, because a pass rate is a fraction", () => {
  const findings = check(validSuite({ threshold: 90 }));
  assert.ok(codes(findings).includes("threshold-out-of-range"));
  // The fix line should suggest the value they almost certainly meant.
  assert.match(findings[0].fix, /0\.9/);
});

test("a negative threshold is an error", () => {
  assert.ok(codes(check(validSuite({ threshold: -1 }))).includes("threshold-out-of-range"));
});

test("a threshold of 0 is a warning, because it passes when everything fails", () => {
  const findings = check(validSuite({ threshold: 0 }));
  const zero = findings.find((f) => f.code === "threshold-zero");
  assert.ok(zero);
  assert.equal(zero.level, "warn");
});

test("the boundary thresholds 0.0001 and 1 are accepted", () => {
  assert.deepEqual(check(validSuite({ threshold: 1 })), []);
  assert.deepEqual(check(validSuite({ threshold: 0.0001 })), []);
});

// ─────────────────────────────────────────────────────────────────────────
// Case-level checks
// ─────────────────────────────────────────────────────────────────────────

test("a case that is not an object is an error", () => {
  const suite = validSuite({ cases: ["just a string"] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("case-not-an-object"));
});

test("a case with no id is an error", () => {
  const suite = validSuite({ cases: [{ input: "hi", expected_contains: ["yes"] }] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("case-id-missing"));
});

test("a duplicate id is an error and names the case it collides with", () => {
  const suite = validSuite({
    cases: [
      { id: "same", input: "one", expected_contains: ["a"] },
      { id: "same", input: "two", expected_contains: ["b"] },
    ],
  });
  const findings = check(suite, { minCases: 0 });
  const dup = findings.find((f) => f.code === "case-id-duplicate");
  assert.ok(dup);
  assert.match(dup.message, /case 1/);
});

test("a case with no input is an error", () => {
  const suite = validSuite({ cases: [{ id: "a", expected_contains: ["yes"] }] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("case-input-missing"));
});

test("a case with an empty input is an error", () => {
  const suite = validSuite({ cases: [{ id: "a", input: "   ", expected_contains: ["yes"] }] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("case-input-empty"));
});

test("two cases with the same input differing only in case and spacing warn", () => {
  const suite = validSuite({
    cases: [
      { id: "a", input: "How long is the return window?", expected_contains: ["30"] },
      { id: "b", input: "how long   is the RETURN window?", expected_contains: ["30"] },
    ],
  });
  const findings = check(suite, { minCases: 0 });
  const dup = findings.find((f) => f.code === "case-input-duplicate");
  assert.ok(dup);
  assert.equal(dup.level, "warn");
});

test("a case with no assertion at all is an error — it passes against any output", () => {
  const suite = validSuite({ cases: [{ id: "a", input: "hello" }] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("case-no-assertion"));
});

// ─────────────────────────────────────────────────────────────────────────
// Assertion shapes
// ─────────────────────────────────────────────────────────────────────────

test("a bare string where an array is expected is an error", () => {
  // The most common typo in a hand-written dataset. Runners tend to iterate
  // the string character by character and assert nothing useful.
  const suite = validSuite({
    cases: [{ id: "a", input: "hello", expected_contains: "30 days" }],
  });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("assertion-not-an-array"));
});

test("an empty assertion array is a warning", () => {
  const suite = validSuite({
    cases: [{ id: "a", input: "hello", expected_contains: [], must_not_contain: ["no"] }],
  });
  const findings = check(suite, { minCases: 0 });
  const empty = findings.find((f) => f.code === "assertion-empty-array");
  assert.ok(empty);
	assert.equal(empty.level, "warn");
});

test("a non-string entry inside an assertion array is an error", () => {
  const suite = validSuite({
    cases: [{ id: "a", input: "hello", expected_contains: ["fine", 42, ""] }],
  });
  const found = check(suite, { minCases: 0 }).filter((f) => f.code === "assertion-not-a-string");
  assert.equal(found.length, 2);
});

test("requiring and forbidding the same string is an error — the case can never pass", () => {
  const suite = validSuite({
    cases: [
      {
        id: "a",
        input: "hello",
        expected_contains: ["30 days"],
        must_not_contain: ["30 days"],
      },
    ],
  });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("assertion-contradiction"));
});

test("a regex that does not compile is an error", () => {
  const suite = validSuite({
    cases: [{ id: "a", input: "hello", expected_regex: "([unclosed" }],
  });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("regex-invalid"));
});

test("a valid regex, as a string or an array of strings, is accepted", () => {
  for (const value of ["\\d{4}-\\d{2}-\\d{2}", ["^yes", "\\bno\\b"]]) {
    const suite = validSuite({ cases: [{ id: "a", input: "hello", expected_regex: value }] });
    const found = codes(check(suite, { minCases: 0 })).filter((c) => c.startsWith("regex-"));
    assert.deepEqual(found, [], `${JSON.stringify(value)} should compile`);
  }
});

test("a non-string regex is an error", () => {
  const suite = validSuite({ cases: [{ id: "a", input: "hello", expected_regex: 42 }] });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("regex-not-a-string"));
});

// ─────────────────────────────────────────────────────────────────────────
// Dataset hygiene
// ─────────────────────────────────────────────────────────────────────────

test("placeholder text anywhere in a case is a warning", () => {
  for (const placeholder of ["TODO: write this", "FIXME later", "TBD", "lorem ipsum dolor"]) {
    const suite = validSuite({
      cases: [{ id: "a", input: placeholder, expected_contains: ["something"] }],
    });
    assert.ok(
      codes(check(suite, { minCases: 0 })).includes("case-placeholder-text"),
      `"${placeholder}" should be flagged`,
    );
  }
});

test("placeholder text is reported once per case, not once per pattern", () => {
  const suite = validSuite({
    cases: [{ id: "a", input: "TODO and FIXME and TBD", expected_contains: ["x"] }],
  });
  const found = check(suite, { minCases: 0 }).filter((f) => f.code === "case-placeholder-text");
  assert.equal(found.length, 1);
});

test("a credential committed inside a case is an error", () => {
  const suite = validSuite({
    cases: [
      {
        id: "a",
        input: "My key is sk-abcdefghijklmnopqrstuvwxyz0123, is it valid?",
        expected_contains: ["cannot check"],
      },
    ],
  });
  const findings = check(suite, { minCases: 0 });
  const secret = findings.find((f) => f.code === "secret-in-dataset");
  assert.ok(secret);
  assert.equal(secret.level, "error");
  assert.match(secret.fix, /rotate/i);
});

test("a secret hidden deep inside a nested case value is still found", () => {
  const suite = validSuite({
    cases: [
      {
        id: "a",
        input: { messages: [{ role: "user", content: "AKIAIOSFODNN7EXAMPLE" }] },
        expected_contains: ["redacted"],
      },
    ],
  });
  assert.ok(codes(check(suite, { minCases: 0 })).includes("secret-in-dataset"));
});

test("a suite scored only by LLM judges warns about the cost and the judge's mistakes", () => {
  const suite = validSuite({
    cases: Array.from({ length: RULES.minCases }, (_, i) => ({
      id: `case-${i + 1}`,
      input: `Question ${i + 1}`,
      rubric: "The answer is polite and correct.",
    })),
  });
  const findings = check(suite);
  const judge = findings.find((f) => f.code === "judge-only-suite");
  assert.ok(judge);
  assert.equal(judge.level, "warn");
});

test("one deterministic case is enough to silence the judge-only warning", () => {
  const cases = Array.from({ length: RULES.minCases }, (_, i) => ({
    id: `case-${i + 1}`,
    input: `Question ${i + 1}`,
    rubric: "Polite and correct.",
  }));
  cases[0].expected_contains = ["30 days"];
  assert.ok(!codes(check(validSuite({ cases }))).includes("judge-only-suite"));
});

test("a suite smaller than the minimum warns but does not fail", () => {
  const suite = validSuite({ cases: [validCase(1)] });
  const findings = check(suite);
  const few = findings.find((f) => f.code === "too-few-cases");
  assert.ok(few);
  assert.equal(few.level, "warn");
  assert.equal(findings.filter((f) => f.level === "error").length, 0);
});

test("--min-cases 0 turns the size warning off", () => {
  assert.deepEqual(check(validSuite({ cases: [validCase(1)] }), { minCases: 0 }), []);
});

// ─────────────────────────────────────────────────────────────────────────
// discoverDatasets
// ─────────────────────────────────────────────────────────────────────────

test("discoverDatasets finds every .json file in a folder, in a stable order", (t) => {
  const dir = makeEvalsDir(t, {
    "b.json": validSuite(),
    "a.json": validSuite(),
    "notes.md": "not a dataset",
  });
  const found = discoverDatasets(dir, dir);
  assert.deepEqual(
    found.map((f) => f.relPath),
    ["a.json", "b.json"],
  );
});

test("discoverDatasets accepts a single file as well as a folder", (t) => {
  const dir = makeEvalsDir(t, { "only.json": validSuite() });
  const found = discoverDatasets(path.join(dir, "only.json"), dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].relPath, "only.json");
});

// ─────────────────────────────────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────────────────────────────────

test("parseArgs defaults to ./evals", () => {
  assert.deepEqual(parseArgs([]).targets, ["evals"]);
});

test("parseArgs reads positional paths and repeated --dir flags", () => {
  assert.deepEqual(parseArgs(["a.json", "--dir", "b", "c.json"]).targets, ["a.json", "b", "c.json"]);
});

test("parseArgs reads the boolean flags", () => {
  const opts = parseArgs(["--strict", "--json", "--quiet"]);
  assert.equal(opts.strict, true);
  assert.equal(opts.json, true);
  assert.equal(opts.quiet, true);
});

test("parseArgs reads --min-cases and rejects a value that is not a whole number", () => {
  assert.equal(parseArgs(["--min-cases", "3"]).minCases, 3);
  assert.match(parseArgs(["--min-cases", "abc"]).error, /whole number/);
  assert.match(parseArgs(["--min-cases", "-2"]).error, /whole number/);
  assert.match(parseArgs(["--min-cases"]).error, /needs a number/);
});

test("parseArgs rejects an unknown option rather than treating it as a path", () => {
  assert.match(parseArgs(["--nope"]).error, /unknown option/);
});

// ─────────────────────────────────────────────────────────────────────────
// main() — exit codes and output modes
// ─────────────────────────────────────────────────────────────────────────

test("main returns 0 on a clean dataset folder", (t) => {
  const dir = makeEvalsDir(t, { "dataset.json": validSuite() });
  assert.equal(main([dir, "--quiet"], dir), 0);
});

test("main returns 1 when a dataset has an error", (t) => {
  const suite = validSuite();
  delete suite.threshold;
  const dir = makeEvalsDir(t, { "dataset.json": suite });
  assert.equal(main([dir, "--json"], dir), 1);
});

test("main returns 0 on warnings alone, and 1 for the same file under --strict", (t) => {
  const dir = makeEvalsDir(t, { "dataset.json": validSuite({ cases: [validCase(1)] }) });
  assert.equal(main([dir, "--json"], dir), 0);
  assert.equal(main([dir, "--json", "--strict"], dir), 1);
});

test("main returns 2 for a path that does not exist", (t) => {
  const dir = makeEvalsDir(t, {});
  assert.equal(main([path.join(dir, "nope")], dir), 2);
});

test("main returns 2 when a folder holds no dataset, rather than reporting success", (t) => {
  // A silent pass here would mean "your evals are fine" for a project that has
  // no evals at all — the exact false assurance this gate exists to prevent.
  const dir = makeEvalsDir(t, { "readme.md": "nothing here" });
  assert.equal(main([dir], dir), 2);
});

test("main returns 0 for --help", () => {
  assert.equal(main(["--help"]), 0);
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end through the real CLI, on whatever platform this is
// ─────────────────────────────────────────────────────────────────────────

/** Spawn the script the way CI does, and return its result. */
function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
}

test("the CLI exits 0 and says so on a clean dataset", (t) => {
  const dir = makeEvalsDir(t, { "dataset.json": validSuite() });
  const res = run([dir], dir);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /no errors/);
});

test("the CLI exits 1 and names the offending code on a broken dataset", (t) => {
  const suite = validSuite({ cases: [{ id: "a", input: "hello" }] });
  const dir = makeEvalsDir(t, { "dataset.json": suite });
  const res = run([dir, "--min-cases", "0"], dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /case-no-assertion/);
});

test("the CLI emits parseable JSON under --json", (t) => {
  const dir = makeEvalsDir(t, { "dataset.json": validSuite() });
  const res = run([dir, "--json"], dir);
  const parsed = JSON.parse(res.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.scanned.length, 1);
});

test("the CLI exits 2 on an unknown option", (t) => {
  const dir = makeEvalsDir(t, { "dataset.json": validSuite() });
  const res = run([dir, "--definitely-not-a-flag"], dir);
  assert.equal(res.status, 2);
});

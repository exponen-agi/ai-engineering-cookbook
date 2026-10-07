/**
 * Unit tests for scripts/check-hidden-chars.js.
 *
 * The expensive failure is a false negative \u2014 a hidden character in a doc
 * that the gate waves through \u2014 so most tests plant one and assert it is
 * found at the right place. Every hidden character below is written as a
 * \u escape, so this file itself stays clean and is not on the ignore list.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_IGNORES,
  findEmojiInLinkTargets,
  scanText,
  collectFiles,
  parseArgs,
  main,
} = require("../scripts/check-hidden-chars.js");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Build a throwaway tree. `files` maps a relative POSIX path to contents. */
function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hidden-chars-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

/** Run main() with stdout/stderr captured. */
function run(argv, root) {
  const out = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => out.push(String(s)) && true;
  process.stderr.write = (s) => out.push(String(s)) && true;
  try {
    return { code: main(argv, root), output: out.join("") };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

// \u2500\u2500 the link-target rule \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

test("a variation selector inside an inline link target is an error", () => {
  const hits = findEmojiInLinkTargets("See [map](#\uFE0F-extension-map).");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "emoji-joiner-in-link");
  assert.equal(hits[0].level, "error");
  assert.equal(hits[0].codePoint, "U+FE0F");
  assert.equal(hits[0].line, 1);
  assert.equal(hits[0].column, 12);
});

test("a zero-width joiner inside a reference definition is an error", () => {
  const hits = findEmojiInLinkTargets("text\n\n[ref]: ./docs/a\u200Db.md\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].codePoint, "U+200D");
  assert.equal(hits[0].line, 3);
});

test("emoji in prose and in link TEXT are not flagged", () => {
  const md = "## \u{1F5FA}\uFE0F Map\n\n[\u{1F469}\u200D\u{1F4BB} dev guide](./docs/dev.md)\n";
  assert.deepEqual(findEmojiInLinkTargets(md), []);
  assert.deepEqual(scanText("README.md", md), []);
});

test("the link rule only applies to Markdown files", () => {
  const js = 'const s = "[x](#\uFE0F-a)";';
  assert.deepEqual(scanText("a.js", js), []);
  assert.equal(scanText("a.md", js).length, 1);
});

// \u2500\u2500 the shared character rules \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

test("reuses check-skills' rules: zero-width space and bidi override are errors", () => {
  const hits = scanText("docs/guide.md", "safe\u200Btext\nabc\u202Edef\n");
  assert.deepEqual(
    hits.map((h) => [h.id, h.level, h.line]),
    [
      ["zero-width", "error", 1],
      ["bidi-override", "error", 2],
    ],
  );
  assert.ok(hits.every((h) => h.file === "docs/guide.md"));
});

// \u2500\u2500 file discovery \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

test("collectFiles skips node_modules and .git, and non-text extensions", () => {
  const dir = makeTree({
    "docs/a.md": "ok",
    "node_modules/x/README.md": "skip",
    ".git/HEAD": "skip",
    "img/logo.png": "skip",
    "scripts/b.js": "ok",
  });
  const rels = collectFiles(dir, dir).map((f) => f.relPath);
  assert.deepEqual(rels, ["docs/a.md", "scripts/b.js"]);
});

// \u2500\u2500 the CLI \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

test("main exits 1 and names file:line:column for a hidden character in docs/", () => {
  const dir = makeTree({ "docs/guide.md": "line one\nbad\u2060here\n" });
  const { code, output } = run(["--quiet"], dir);
  assert.equal(code, 1);
  assert.match(output, /docs\/guide\.md:2:4/);
  assert.match(output, /zero-width/);
});

test("warnings pass by default and fail under --strict", () => {
  const dir = makeTree({ "a.md": "soft\u00ADhyphen" });
  assert.equal(run(["--quiet"], dir).code, 0);
  assert.equal(run(["--quiet", "--strict"], dir).code, 1);
});

test("--ignore skips a path; the default ignore list always applies", () => {
  const dir = makeTree({
    "fixtures/bad.md": "x\u200By",
    "test/check-skills.test.js": "x\u200By",
  });
  assert.equal(run(["--quiet"], dir).code, 1);
  assert.equal(run(["--quiet", "--ignore", "fixtures"], dir).code, 0);
  assert.ok(DEFAULT_IGNORES.includes("test/check-skills.test.js"));
});

test("--json reports ok and the findings", () => {
  const dir = makeTree({ "a.md": "[x](#\uFE0F-a)" });
  const { code, output } = run(["--json"], dir);
  assert.equal(code, 1);
  const report = JSON.parse(output);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].id, "emoji-joiner-in-link");
});

test("usage errors exit 2", () => {
  assert.equal(parseArgs(["--bogus"]).error, 'unknown option "--bogus"');
  assert.equal(run(["--ignore"], REPO_ROOT).code, 2);
  assert.equal(run(["does-not-exist"], REPO_ROOT).code, 2);
});

// \u2500\u2500 this repository \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

test("this repository passes its own gate under --strict", () => {
  const { code, output } = run(["--strict"], REPO_ROOT);
  assert.equal(code, 0, output);
});

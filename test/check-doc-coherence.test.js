/**
 * Unit tests for scripts/check-doc-coherence.js.
 *
 * The script is a CLI, so these tests run it as a child process against
 * throwaway fixture repos and assert on its exit code and `--json` output.
 * Exit codes are the contract CI relies on: 0 = clean, 1 = drift, 2 = bad config.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const SCRIPT = path.resolve(__dirname, "..", "scripts", "check-doc-coherence.js");

/**
 * Build a temp repo from `{ "relative/path.md": "contents" }` plus a config
 * object, then run the gate against it.
 */
function runGate(files, config, extraArgs = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coherence-fixture-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }

  const configPath = path.join(root, "coherence.config.json");
  if (config !== null) fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--config", configPath, ...extraArgs],
    { encoding: "utf8" },
  );
  return { ...result, root };
}

const BASE_CONFIG = {
  include: ["**/*.md"],
  ignore: ["node_modules/**"],
  generated: [".claude/skills/**"],
  authorityOrder: ["README.md"],
  facts: [
    {
      id: "greeting",
      title: "How we greet",
      owner: "README.md",
      rule: "owner-only",
      markers: ["the one true greeting"],
      allow: [],
    },
  ],
};

test("exits 0 when the marker appears only in its owner", () => {
  const { status, stdout } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      "docs/guide.md": "# Guide\n\nSee the [README](../README.md).\n",
    },
    BASE_CONFIG,
  );

  assert.equal(status, 0);
  assert.match(stdout, /no drift/);
});

test("exits 1 and reports file:line when a non-owner restates the marker", () => {
  const { status, stdout } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      "docs/guide.md": "# Guide\n\nline two\nThis is the one true greeting.\n",
    },
    BASE_CONFIG,
    ["--json"],
  );

  assert.equal(status, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, false);
  assert.equal(report.violations.length, 1);
  assert.equal(report.violations[0].file, "docs/guide.md");
  assert.equal(report.violations[0].line, 4);
  assert.equal(report.violations[0].factId, "greeting");
});

test("a file on the fact's allow list may restate the marker", () => {
  const config = structuredClone(BASE_CONFIG);
  config.facts[0].allow = ["docs/guide.md"];

  const { status } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      "docs/guide.md": "# Guide\n\nThis is the one true greeting.\n",
    },
    config,
  );

  assert.equal(status, 0);
});

test("generated output is never blamed for drift", () => {
  const { status } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      ".claude/skills/copy/SKILL.md": "This is the one true greeting.\n",
    },
    BASE_CONFIG,
  );

  assert.equal(status, 0);
});

test("ignored paths are not scanned", () => {
  const { status } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      "node_modules/pkg/README.md": "This is the one true greeting.\n",
    },
    BASE_CONFIG,
  );

  assert.equal(status, 0);
});

test("a stale registry warns but does not fail the build", () => {
  const config = structuredClone(BASE_CONFIG);
  config.facts[0].markers = ["a phrase nobody wrote"];

  const { status, stdout } = runGate({ "README.md": "# Readme\n" }, config, ["--json"]);

  assert.equal(status, 0, "registry warnings are advisory");
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.match(report.configWarnings.join("\n"), /stale registry/);
});

test("warns when the owner anchor matches no heading in the owner file", () => {
  const config = structuredClone(BASE_CONFIG);
  config.facts[0].owner = "README.md#no-such-heading";

  const { status, stdout } = runGate(
    { "README.md": "# Readme\n\nThis is the one true greeting.\n" },
    config,
    ["--json"],
  );

  assert.equal(status, 0);
  assert.match(JSON.parse(stdout).configWarnings.join("\n"), /no matching heading/);
});

test("emoji and punctuation in headings still resolve the owner anchor", () => {
  const config = structuredClone(BASE_CONFIG);
  config.facts[0].owner = "README.md#how-we-greet";

  const { status, stdout } = runGate(
    { "README.md": "# 👋 How we greet!\n\nThis is the one true greeting.\n" },
    config,
    ["--json"],
  );

  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(stdout).configWarnings, []);
});

test("exits 2 when the config file is missing", () => {
  const { status } = runGate({ "README.md": "# Readme\n" }, null);
  assert.equal(status, 2);
});

test("exits 2 when the config file is not valid JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coherence-fixture-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "README.md"), "# Readme\n");
  const configPath = path.join(root, "coherence.config.json");
  fs.writeFileSync(configPath, "{ not json");

  const { status, stderr } = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--config", configPath],
    { encoding: "utf8" },
  );

  assert.equal(status, 2);
  assert.match(stderr, /could not parse config/);
});

test("this repository's own docs pass the gate", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const { status } = spawnSync(process.execPath, [SCRIPT, "--root", repoRoot], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  assert.equal(status, 0, "run `node scripts/check-doc-coherence.js` to see the drift");
});

// ─────────────────────────────────────────────────────────────────────────
// --strict: a stale registry is a silent failure without it
//
// The failure mode these cover is not drift. It is a fact that has quietly
// stopped being enforced — the marker was reworded, the owner was renamed,
// the anchor moved — while the gate kept printing a tick. Advisory by
// default so somebody else's registry does not break their first run;
// blocking under --strict, which is how this repo runs it.
// ─────────────────────────────────────────────────────────────────────────

test("a reworded marker is advisory by default and blocking under --strict", () => {
  const files = {
    // The owner no longer contains the marker the registry declares, so the
    // fact now protects nothing.
    "README.md": "# Readme\n\nThis is our greeting, reworded.\n",
    "docs/guide.md": "# Guide\n\nnothing to see\n",
  };

  const lenient = runGate(files, BASE_CONFIG);
  assert.equal(lenient.status, 0, "default behaviour stays advisory");
  assert.match(lenient.stdout, /Registry warnings/);

  const strict = runGate(files, BASE_CONFIG, ["--strict"]);
  assert.equal(strict.status, 1, "--strict must fail on a fact that checks nothing");
  assert.match(strict.stdout, /registry warning/i);
});

test("an owner file that no longer exists fails under --strict", () => {
  const config = {
    ...BASE_CONFIG,
    facts: [{ ...BASE_CONFIG.facts[0], owner: "MOVED.md" }],
  };
  const files = { "README.md": "# Readme\n\nThis is the one true greeting.\n" };

  assert.equal(runGate(files, config).status, 0);
  assert.equal(runGate(files, config, ["--strict"]).status, 1);
});

test("an anchor with no matching heading fails under --strict", () => {
  const config = {
    ...BASE_CONFIG,
    facts: [{ ...BASE_CONFIG.facts[0], owner: "README.md#no-such-heading" }],
  };
  const files = { "README.md": "# Readme\n\nThis is the one true greeting.\n" };

  assert.equal(runGate(files, config).status, 0);
  assert.equal(runGate(files, config, ["--strict"]).status, 1);
});

test("--strict changes nothing when the registry is healthy", () => {
  const files = {
    "README.md": "# Readme\n\nThis is the one true greeting.\n",
    "docs/guide.md": "# Guide\n\nSee the [README](../README.md).\n",
  };
  const { status, stdout } = runGate(files, BASE_CONFIG, ["--strict"]);
  assert.equal(status, 0);
  assert.match(stdout, /no drift/);
});

test("--strict still fails on real drift, and says drift rather than registry", () => {
  const { status, stdout } = runGate(
    {
      "README.md": "# Readme\n\nThis is the one true greeting.\n",
      "docs/guide.md": "# Guide\n\nThis is the one true greeting.\n",
    },
    BASE_CONFIG,
    ["--strict"],
  );
  assert.equal(status, 1);
  assert.match(stdout, /drift violation/);
});

test("--json reports registry warnings whether or not --strict is set", () => {
  const files = { "README.md": "# Readme\n\nreworded\n" };
  for (const args of [["--json"], ["--json", "--strict"]]) {
    const { stdout } = runGate(files, BASE_CONFIG, args);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.configWarnings.length > 0, `configWarnings missing for ${args.join(" ")}`);
  }
});

test("this repository's own registry is healthy under --strict", () => {
  // The repo runs `npm run lint:docs` with --strict in CI, so if a marker
  // sentence in README.md is ever reworded, this is what says so.
  const result = spawnSync(process.execPath, [SCRIPT, "--strict"], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, ".."),
  });
  assert.equal(result.status, 0, `the repo's own registry has gone stale:\n${result.stdout}`);
});

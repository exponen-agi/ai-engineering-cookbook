/**
 * Unit tests for scripts/check-toolchain.js.
 *
 * The toolchain gate is a CI job: it fails the PR when the Node baseline, the
 * `.nvmrc`, the CI matrices and the docs stop agreeing, or when a version pin
 * is dropped from a `npm install -g` step. That makes its *false negatives*
 * the expensive failure — a gate that quietly passes on broken input is worse
 * than no gate — so most of these tests feed it deliberately broken fixtures
 * and assert it complains about the right thing.
 *
 * Fixtures are throwaway temp directories. The one exception is the last
 * block, which runs the gate against this repository, because "the repo it
 * ships in is clean" is exactly the promise CI makes.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  checkToolchain,
  parseEnginesMajor,
  parseNvmrcMajor,
  resolveWorkflowEnv,
  parseWorkflowNodeVersions,
  parseGlobalInstalls,
  parseNodeClaims,
  parseLegacySpecKitRefs,
  SPECKIT_STEPS,
  normalizeClaimLine,
  parseActionUses,
  checkActionPins,
  NODE_EOL,
  MUTABLE_ACTION_REFS,
} = require("../scripts/check-toolchain.js");

const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * Build a throwaway repo. `files` maps a repo-relative path (POSIX-style, for
 * readability) to its contents; parent directories are created as needed.
 */
function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toolchain-fixture-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The smallest repo that passes every check, as a base to break one thing at a time. */
function healthyRepo(overrides = {}) {
  return makeRepo({
    "package.json": JSON.stringify({ name: "x", engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    ".github/workflows/ci.yml": [
      "env:",
      '  CSPELL_VERSION: "10.2.0"',
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: actions/setup-node@v4",
      "        with:",
      '          node-version: "24"',
      "      - run: npm install -g cspell@${{ env.CSPELL_VERSION }}",
    ].join("\n"),
    "README.md": "# x\n\nRequires **Node.js 22+**.\n",
    ...overrides,
  });
}

/** Assert that exactly one error mentions `needle`, and return it. */
function oneErrorMatching(result, needle) {
  const hits = result.errors.filter((e) => e.includes(needle));
  assert.equal(
    hits.length,
    1,
    `expected exactly one error mentioning "${needle}", got:\n${result.errors.join("\n")}`,
  );
  return hits[0];
}

// --- parsers ------------------------------------------------------------

test("parseEnginesMajor reads every range form npm accepts", () => {
  assert.equal(parseEnginesMajor(">=22"), 22);
  assert.equal(parseEnginesMajor(">= 22.0.0"), 22);
  assert.equal(parseEnginesMajor("^24"), 24);
  assert.equal(parseEnginesMajor("24.x"), 24);
  assert.equal(parseEnginesMajor("22"), 22);
});

test("parseEnginesMajor returns null rather than guessing", () => {
  assert.equal(parseEnginesMajor("latest"), null);
  assert.equal(parseEnginesMajor(""), null);
  assert.equal(parseEnginesMajor(undefined), null);
  assert.equal(parseEnginesMajor(22), null);
});

test("parseNvmrcMajor ignores comments, blanks and a leading v", () => {
  assert.equal(parseNvmrcMajor("24\n"), 24);
  assert.equal(parseNvmrcMajor("v24.3.0\n"), 24);
  assert.equal(parseNvmrcMajor("# use LTS\n\n  22  \n"), 22);
  assert.equal(parseNvmrcMajor("# nothing here\n"), null);
});

test("resolveWorkflowEnv substitutes top-level env references", () => {
  const yaml = [
    "env:",
    '  CSPELL_VERSION: "10.2.0"',
    "  NODE_DEFAULT: 24  # trailing comment",
    "jobs:",
    "  a:",
    "    steps:",
    "      - run: npm install -g cspell@${{ env.CSPELL_VERSION }}",
    "      - uses: x",
    "        with:",
    "          node-version: ${{ env.NODE_DEFAULT }}",
  ].join("\n");

  const out = resolveWorkflowEnv(yaml);
  assert.match(out, /npm install -g cspell@10\.2\.0/);
  assert.match(out, /node-version: 24/);
});

test("resolveWorkflowEnv leaves unknown references untouched", () => {
  // A job-level env or a repo secret is not resolvable here. Leaving the
  // literal in place is correct: the pin check then reports it, which is the
  // safe direction to be wrong in.
  const out = resolveWorkflowEnv("jobs:\n  a:\n    steps:\n      - run: npm i -g x@${{ env.NOPE }}\n");
  assert.match(out, /\$\{\{\s*env\.NOPE\s*\}\}/);
});

test("resolveWorkflowEnv stops at the end of the top-level env block", () => {
  const yaml = ["env:", '  A: "1.0.0"', "", "  # still in the block", '  B: "2.0.0"', "jobs:", '  C: "3.0.0"'].join(
    "\n",
  );
  const out = resolveWorkflowEnv(
    yaml + "\n      - run: npm i -g a@${{ env.A }} b@${{ env.B }} c@${{ env.C }}\n",
  );
  assert.match(out, /a@1\.0\.0/);
  assert.match(out, /b@2\.0\.0/, "blank lines and comments must not end the block");
  assert.match(out, /c@\$\{\{\s*env\.C\s*\}\}/, "a key nested under jobs: is not a top-level env var");
});

test("parseWorkflowNodeVersions reads both the single and matrix forms", () => {
  const yaml = [
    "        node: [\"22\", \"24\"]",
    "          node-version: '20'",
    "          node-version: 18",
  ].join("\n");
  assert.deepEqual(parseWorkflowNodeVersions(yaml), [20, 18, 22, 24]);
});

test("parseWorkflowNodeVersions skips a matrix indirection", () => {
  // `node-version: ${{ matrix.node }}` carries no version of its own; the
  // matrix line it points at is checked separately. Counting it would either
  // crash or invent a number.
  const yaml = "          node-version: ${{ matrix.node }}\n        node: [\"22\"]\n";
  assert.deepEqual(parseWorkflowNodeVersions(yaml), [22]);
});

test("parseGlobalInstalls distinguishes a pinned install from a floating one", () => {
  const yaml = [
    "      - run: npm install -g markdownlint-cli@0.49.1",
    "      - run: npm i --global cspell",
    "      - run: npm install -g @scope/pkg@1.2.3",
    "      - run: npm install -g a@1.2.3 b@2.0.0",
  ].join("\n");

  assert.deepEqual(parseGlobalInstalls(yaml), [
    { spec: "markdownlint-cli@0.49.1", pinned: true },
    { spec: "cspell", pinned: false },
    { spec: "@scope/pkg@1.2.3", pinned: true },
    { spec: "a@1.2.3", pinned: true },
    { spec: "b@2.0.0", pinned: true },
  ]);
});

test("parseGlobalInstalls rejects a range as a pin", () => {
  // "^1.2.3" and "latest" both let CI resolve a different build tomorrow,
  // which is the exact failure this gate exists to prevent.
  const found = parseGlobalInstalls("      - run: npm install -g a@^1.2.3 b@latest c@1.2\n");
  assert.deepEqual(
    found.map((f) => f.pinned),
    [false, false, false],
  );
});

test("parseGlobalInstalls ignores flags and a local install", () => {
  const yaml = [
    "      - run: npm install -g --no-audit cspell@10.2.0",
    "      - run: npm install markdownlint-cli", // local, not global
  ].join("\n");
  assert.deepEqual(parseGlobalInstalls(yaml), [{ spec: "cspell@10.2.0", pinned: true }]);
});

test("parseNodeClaims finds the minimum-version promises docs actually make", () => {
  const md = [
    "Requires **Node.js 18+**.",
    "You need Node 20 or newer.",
    "This requires Node.js 16 on PATH.",
    "We tested against Node 24 last Tuesday.",
  ].join("\n");

  assert.deepEqual(
    parseNodeClaims(md).map((c) => [c.line, c.major]),
    [
      [1, 18],
      [2, 20],
      [3, 16],
    ],
    "a bare mention of a version is not a promise and must not be flagged",
  );
});

test("parseNodeClaims skips fenced code blocks", () => {
  // This gate's own documentation quotes its own failure output, which
  // contains the very string the patterns look for. A transcript is not a
  // promise to the reader, so fences are skipped.
  const md = [
    "Real prose: requires Node 18.",
    "```text",
    "  • docs/x.md:1 tells readers Node 16 is enough",
    "Requires **Node.js 14+**.",
    "```",
    "~~~markdown",
    "Node 12 or newer.",
    "~~~",
    "More prose: Node 20+.",
  ].join("\n");

  assert.deepEqual(
    parseNodeClaims(md).map((c) => [c.line, c.major]),
    [
      [1, 18],
      [9, 20],
    ],
  );
});

test("parseNodeClaims handles a longer fence wrapping a shorter one", () => {
  const md = ["````markdown", "```", "Requires Node 14+.", "```", "````", "Requires Node 22+."].join("\n");
  assert.deepEqual(
    parseNodeClaims(md).map((c) => c.major),
    [22],
  );
});

test("parseNodeClaims honours the toolchain-ignore escape hatch", () => {
  const md = "Node 18+ was the baseline until 2026. <!-- toolchain-ignore -->\n";
  assert.deepEqual(parseNodeClaims(md), []);
});

// --- legacy Spec-Kit command form ---------------------------------------

test("parseLegacySpecKitRefs finds the dot form and leaves the hyphen form alone", () => {
  const md = [
    "Run /speckit.specify to start.", // 1 — stale
    "Then /speckit-plan is current.", // 2 — fine
    "And `/speckit.tasks` in ticks.", // 3 — stale
  ].join("\n");

  assert.deepEqual(
    parseLegacySpecKitRefs(md).map((h) => [h.line, h.step]),
    [
      [1, "specify"],
      [3, "tasks"],
    ],
  );
});

test("parseLegacySpecKitRefs scans inside fenced code blocks", () => {
  // The opposite of parseNodeClaims, and deliberately so: a fenced block is
  // what a reader copies, so a wrong prefix inside one is the whole problem.
  const md = ["```bash", "/speckit.plan", "```"].join("\n");

  assert.deepEqual(
    parseLegacySpecKitRefs(md).map((h) => h.step),
    ["plan"],
  );
});

test("parseLegacySpecKitRefs honours the speckit-legacy-ok escape hatch", () => {
  const md = "The old form was `/speckit.specify`. <!-- speckit-legacy-ok -->\n";
  assert.deepEqual(parseLegacySpecKitRefs(md), []);
});

test("parseLegacySpecKitRefs honours the marker on a fence info string", () => {
  // An HTML comment inside a fenced block would render as visible text, so a
  // block-level exemption has to live somewhere invisible: the info string.
  const md = ["```text speckit-legacy-ok", "/speckit.specify", "```"].join("\n");
  assert.deepEqual(parseLegacySpecKitRefs(md), []);
});

test("a fence exemption stops at the closing fence", () => {
  const md = [
    "```text speckit-legacy-ok",
    "/speckit.plan", // 2 — exempt
    "```",
    "/speckit.tasks", // 4 — NOT exempt
  ].join("\n");

  assert.deepEqual(
    parseLegacySpecKitRefs(md).map((h) => [h.line, h.step]),
    [[4, "tasks"]],
  );
});

test("an unmarked fence is still scanned after a marked one", () => {
  const md = [
    "```text speckit-legacy-ok",
    "/speckit.plan",
    "```",
    "```bash",
    "/speckit.specify", // 5 — plain fence, must be caught
    "```",
  ].join("\n");

  assert.deepEqual(
    parseLegacySpecKitRefs(md).map((h) => h.step),
    ["specify"],
  );
});

test("parseLegacySpecKitRefs ignores a dot that is not a Spec-Kit step", () => {
  // "speckit.io" or a sentence ending in "speckit." must not be reported, or
  // the gate becomes noise and gets switched off.
  const md = "See speckit.io, and nothing about speckit.frobnicate here.\n";
  assert.deepEqual(parseLegacySpecKitRefs(md), []);
});

test("parseLegacySpecKitRefs reports every occurrence on one line", () => {
  const md = "Run /speckit.specify then /speckit.plan.\n";
  assert.deepEqual(
    parseLegacySpecKitRefs(md).map((h) => h.step),
    ["specify", "plan"],
  );
});

test("SPECKIT_STEPS covers the steps this repo's docs name", () => {
  // If upstream adds a step and the docs adopt it, the dot form of that step
  // would otherwise slip through unnoticed. This is the tripwire.
  for (const step of ["constitution", "specify", "plan", "tasks", "implement", "converge"]) {
    assert.ok(SPECKIT_STEPS.has(step), `missing Spec-Kit step: ${step}`);
  }
});

test("the gate fails a doc that tells readers to type the legacy form", () => {
  const result = checkToolchain({
    root: healthyRepo({ "docs/guide.md": "Run `/speckit.specify` first.\n" }),
    now: new Date("2026-09-02"),
  });

  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "docs/guide.md");
  assert.match(err, /legacy Spec-Kit command form/);
  assert.match(err, /\/speckit-specify/); // names the fix, not just the fault
  assert.equal(result.stats.legacySpecKit, 1);
});

test("append-only history may keep the legacy Spec-Kit form", () => {
  // A journal entry recording "we used /speckit.specify back then" is accurate
  // history. Same exemption the Node-claim check already makes.
  const result = checkToolchain({
    root: healthyRepo({
      ".ai/traces/AGENT_LOG_REFLECTIONS.md": "We ran /speckit.specify then.\n",
      "postmortems/POSTMORTEM_AND_LEARNING_LOG.md": "Caused by /speckit.plan.\n",
    }),
    now: new Date("2026-09-02"),
  });

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.stats.legacySpecKit, 0);
});

// --- the gate end to end ------------------------------------------------

test("a consistent repo passes with no errors or warnings", () => {
  const result = checkToolchain({ root: healthyRepo(), now: new Date("2026-09-02") });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.baseline, 22);
  assert.equal(result.stats.globalInstalls, 1);
});

test("fails when .nvmrc is older than the engines baseline", () => {
  const result = checkToolchain({ root: healthyRepo({ ".nvmrc": "20\n" }), now: new Date("2026-09-02") });
  assert.equal(result.ok, false);
  oneErrorMatching(result, ".nvmrc pins Node 20");
});

test("fails when .nvmrc is missing entirely", () => {
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-02") });
  assert.equal(result.ok, false);
  oneErrorMatching(result, ".nvmrc is missing");
});

test("fails when CI runs a Node version the package says it does not support", () => {
  const result = checkToolchain({
    root: healthyRepo({
      ".github/workflows/ci.yml": '        node: ["20", "24"]\n',
    }),
    now: new Date("2026-09-02"),
  });
  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "runs on Node 20");
  assert.match(err, /ci\.yml/, "the error must name the file to fix");
});

test("fails when a CI tool install loses its version pin", () => {
  const result = checkToolchain({
    root: healthyRepo({
      ".github/workflows/ci.yml": "      - run: npm install -g markdownlint-cli\n",
    }),
    now: new Date("2026-09-02"),
  });
  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "markdownlint-cli");
  assert.match(err, /without an exact version/);
});

test("fails when a doc promises an older Node than the package requires", () => {
  const result = checkToolchain({
    root: healthyRepo({ "docs/install.md": "\n\nRequires **Node.js 18+**.\n" }),
    now: new Date("2026-09-02"),
  });
  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "Node 18 is enough");
  assert.match(err, /docs\/install\.md:3/, "the error must give file and line");
});

test("reports every distinct problem in one run, not just the first", () => {
  // A contributor should be able to fix the whole thing in a single pass.
  const result = checkToolchain({
    root: healthyRepo({
      ".nvmrc": "20\n",
      ".github/workflows/ci.yml": '        node: ["20"]\n      - run: npm install -g cspell\n',
      "docs/install.md": "Requires **Node.js 18+**.\n",
    }),
    now: new Date("2026-09-02"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
});

test("warns without failing when the baseline is past its end-of-life", () => {
  // Advisory on purpose: a gate that turns red on a calendar date with no code
  // change is a time bomb. It must inform, not block.
  const result = checkToolchain({
    root: healthyRepo({
      "package.json": JSON.stringify({ engines: { node: ">=20" } }),
      "README.md": "Requires **Node.js 20+**.\n",
    }),
    now: new Date("2026-09-02"),
  });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Node 20 reached end-of-life on 2026-04-30/);
});

test("does not warn while the baseline is still supported upstream", () => {
  const result = checkToolchain({ root: healthyRepo(), now: new Date("2027-04-29") });
  assert.deepEqual(result.warnings, []);
});

test("reports a usable error instead of throwing on a broken package.json", () => {
  const missing = checkToolchain({ root: makeRepo({ "README.md": "x" }) });
  assert.equal(missing.ok, false);
  assert.match(missing.errors[0], /package\.json not found/);

  const broken = checkToolchain({ root: makeRepo({ "package.json": "{ not json" }) });
  assert.equal(broken.ok, false);
  assert.match(broken.errors[0], /not valid JSON/);

  const noEngines = checkToolchain({ root: makeRepo({ "package.json": "{}" }) });
  assert.equal(noEngines.ok, false);
  assert.match(noEngines.errors[0], /must declare/);
});

test("append-only history is not scanned for version claims", () => {
  // The reflections journal and the postmortem log record what was true at the
  // time. An entry saying "the floor was Node 18 back then" is accurate history,
  // not a promise to a reader — scanning them would make every future journal
  // entry that mentions a past baseline fail the build.
  const result = checkToolchain({
    root: healthyRepo({
      ".ai/traces/AGENT_LOG_REFLECTIONS.md": "Back then it required Node 18.\n",
      "postmortems/POSTMORTEM_AND_LEARNING_LOG.md": "Requires **Node.js 16+**.\n",
      ".ai/config/GUIDE.md": "Requires **Node.js 18+**.\n",
    }),
    now: new Date("2026-09-02"),
  });

  // .ai/config/ is live guidance, so it IS checked — only the history is exempt.
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  oneErrorMatching(result, ".ai/config/GUIDE.md");
});

test("a repo with no workflows is still checked, not skipped", () => {
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    "README.md": "Requires **Node.js 18+**.\n",
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-02") });
  assert.equal(result.ok, false);
  assert.equal(result.stats.workflows, 0);
  oneErrorMatching(result, "Node 18 is enough");
});

test("NODE_EOL covers every LTS line the repo may target", () => {
  // If someone raises the baseline to a major with no entry here, the
  // end-of-life warning silently stops working. This test is the tripwire.
  for (const major of [20, 22, 24, 26]) {
    assert.ok(NODE_EOL[major], `missing an end-of-life date for Node ${major}`);
    assert.match(NODE_EOL[major], /^\d{4}-\d{2}-\d{2}$/);
  }
});

// --- the real repository ------------------------------------------------

test("this repository's own toolchain is consistent", () => {
  const result = checkToolchain({ root: REPO_ROOT });
  assert.equal(
    result.ok,
    true,
    `check-toolchain found problems in this repo:\n${result.errors.join("\n")}`,
  );
});

test("this repository's baseline is a supported Node version", () => {
  const result = checkToolchain({ root: REPO_ROOT });
  assert.deepEqual(
    result.warnings,
    [],
    "the declared Node baseline has reached end-of-life — raise engines.node, .nvmrc and the CI matrix",
  );
});

// --- Markdown-emphasised Node claims (regression) ------------------------

test("normalizeClaimLine strips the punctuation between the name and the number", () => {
  assert.equal(normalizeClaimLine("**Node.js** (v18 or higher)"), "Node.js  v18 or higher)");
  assert.equal(normalizeClaimLine("`Node 20+`"), "Node 20+");
  assert.equal(normalizeClaimLine("_Node.js_ [22 or newer]"), "Node.js  22 or newer]");
  // Plain prose is untouched.
  assert.equal(normalizeClaimLine("Node 22 or newer"), "Node 22 or newer");
});

test("parseNodeClaims sees a claim wrapped in Markdown emphasis and brackets", () => {
  // The exact line that sat in docs/installation.md and passed the gate for
  // months: the emphasis markers and the opening bracket separated "Node.js"
  // from "v18", so none of the patterns matched.
  const claims = parseNodeClaims(
    "- **Node.js** (v18 or higher): Required if you are developing Node-based applications.\n",
  );
  assert.equal(claims.length, 1);
  assert.equal(claims[0].major, 18);
  assert.equal(claims[0].line, 1);
  // The reported text is the line as written, so the author can find it.
  assert.match(claims[0].text, /\*\*Node\.js\*\*/);
});

test("parseNodeClaims reads the other emphasised forms too", () => {
  const forms = {
    "`Node.js 20+` is required": 20,
    "* Node.js (18 or newer)": 18,
    "**Requires Node.js v16**": 16,
    "Node.js [22 or higher]": 22,
  };
  for (const [line, major] of Object.entries(forms)) {
    const claims = parseNodeClaims(line);
    assert.equal(claims.length, 1, `no claim found in ${JSON.stringify(line)}`);
    assert.equal(claims[0].major, major, `wrong major for ${JSON.stringify(line)}`);
  }
});

test("normalising does not invent a claim out of ordinary prose", () => {
  // The risk of stripping punctuation is a false positive, which would block
  // an innocent pull request. Each of these mentions Node and a number
  // without promising a minimum.
  const innocent = [
    "Node.js (see the table below) ships on a six-month cadence.",
    "We tested against 22 different repositories.",
    "The `node-version: 20` line in the example workflow is illustrative.",
    "Node 20 reached end-of-life in April 2026.",
  ];
  for (const line of innocent) {
    assert.deepEqual(parseNodeClaims(line), [], `false positive on ${JSON.stringify(line)}`);
  }
});

test("a stale claim in an emphasised prerequisites list fails the gate", () => {
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    "docs/installation.md": "## Prerequisites\n\n- **Node.js** (v18 or higher): required.\n",
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-09") });
  assert.equal(result.ok, false);
  oneErrorMatching(result, "docs/installation.md:3");
});

// --- GitHub Action pins --------------------------------------------------

test("parseActionUses reads the action and its ref", () => {
  const yaml = [
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@v7",
    '      - uses: "actions/setup-node@v7"',
    "      - uses: owner/action@a1b2c3d4  # a commit sha",
    "      - name: something",
    "        uses: another/action@v2.1.0",
  ].join("\n");

  const uses = parseActionUses(yaml);
  assert.deepEqual(
    uses.map((u) => [u.action, u.ref]),
    [
      ["actions/checkout", "v7"],
      ["actions/setup-node", "v7"],
      ["owner/action", "a1b2c3d4"],
      ["another/action", "v2.1.0"],
    ],
  );
  assert.ok(uses.every((u) => !u.mutable));
});

test("parseActionUses skips local and container actions", () => {
  const yaml = [
    "      - uses: ./.github/actions/local",
    "      - uses: docker://alpine:3.20",
    "      - uses: actions/checkout@v7",
  ].join("\n");
  assert.deepEqual(
    parseActionUses(yaml).map((u) => u.action),
    ["actions/checkout"],
  );
});

test("parseActionUses flags a ref with no version and a moving branch", () => {
  const uses = parseActionUses(
    ["      - uses: actions/checkout", "      - uses: owner/action@main"].join("\n"),
  );
  assert.equal(uses[0].ref, null);
  assert.equal(uses[1].mutable, true);
  for (const ref of MUTABLE_ACTION_REFS) {
    assert.equal(parseActionUses(`      - uses: o/a@${ref}`)[0].mutable, true);
  }
});

test("an action pinned to different refs in two workflows fails the gate", () => {
  // The half-finished bump: one Dependabot pull request merged, the other not.
  // Both files are valid YAML and both jobs go green, so nothing else notices.
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    ".github/workflows/a.yml": "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n",
    ".github/workflows/b.yml": "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n",
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-09") });
  assert.equal(result.ok, false);
  const msg = oneErrorMatching(result, "actions/checkout");
  assert.match(msg, /v4 and v7/);
  assert.equal(result.stats.actionUses, 2);
});

test("an unpinned or branch-pinned action fails the gate", () => {
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    ".github/workflows/ci.yml": [
      "jobs:",
      "  a:",
      "    steps:",
      "      - uses: actions/checkout",
      "      - uses: some/action@main",
      "",
    ].join("\n"),
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-09") });
  assert.equal(result.ok, false);
  oneErrorMatching(result, "with no version");
  oneErrorMatching(result, 'moving ref "main"');
});

test("consistent, tagged action pins pass", () => {
  const dir = makeRepo({
    "package.json": JSON.stringify({ engines: { node: ">=22" } }),
    ".nvmrc": "24\n",
    ".github/workflows/a.yml": "jobs:\n  a:\n    steps:\n      - uses: actions/checkout@v7\n",
    ".github/workflows/b.yml": "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v7\n",
  });
  const result = checkToolchain({ root: dir, now: new Date("2026-09-09") });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.stats.actionUses, 2);
});

test("checkActionPins is pure and reports nothing for a clean set", () => {
  const uses = [{ action: "actions/checkout", ref: "v7", mutable: false, file: "a.yml" }];
  const byAction = new Map([["actions/checkout", new Set(["v7"])]]);
  assert.deepEqual(checkActionPins(byAction, uses), []);
});

test("this repository pins every action to one ref per action", () => {
  // The repo-level promise: a reader copying these workflows gets pins that
  // agree with each other.
  const result = checkToolchain({ root: REPO_ROOT });
  assert.ok(result.stats.actionUses > 0, "no action pins were found to check");
  assert.deepEqual(
    result.errors.filter((e) => e.includes("pinned to")),
    [],
  );
});

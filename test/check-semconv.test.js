/**
 * Unit tests for scripts/check-semconv.js.
 *
 * The gate's whole value is catching a name that is wrong in a way nothing
 * else notices — a misspelled attribute still exports, still gets stored, and
 * only shows up as an empty dashboard panel. So the expensive failure here is
 * a *false negative*: a gate that passes on broken instrumentation is worse
 * than no gate, because it certifies it. Most of these tests therefore feed it
 * deliberately wrong input and assert it complains about the right thing, and
 * names the fix.
 *
 * The last block runs it against the example this repo ships, because "the
 * example a reader copies passes the gate" is the promise CI makes.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  checkSemconv,
  parseAttributes,
  parseOperationValues,
  suggest,
  editDistance,
  REGISTRY,
  DEPRECATED,
  OPERATIONS,
  CONTENT_BEARING,
  SNAPSHOT,
} = require("../scripts/check-semconv.js");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Build a throwaway tree. `files` maps a relative POSIX path to contents. */
function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "semconv-fixture-"));
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Scan a one-file fixture and return the result. */
function scanSource(body, name = "src/agent.js") {
  const root = makeTree({ [name]: body });
  return checkSemconv({ paths: [root], root });
}

/** Assert exactly one error mentions `needle`, and return it. */
function oneErrorMatching(result, needle) {
  const hits = result.errors.filter((e) => e.includes(needle));
  assert.equal(
    hits.length,
    1,
    `expected exactly one error mentioning "${needle}", got:\n${result.errors.join("\n")}`,
  );
  return hits[0];
}

// --- the registry itself ------------------------------------------------

test("the registry is populated and uses dotted gen_ai keys throughout", () => {
  assert.ok(REGISTRY.size > 50, `registry looks truncated: ${REGISTRY.size} entries`);
  for (const name of REGISTRY) {
    assert.match(name, /^gen_ai\.[a-z0-9_.]+$/, `odd registry key: ${name}`);
  }
});

test("the attributes this skill is built around are present", () => {
  // The skill spans exist because the conventions gained first-class skill
  // attributes. If these ever leave the registry, the skill's main claim is
  // stale and this test is the tripwire.
  for (const name of [
    "gen_ai.skill.name",
    "gen_ai.skill.description",
    "gen_ai.skill.source.uri",
    "gen_ai.skill.resource.name",
  ]) {
    assert.ok(REGISTRY.has(name), `missing skill attribute: ${name}`);
  }
});

test("no attribute is both current and deprecated", () => {
  // A name in both sets would make the two checks contradict each other, and
  // which one fired would depend on statement order.
  for (const name of DEPRECATED.keys()) {
    assert.ok(!REGISTRY.has(name), `${name} is in both REGISTRY and DEPRECATED`);
  }
});

test("every deprecated attribute points at a real replacement or none at all", () => {
  for (const [old, replacement] of DEPRECATED) {
    if (replacement === null) continue;
    // A replacement may legitimately leave the gen_ai namespace, e.g.
    // gen_ai.openai.request.service_tier became openai.request.service_tier.
    if (!replacement.startsWith("gen_ai.")) continue;
    assert.ok(
      REGISTRY.has(replacement),
      `${old} points at "${replacement}", which is not in the registry`,
    );
  }
});

test("every content-bearing attribute is a real attribute", () => {
  for (const name of CONTENT_BEARING) {
    assert.ok(REGISTRY.has(name), `content-bearing attribute not in registry: ${name}`);
  }
});

test("the snapshot is a plain ISO date", () => {
  // The conventions have no tagged release, so a date is all we can pin. It
  // has to stay machine-readable for anyone diffing two runs.
  assert.match(SNAPSHOT, /^\d{4}-\d{2}-\d{2}$/);
});

// --- parsers ------------------------------------------------------------

test("parseAttributes finds dotted names and ignores a trailing dot in prose", () => {
  const md = [
    'set("gen_ai.usage.input_tokens", 1)', // 1
    "Everything under gen_ai.usage. is a counter.", // 2 — prefix in prose
  ].join("\n");

  assert.deepEqual(
    parseAttributes(md).map((a) => [a.line, a.name]),
    [
      [1, "gen_ai.usage.input_tokens"],
      [2, "gen_ai.usage"],
    ],
  );
});

test("parseAttributes honours the marker on the line, the line above, and a fence", () => {
  const onLine = parseAttributes('set("gen_ai.system", x) // semconv-allow');
  assert.equal(onLine.length, 1);
  assert.equal(onLine[0].allowed, true);

  const above = parseAttributes('// semconv-allow\nset("gen_ai.system", x)');
  assert.equal(above.at(-1).allowed, true);

  const fenced = parseAttributes(["```js semconv-allow", '"gen_ai.system"', "```"].join("\n"));
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0].allowed, true);
});

test("a fence exemption stops at the closing fence", () => {
  const body = [
    "```js semconv-allow",
    '"gen_ai.system"', // 2 — exempt
    "```",
    '"gen_ai.system"', // 4 — not exempt
  ].join("\n");

  assert.deepEqual(
    parseAttributes(body).map((a) => [a.line, a.allowed]),
    [
      [2, true],
      [4, false],
    ],
  );
});

test("parseOperationValues reads the value, not the attribute key", () => {
  // On `set("gen_ai.operation.name", "chat")` the first quoted run is the key.
  assert.deepEqual(
    parseOperationValues('span.setAttribute("gen_ai.operation.name", "chat");').map((o) => o.value),
    ["chat"],
  );
});

test("parseOperationValues ignores a line with no literal value", () => {
  // A value computed elsewhere must not be guessed at — a false positive on
  // correct code is how a check gets switched off.
  assert.deepEqual(parseOperationValues('attrs["gen_ai.operation.name"] = opName;'), []);
});

test("editDistance and suggest behave like a did-you-mean, not a wildcard", () => {
  assert.equal(editDistance("chat", "chat"), 0);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(suggest("gen_ai.usage.inpt_tokens"), "gen_ai.usage.input_tokens");
  // Nothing remotely close should produce a confident suggestion.
  assert.equal(suggest("gen_ai.completely.unrelated.nonsense.attribute"), null);
});

// --- the checks ---------------------------------------------------------

test("a renamed attribute is an error that names the replacement", () => {
  const result = scanSource('span.setAttribute("gen_ai.system", "openai");\n');

  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "gen_ai.system");
  assert.match(err, /renamed/);
  assert.match(err, /gen_ai\.provider\.name/); // the fix, not just the fault
  assert.equal(result.stats.deprecated, 1);
});

test("the old token-count names are caught, since 2025-era code is full of them", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.usage.prompt_tokens", 10);',
      'span.setAttribute("gen_ai.usage.completion_tokens", 20);',
    ].join("\n"),
  );

  assert.equal(result.ok, false);
  assert.match(oneErrorMatching(result, "prompt_tokens"), /gen_ai\.usage\.input_tokens/);
  assert.match(oneErrorMatching(result, "completion_tokens"), /gen_ai\.usage\.output_tokens/);
});

test("an attribute that never existed is reported as not defined, not as renamed", () => {
  // gen_ai.usage.total_tokens is emitted by several frameworks but is not in
  // the conventions, so there is no "renamed to" to offer.
  const result = scanSource('span.setAttribute("gen_ai.usage.total_tokens", 30);\n');

  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "total_tokens");
  assert.match(err, /not part of the GenAI conventions/);
  assert.match(err, /Sum gen_ai\.usage\.input_tokens/);
});

test("a misspelled attribute is an error with a did-you-mean", () => {
  const result = scanSource('span.setAttribute("gen_ai.usage.inpt_tokens", 10);\n');

  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "inpt_tokens");
  assert.match(err, /Did you mean "gen_ai\.usage\.input_tokens"\?/);
  assert.equal(result.stats.unknown, 1);
});

test("an invalid gen_ai.operation.name value is an error listing the valid ones", () => {
  const result = scanSource('span.setAttribute("gen_ai.operation.name", "invoke_agnt");\n');

  assert.equal(result.ok, false);
  const err = oneErrorMatching(result, "invoke_agnt");
  assert.match(err, /not a valid gen_ai\.operation\.name/);
  assert.match(err, /invoke_agent/);
});

test("every valid operation name passes", () => {
  for (const op of OPERATIONS) {
    const result = scanSource(
      [
        `span.setAttribute("gen_ai.operation.name", "${op}");`,
        'span.setAttribute("gen_ai.usage.input_tokens", 1);',
      ].join("\n"),
    );
    assert.equal(result.ok, true, `${op} should be valid:\n${result.errors.join("\n")}`);
  }
});

test("correct instrumentation passes clean, with no warnings either", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.operation.name", "chat");',
      'span.setAttribute("gen_ai.provider.name", "anthropic");',
      'span.setAttribute("gen_ai.request.model", "claude-sonnet-4-5");',
      'span.setAttribute("gen_ai.usage.input_tokens", 412);',
      'span.setAttribute("gen_ai.usage.output_tokens", 118);',
    ].join("\n"),
  );

  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.filesWithAttributes, 1);
});

test("tracing a model call without token counts warns but does not fail", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.operation.name", "chat");',
      'span.setAttribute("gen_ai.request.model", "claude-sonnet-4-5");',
    ].join("\n"),
  );

  assert.equal(result.ok, true); // advisory, not blocking
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /no gen_ai\.usage\.\* token counts/);
});

test("recording user content warns so the retention choice is explicit", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.operation.name", "chat");',
      'span.setAttribute("gen_ai.usage.input_tokens", 1);',
      'span.setAttribute("gen_ai.input.messages", JSON.stringify(msgs));',
    ].join("\n"),
  );

  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /gen_ai\.input\.messages/);
  assert.match(result.warnings[0], /retention/);
});

test("the content warning goes away once the line is marked", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.operation.name", "chat");',
      'span.setAttribute("gen_ai.usage.input_tokens", 1);',
      "// reviewed: redacted before export. semconv-allow",
      'span.setAttribute("gen_ai.input.messages", JSON.stringify(redact(msgs)));',
    ].join("\n"),
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
});

test("a marked line silences the error too, so a doc can quote a stale name", () => {
  const result = scanSource(
    "The old name was gen_ai.system. <!-- semconv-allow -->\n",
    "docs/migrating.md",
  );
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("files with no gen_ai attributes are counted but produce nothing", () => {
  const result = scanSource("const x = 1;\n");
  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.stats.filesWithAttributes, 0);
  assert.equal(result.stats.files, 1);
});

test("reports every distinct problem in one run, not just the first", () => {
  const result = scanSource(
    [
      'span.setAttribute("gen_ai.system", "openai");',
      'span.setAttribute("gen_ai.usage.prompt_tokens", 10);',
      'span.setAttribute("gen_ai.nonsense.attribute.name.here", 1);',
    ].join("\n"),
  );

  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 3, result.errors.join("\n"));
});

// --- walking the tree ---------------------------------------------------

test("generated and vendored directories are not scanned", () => {
  const root = makeTree({
    "src/agent.js": 'span.setAttribute("gen_ai.provider.name", "anthropic");\n',
    "node_modules/pkg/index.js": 'span.setAttribute("gen_ai.system", "openai");\n',
    "dist/bundle.js": 'span.setAttribute("gen_ai.system", "openai");\n',
  });
  const result = checkSemconv({ paths: [root], root });

  // Someone else's dependency using an old name is not this repo's bug, and a
  // gate that fails on node_modules is a gate that gets deleted.
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(result.stats.files, 1);
});

test("a file with an unrecognised extension is skipped", () => {
  const root = makeTree({ "notes.txt": '"gen_ai.system"\n' });
  const result = checkSemconv({ paths: [root], root });
  assert.equal(result.stats.files, 0);
  assert.equal(result.ok, true);
});

test("an explicit file path is scanned whatever its extension", () => {
  // Passing a file by name is an instruction, not a discovery — honour it.
  const root = makeTree({ "notes.txt": '"gen_ai.system"\n' });
  const result = checkSemconv({ paths: [path.join(root, "notes.txt")], root });
  assert.equal(result.stats.files, 1);
  assert.equal(result.ok, false);
});

test("a missing path is an error rather than a silent pass", () => {
  const result = checkSemconv({ paths: ["definitely/not/here"], root: REPO_ROOT });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /path not found/);
});

// --- the example this repo ships ----------------------------------------

test("the tracing example this repo ships passes its own gate under --strict", () => {
  const result = checkSemconv({
    paths: ["templates/tracing"],
    root: REPO_ROOT,
  });

  assert.equal(result.ok, true, `errors:\n${result.errors.join("\n")}`);
  assert.deepEqual(result.warnings, [], `warnings:\n${result.warnings.join("\n")}`);
});

test("the shipped example actually demonstrates the skill attributes", () => {
  // If the example stops showing the skill spans, the reason this skill exists
  // is no longer visible in the thing people copy.
  const body = fs.readFileSync(
    path.join(REPO_ROOT, "templates/tracing/instrumentation.example.js"),
    "utf8",
  );
  for (const name of ["gen_ai.skill.name", "gen_ai.skill.source.uri", "gen_ai.usage.input_tokens"]) {
    assert.ok(body.includes(name), `example no longer records ${name}`);
  }
});

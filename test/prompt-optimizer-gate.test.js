/**
 * Unit tests for hooks/prompt-optimizer-gate.js.
 *
 * This hook runs on EVERY user prompt in a Claude Code session, so a regression
 * is felt immediately and everywhere: firing too often turns every prompt into
 * an interrogation, firing never makes the gate dead code, and crashing on a
 * payload it did not expect breaks prompt submission itself.
 *
 * The hook is a stdin/stdout CLI, so these tests are black-box: they spawn it
 * with a JSON payload and assert on exit code, stdout and the sentinel file it
 * writes. Every payload names a throwaway `cwd`, because the hook derives its
 * state directory from that field — the real .claude/state is never touched.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const HOOK = path.resolve(__dirname, "..", "hooks", "prompt-optimizer-gate.js");

/** The hook's documented minimum: prompts of this length or shorter are ignored. */
const MIN_LENGTH = 30;

const SUBSTANTIVE = "Refactor the explorer bundle so the build step is deterministic";

/** A throwaway working directory, removed when the suite finishes. */
function makeCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-gate-fixture-"));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Where the hook is expected to record that a session has already been gated. */
function sentinelPath(cwd, sessionId) {
  return path.join(cwd, ".claude", "state", "prompt-optimizer", `${sessionId}.seen`);
}

/**
 * Run the hook against `payload`. `raw` sends bytes verbatim instead, for the
 * malformed-stdin cases. The child's own cwd is pinned to the fixture too, so
 * even a payload without a `cwd` field cannot write into this repository.
 */
function runHook(payload, { raw = null, cwd = null } = {}) {
  const dir = cwd || (payload && payload.cwd) || makeCwd();
  const input = raw === null ? JSON.stringify(payload) : raw;
  const result = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", cwd: dir });
  return { ...result, cwd: dir };
}

/** Assert the hook stayed out of the way: clean exit, no injected context. */
function assertSilent(result) {
  assert.equal(result.status, 0, `expected a clean exit, stderr was:\n${result.stderr}`);
  assert.equal(result.stdout, "", "a suppressed prompt must inject no context");
}

test("injects the gate reminder for the first substantive prompt of a session", () => {
  const cwd = makeCwd();
  const { status, stdout } = runHook({ session_id: "sess-happy", prompt: SUBSTANTIVE, cwd });

  assert.equal(status, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const context = out.hookSpecificOutput.additionalContext;
  assert.match(context, /prompt-optimizer/, "the reminder must name the skill to offer");
  assert.match(context, /<prompt-optimizer-gate>[\s\S]*<\/prompt-optimizer-gate>/);
});

test("records a session sentinel under the cwd from the payload", () => {
  const cwd = makeCwd();
  runHook({ session_id: "sess-state", prompt: SUBSTANTIVE, cwd });

  const sentinel = sentinelPath(cwd, "sess-state");
  assert.ok(fs.existsSync(sentinel), "the sentinel must live under <cwd>/.claude/state");
  assert.ok(
    !Number.isNaN(Date.parse(fs.readFileSync(sentinel, "utf8"))),
    "the sentinel records when the gate fired",
  );
  assert.deepEqual(
    fs.readdirSync(cwd),
    [".claude"],
    "the hook writes nothing outside its state directory",
  );
});

test("stays silent on the second prompt of the same session", () => {
  const cwd = makeCwd();
  const first = runHook({ session_id: "sess-once", prompt: SUBSTANTIVE, cwd });
  assert.notEqual(first.stdout, "", "precondition: the first prompt fires");

  assertSilent(runHook({ session_id: "sess-once", prompt: SUBSTANTIVE, cwd }));
});

test("fires again for a different session in the same working directory", () => {
  const cwd = makeCwd();
  runHook({ session_id: "sess-a", prompt: SUBSTANTIVE, cwd });
  const { status, stdout } = runHook({ session_id: "sess-b", prompt: SUBSTANTIVE, cwd });

  assert.equal(status, 0);
  assert.match(stdout, /prompt-optimizer/, "the gate is per-session, not per-directory");
  assert.ok(fs.existsSync(sentinelPath(cwd, "sess-a")));
  assert.ok(fs.existsSync(sentinelPath(cwd, "sess-b")));
});

test("stays silent for a slash command, however long", () => {
  const cwd = makeCwd();
  const prompt = `/speckit-specify ${SUBSTANTIVE}`;
  assert.ok(prompt.length > MIN_LENGTH, "precondition: length alone would let this through");

  assertSilent(runHook({ session_id: "sess-slash", prompt, cwd }));
});

test("stays silent for a prompt exactly at the length threshold", () => {
  const cwd = makeCwd();
  const prompt = "x".repeat(MIN_LENGTH);

  assertSilent(runHook({ session_id: "sess-threshold", prompt, cwd }));
});

test("fires for a prompt one character over the length threshold", () => {
  const cwd = makeCwd();
  const { status, stdout } = runHook({
    session_id: "sess-over",
    prompt: "x".repeat(MIN_LENGTH + 1),
    cwd,
  });

  assert.equal(status, 0);
  assert.match(stdout, /prompt-optimizer/);
});

test("measures length after trimming, so padding cannot pad a prompt over the line", () => {
  const cwd = makeCwd();
  const prompt = `     ${"y".repeat(MIN_LENGTH)}     `;
  assert.ok(prompt.length > MIN_LENGTH, "precondition: only the untrimmed text is long enough");

  assertSilent(runHook({ session_id: "sess-padded", prompt, cwd }));
});

test("stays silent for a whitespace-only prompt", () => {
  const cwd = makeCwd();
  assertSilent(runHook({ session_id: "sess-blank", prompt: "   \n\t  ", cwd }));
});

test("stays silent when the payload has no session_id", () => {
  const cwd = makeCwd();
  assertSilent(runHook({ prompt: SUBSTANTIVE, cwd }));
});

test("stays silent when the payload has no prompt", () => {
  const cwd = makeCwd();
  assertSilent(runHook({ session_id: "sess-noprompt", cwd }));
});

test("writes no state for a prompt it suppresses", () => {
  const cwd = makeCwd();
  runHook({ session_id: "sess-short", prompt: "hi", cwd });

  assert.deepEqual(fs.readdirSync(cwd), [], "a skipped prompt must not create a state directory");
});

test("exits cleanly on empty stdin", () => {
  assertSilent(runHook(null, { raw: "", cwd: makeCwd() }));
});

test("exits cleanly on stdin that is not JSON", () => {
  assertSilent(runHook(null, { raw: "not json at all {{{", cwd: makeCwd() }));
});

test("exits cleanly on a truncated JSON payload", () => {
  assertSilent(runHook(null, { raw: '{"session_id":"sess-cut","prompt":"', cwd: makeCwd() }));
});

test("exits cleanly on JSON that parses to something other than an object", () => {
  // `JSON.parse` happily returns null, a number or a string for these, and
  // reading `.session_id` off them throws. A hook that crashes takes the
  // user's prompt down with it, so every one of these must pass through.
  for (const raw of ["null", "42", '"a string"', "true"]) {
    assertSilent(runHook(null, { raw, cwd: makeCwd() }));
  }
});

test("fails open when the state directory cannot be created", () => {
  const cwd = makeCwd();
  // A plain file where the hook expects a `.claude` directory makes mkdirSync
  // throw on every platform. The hook must swallow that and let the prompt
  // through rather than blocking the user on a filesystem problem.
  fs.writeFileSync(path.join(cwd, ".claude"), "not a directory");

  assertSilent(runHook({ session_id: "sess-readonly", prompt: SUBSTANTIVE, cwd }));
});

// Not covered: a permission-denied (rather than ENOTDIR) failure on the state
// directory. `chmod` is a no-op for root and has no equivalent on Windows, so
// the `.claude`-is-a-file case above is used to reach the same catch block in a
// way that behaves identically on all three platforms.

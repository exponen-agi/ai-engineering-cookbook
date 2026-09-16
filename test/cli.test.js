/**
 * Unit tests for bin/cli.js — the `npx ai-engineering-cookbook` entry point.
 *
 * This is the surface every reader touches first, and until now it had no
 * tests. Two things are pinned here:
 *
 *   1. `parseSelection`, the multi-select parser behind the interactive picker.
 *      It is pure, so it is tested directly.
 *   2. The router contract: every environment the CLI advertises must actually
 *      be accepted by both installers. These run the real binaries in
 *      `--dry-run` mode, so nothing is written to disk.
 *
 * Everything here is cross-platform. Child processes are spawned via
 * `process.execPath` (never a shell), and paths are built with `path.join`, so
 * the suite behaves the same on macOS, Windows and Linux.
 *
 * Run: npm test   (uses node:test, built into Node; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const CLI_PATH = path.join(__dirname, "..", "bin", "cli.js");
const { ENVIRONMENTS, SKILL_MENU, subcommands, parseSelection, resolveMenuChoice, exitCodeFor } =
  require(CLI_PATH);

/** Run the CLI (or any script) with Node directly — no shell, so Windows is fine. */
function run(scriptPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    // The CLI shows an interactive picker only when stdin is a TTY. Piping
    // stdin keeps every test on the non-interactive path.
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─────────────────────────────────────────────────────────────────────────
// parseSelection — the interactive multi-select parser
// ─────────────────────────────────────────────────────────────────────────

test("parseSelection defaults to the first entry when input is empty", () => {
  assert.deepEqual(parseSelection("", 7), [1]);
  assert.deepEqual(parseSelection("   ", 7), [1]);
});

test("parseSelection accepts a single number", () => {
  assert.deepEqual(parseSelection("3", 7), [3]);
});

test("parseSelection accepts comma- and space-separated numbers", () => {
  assert.deepEqual(parseSelection("1,3 5", 7), [1, 3, 5]);
  assert.deepEqual(parseSelection("2, 4,6", 7), [2, 4, 6]);
});

test("parseSelection preserves the order the user typed", () => {
  assert.deepEqual(parseSelection("5,1,3", 7), [5, 1, 3]);
});

test("parseSelection removes duplicates", () => {
  assert.deepEqual(parseSelection("2,2,2", 7), [2]);
  assert.deepEqual(parseSelection("1,2,1", 7), [1, 2]);
});

test("parseSelection rejects out-of-range numbers", () => {
  assert.equal(parseSelection("0", 7), null);
  assert.equal(parseSelection("8", 7), null);
  assert.equal(parseSelection("-1", 7), null);
});

test("parseSelection rejects non-integers and junk", () => {
  assert.equal(parseSelection("abc", 7), null);
  assert.equal(parseSelection("1.5", 7), null);
  assert.equal(parseSelection("1,abc", 7), null);
});

// ─────────────────────────────────────────────────────────────────────────
// The environment table
// ─────────────────────────────────────────────────────────────────────────

test("every advertised environment has a tool, a label and a skills folder", () => {
  assert.ok(ENVIRONMENTS.length > 0, "the picker must offer at least one environment");
  for (const env of ENVIRONMENTS) {
    assert.equal(typeof env.tool, "string", `${env.label} needs a tool id`);
    assert.ok(env.tool.length > 0);
    assert.equal(typeof env.label, "string");
    assert.ok(env.label.length > 0);
    // Always forward slashes — these strings are printed to users and passed
    // to the installers, which normalise them per platform.
    assert.match(env.dir, /^\.[\w.-]+\/skills$/, `${env.tool} has an unexpected dir: ${env.dir}`);
  }
});

test("environment tool ids are unique", () => {
  const ids = ENVIRONMENTS.map((e) => e.tool);
  assert.equal(new Set(ids).size, ids.length, "duplicate tool id in ENVIRONMENTS");
});

test("every subcommand points at an installer that exists on disk", () => {
  for (const [name, relPath] of Object.entries(subcommands)) {
    const full = path.resolve(path.dirname(CLI_PATH), relPath);
    assert.ok(fs.existsSync(full), `subcommand "${name}" points at a missing file: ${relPath}`);
  }
});

test("every skill is reachable under its short and its install- name", () => {
  for (const skill of ["doc-coherence", "prompt-optimizer", "skill-review"]) {
    assert.ok(subcommands[skill], `missing short alias for ${skill}`);
    assert.ok(subcommands[`install-${skill}`], `missing install- alias for ${skill}`);
    assert.equal(subcommands[skill], subcommands[`install-${skill}`], `aliases for ${skill} disagree`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// The interactive skill picker
//
// The menu used to live in three places — the printed list, the "[1-3]" in the
// prompt, and an if/else chain — which is three chances to disagree. It is one
// table now, and these tests hold the table and the router together.
// ─────────────────────────────────────────────────────────────────────────

test("every menu entry names a skill the router can actually run", () => {
  assert.ok(SKILL_MENU.length > 0);
  for (const entry of SKILL_MENU) {
    assert.ok(subcommands[entry.skill], `menu offers "${entry.skill}" but no subcommand exists for it`);
    assert.ok(entry.label.length > 0, `${entry.skill} needs a label`);
    assert.ok(entry.blurb.length > 0, `${entry.skill} needs a one-line blurb`);
  }
});

test("every installable skill appears in the menu", () => {
  // Otherwise a skill ships that nobody running the bare command can find.
  const offered = new Set(SKILL_MENU.map((e) => e.skill));
  for (const name of Object.keys(subcommands)) {
    if (name.startsWith("install-")) continue;
    assert.ok(offered.has(name), `"${name}" is installable but missing from the interactive menu`);
  }
});

test("resolveMenuChoice maps each number to the skill printed beside it", () => {
  SKILL_MENU.forEach((entry, i) => {
    assert.deepEqual(resolveMenuChoice(String(i + 1)), { action: "install", skill: entry.skill });
  });
});

test("resolveMenuChoice treats the entry after the last skill as Exit", () => {
  assert.deepEqual(resolveMenuChoice(String(SKILL_MENU.length + 1)), { action: "exit" });
  assert.deepEqual(resolveMenuChoice("exit"), { action: "exit" });
  assert.deepEqual(resolveMenuChoice("EXIT"), { action: "exit" });
});

test("resolveMenuChoice accepts a skill typed by name", () => {
  assert.deepEqual(resolveMenuChoice("skill-review"), { action: "install", skill: "skill-review" });
  assert.deepEqual(resolveMenuChoice("  Doc-Coherence  "), { action: "install", skill: "doc-coherence" });
});

test("resolveMenuChoice rejects anything else rather than guessing", () => {
  for (const bad of ["", "   ", "0", "99", "abc", "1.5", "-1", "install"]) {
    assert.deepEqual(resolveMenuChoice(bad), { action: "invalid" }, `"${bad}" should not resolve`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Router behaviour
// ─────────────────────────────────────────────────────────────────────────

test("--help exits 0 and lists every skill", () => {
  const res = run(CLI_PATH, ["--help"]);
  assert.equal(res.status, 0);
  for (const entry of SKILL_MENU) {
    assert.match(res.stdout, new RegExp(entry.skill), `help text never mentions "${entry.skill}"`);
  }
});

test("help, -h and --help all behave the same", () => {
  const outputs = ["help", "-h", "--help"].map((flag) => run(CLI_PATH, [flag]));
  for (const res of outputs) {
    assert.equal(res.status, 0);
  }
  assert.equal(outputs[0].stdout, outputs[1].stdout);
  assert.equal(outputs[1].stdout, outputs[2].stdout);
});

test("no arguments and no TTY prints help and exits 0 instead of hanging", () => {
  const res = run(CLI_PATH, []);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Usage:/);
});

test("an unknown command exits 1 and names the offending command", () => {
  const res = run(CLI_PATH, ["not-a-real-skill"]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /not-a-real-skill/);
});

test("the help text mentions every environment the picker offers", () => {
  const res = run(CLI_PATH, ["--help"]);
  for (const env of ENVIRONMENTS) {
    assert.match(res.stdout, new RegExp(env.tool), `help text never mentions "${env.tool}"`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// The router / installer contract
//
// This is the test that earns its keep: if someone adds an environment to the
// CLI picker but forgets to teach an installer about it, the user gets a
// confusing failure halfway through an install. These catch it in CI instead.
// ─────────────────────────────────────────────────────────────────────────

for (const [skill, relPath] of Object.entries(subcommands)) {
  // The short and install- aliases resolve to the same script; test it once.
  if (skill.startsWith("install-")) continue;

  for (const env of ENVIRONMENTS) {
    test(`${skill} accepts --tool ${env.tool} (dry run, writes nothing)`, () => {
      const installer = path.resolve(path.dirname(CLI_PATH), relPath);
      const res = run(installer, ["--tool", env.tool, "--dry-run"]);
      assert.equal(
        res.status,
        0,
        `${skill} rejected "${env.tool}".\nstdout: ${res.stdout}\nstderr: ${res.stderr}`
      );
    });
  }

  test(`${skill} rejects an unknown --tool with a non-zero exit`, () => {
    const installer = path.resolve(path.dirname(CLI_PATH), relPath);
    const res = run(installer, ["--tool", "definitely-not-a-tool", "--dry-run"]);
    assert.notEqual(res.status, 0, `${skill} silently accepted an unknown tool`);
  });
}

test("a dry run writes nothing into the working directory", () => {
  // Guards against a future --dry-run regression that starts creating files.
  // Runs in a throwaway directory so the assertion is exact: the folder starts
  // empty, so anything left behind came from the installer.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cookbook-dryrun-"));
  test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  for (const [skill, relPath] of Object.entries(subcommands)) {
    if (skill.startsWith("install-")) continue;
    const installer = path.resolve(path.dirname(CLI_PATH), relPath);

    for (const env of ENVIRONMENTS) {
      const res = spawnSync(
        process.execPath,
        [installer, "--tool", env.tool, "--dry-run"],
        { encoding: "utf8", cwd: scratch, stdio: ["pipe", "pipe", "pipe"] }
      );
      assert.equal(res.status, 0, `${skill} --tool ${env.tool} failed: ${res.stderr}`);
      assert.deepEqual(
        fs.readdirSync(scratch),
        [],
        `${skill} --tool ${env.tool} wrote to disk during a dry run`
      );
    }
  }
});

// --- child exit codes ----------------------------------------------------

test("exitCodeFor reports failure for a child killed by a signal", () => {
  // Node reports (null, 'SIGKILL') when a child is killed. The router used to
  // pass that through as `code ?? 0`, so an installer killed by the
  // out-of-memory killer — or by the user pressing Ctrl-C — looked like a
  // clean install to any script checking `$?`.
  assert.equal(exitCodeFor(null, "SIGKILL"), 1);
  assert.equal(exitCodeFor(null, "SIGINT"), 1);
  assert.equal(exitCodeFor(null, "SIGTERM"), 1);
});

test("exitCodeFor passes a real exit code straight through", () => {
  assert.equal(exitCodeFor(0, null), 0);
  assert.equal(exitCodeFor(1, null), 1);
  assert.equal(exitCodeFor(2, null), 2);
});

test("exitCodeFor treats an unknown outcome as failure, not success", () => {
  // Neither a code nor a signal should never happen, but if it does, the safe
  // reading is "something went wrong", not "all good".
  assert.equal(exitCodeFor(null, null), 1);
});

test("the router and the multi-tool loop both use exitCodeFor", () => {
  // Guards against either call site drifting back to `code ?? 0`.
  const src = fs.readFileSync(path.resolve(__dirname, "..", "bin", "cli.js"), "utf8");
  const handlers = src.match(/\.on\('close', \(code, signal\) =>[\s\S]*?\n/g) || [];
  assert.equal(handlers.length, 2, "expected exactly two child 'close' handlers");
  const callSites = src.match(/(?<!function )exitCodeFor\(code, signal\)/g) || [];
  assert.equal(callSites.length, 2, "both 'close' handlers must resolve the code the same way");
  // `code ?? 0` appears once more in the JSDoc that explains the old bug, so
  // this looks only at the handlers themselves.
  for (const handler of handlers) {
    assert.ok(
      !/code \?\? 0/.test(handler),
      `a 'close' handler still treats a signal kill as success: ${handler.trim()}`,
    );
  }
});

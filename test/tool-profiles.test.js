/**
 * Unit tests for bin/tool-profiles.js — where each coding agent reads skills.
 *
 * A wrong path here fails in the worst possible way: the installer prints a
 * tick, the file lands on disk, and the agent never loads it. Nothing throws,
 * no exit code changes, and the user concludes the skill itself is broken.
 * So these tests pin the paths that were actually verified against vendor
 * documentation, and pin the two invariants that stop the table drifting away
 * from the CLI that renders it.
 *
 * Run: npm test   (uses node:test, built into Node; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TOOL_PROFILES,
  ENVIRONMENTS,
  MENU_ORDER,
  TOOL_KEYS,
  resolveSkillsBase,
  legacyInstallNotice,
} = require("../bin/tool-profiles.js");

const cli = require("../bin/cli.js");

// ─────────────────────────────────────────────────────────────────────────
// The table itself
// ─────────────────────────────────────────────────────────────────────────

test("every profile has a label, and every menu entry is a real profile", () => {
  for (const [tool, profile] of Object.entries(TOOL_PROFILES)) {
    assert.equal(typeof profile.label, "string", `${tool} needs a label`);
    assert.ok(profile.label.length > 0, `${tool} needs a non-empty label`);
  }
  for (const tool of MENU_ORDER) {
    assert.ok(TOOL_PROFILES[tool], `the menu lists "${tool}", which is not in the table`);
  }
});

test("every profile except custom declares a project directory", () => {
  for (const [tool, profile] of Object.entries(TOOL_PROFILES)) {
    if (tool === "custom") continue;
    assert.equal(typeof profile.skillsDirProject, "string", `${tool} needs skillsDirProject`);
    assert.ok(
      !path.isAbsolute(profile.skillsDirProject),
      `${tool}'s project directory must be relative to the repo, not absolute`,
    );
    assert.ok(
      !profile.skillsDirProject.includes("\\"),
      `${tool}'s project directory must use forward slashes so it reads the same on every platform`,
    );
  }
});

test("a profile never claims user scope without a directory to put it in", () => {
  // Otherwise `--user` resolves to undefined and the skill is written to a
  // path built from the string "undefined".
  for (const [tool, profile] of Object.entries(TOOL_PROFILES)) {
    if (!profile.supportsUser) continue;
    if (tool === "custom") continue;
    assert.equal(typeof profile.skillsDirUser, "string", `${tool} claims --user support with no path`);
    assert.ok(path.isAbsolute(profile.skillsDirUser), `${tool}'s user directory must be absolute`);
  }
});

test("Codex is installed to .agents/skills, the only place Codex reads", () => {
  // OpenAI documents .agents/skills at the working directory, at a parent
  // inside the repo, and at the repo root — and $HOME/.agents/skills for
  // personal skills. A .codex/skills folder in a project is never read, so
  // writing there produced a silent no-op for every Codex user.
  assert.equal(TOOL_PROFILES.codex.skillsDirProject, ".agents/skills");
  assert.equal(TOOL_PROFILES.codex.skillsDirUser, path.join(os.homedir(), ".agents", "skills"));
  assert.equal(TOOL_PROFILES.codex.legacyDirProject, ".codex/skills");
});

test("the portable target writes to the shared cross-agent folder", () => {
  assert.equal(TOOL_PROFILES.agents.skillsDirProject, ".agents/skills");
  assert.equal(TOOL_PROFILES.agents.skillsDirUser, path.join(os.homedir(), ".agents", "skills"));
  assert.equal(MENU_ORDER[0], "agents", "the portable choice should be offered first");
});

test("Copilot's personal directory is ~/.copilot/skills on every platform", () => {
  // GitHub documents ~/.copilot/skills (or ~/.agents/skills). An earlier
  // version guessed a Windows-only %APPDATA% path that GitHub does not
  // document, so Windows users installed into a folder nothing reads.
  assert.equal(TOOL_PROFILES.vscode.skillsDirUser, path.join(os.homedir(), ".copilot", "skills"));
});

test("Claude Code keeps its own folder, because it reads only that one", () => {
  assert.equal(TOOL_PROFILES.claude.skillsDirProject, ".claude/skills");
  assert.equal(TOOL_PROFILES.claude.skillsDirUser, path.join(os.homedir(), ".claude", "skills"));
});

test("every vendor-specific path carries the source it was verified against", () => {
  // A path with no source is a path nobody can re-check when the vendor
  // moves it.
  for (const [tool, profile] of Object.entries(TOOL_PROFILES)) {
    if (tool === "custom" || tool === "others") continue;
    assert.equal(typeof profile.source, "string", `${tool} needs a source comment`);
    assert.ok(profile.source.length > 0, `${tool}'s source must not be empty`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// No drift between the table and the CLI that renders it
// ─────────────────────────────────────────────────────────────────────────

test("the CLI picker is the shared table, not a second copy of it", () => {
  // This table used to exist in four files and had already disagreed with
  // itself. Deriving the picker from the table is what stops that returning.
  assert.deepEqual(cli.ENVIRONMENTS, ENVIRONMENTS);
  for (const env of cli.ENVIRONMENTS) {
    assert.equal(env.dir, TOOL_PROFILES[env.tool].skillsDirProject);
    assert.equal(env.label, TOOL_PROFILES[env.tool].label);
  }
});

test("every installer accepts every tool the picker can offer", () => {
  const installers = ["install-doc-coherence.js", "install-prompt-optimizer.js", "install-skill-review.js"];
  for (const installer of installers) {
    const source = fs.readFileSync(path.join(__dirname, "..", "bin", installer), "utf8");
    assert.match(
      source,
      /require\("\.\/tool-profiles\.js"\)/,
      `${installer} must read the shared table rather than declaring its own`,
    );
  }
  // And the picker only ever offers keys the shared resolver knows.
  for (const env of ENVIRONMENTS) {
    assert.ok(TOOL_KEYS.includes(env.tool), `${env.tool} is offered but unknown to the resolver`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// resolveSkillsBase
// ─────────────────────────────────────────────────────────────────────────

test("project scope resolves against the given working directory", () => {
  const cwd = path.join(path.sep, "tmp", "some-project");
  const result = resolveSkillsBase({ tool: "claude", cwd });
  assert.equal(result.ok, true);
  assert.equal(result.base, path.resolve(cwd, ".claude/skills"));
});

test("user scope resolves to the home directory, ignoring the project", () => {
  const result = resolveSkillsBase({ tool: "claude", user: true, cwd: path.sep });
  assert.equal(result.ok, true);
  assert.equal(result.base, path.join(os.homedir(), ".claude", "skills"));
});

test("an unknown tool is rejected and lists the tools that exist", () => {
  const result = resolveSkillsBase({ tool: "nope" });
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown --tool "nope"/);
  assert.match(result.error, /claude/);
});

test("user scope is refused for a project-only tool rather than guessing a path", () => {
  const result = resolveSkillsBase({ tool: "others", user: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /not supported/);
});

test("custom requires a target, and then uses it verbatim", () => {
  assert.equal(resolveSkillsBase({ tool: "custom" }).ok, false);
  const target = path.join(os.tmpdir(), "my-skills");
  const result = resolveSkillsBase({ tool: "custom", target });
  assert.equal(result.ok, true);
  assert.equal(result.base, path.resolve(target));
});

// ─────────────────────────────────────────────────────────────────────────
// The legacy-directory notice
// ─────────────────────────────────────────────────────────────────────────

test("no notice when the tool never had a legacy directory", () => {
  assert.equal(legacyInstallNotice(TOOL_PROFILES.claude, os.tmpdir()), null);
});

test("no notice when the legacy directory is not actually there", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cookbook-legacy-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.equal(legacyInstallNotice(TOOL_PROFILES.codex, cwd), null);
});

test("a stale legacy directory is named, with the reason it matters", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cookbook-legacy-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, ".codex", "skills"), { recursive: true });

  const notice = legacyInstallNotice(TOOL_PROFILES.codex, cwd);
  assert.ok(notice, "a leftover .codex/skills must be reported");
  assert.match(notice, /\.codex\/skills/);
  assert.match(notice, /does not read it/);
});

test("legacyInstallNotice tolerates being handed nothing", () => {
  assert.equal(legacyInstallNotice(undefined, os.tmpdir()), null);
  assert.equal(legacyInstallNotice({}, os.tmpdir()), null);
});

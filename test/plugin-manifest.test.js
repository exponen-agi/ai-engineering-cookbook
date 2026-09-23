/**
 * Unit tests for .claude-plugin/ — the plugin marketplace manifests.
 *
 * These two small JSON files are the repo's one-command install path: a reader
 * runs `/plugin marketplace add exponen-agi/ai-engineering-cookbook` and gets
 * every skill at once. Nothing else in the repo validates them — they are not
 * Markdown, so the link checker and markdownlint never look, and no code
 * imports them, so a typo ships silently and the install simply fails for
 * everyone.
 *
 * The drift that actually happens is a new skill being added under skills/
 * while the manifests keep describing the old set, or the plugin version
 * falling behind package.json. Both are checked here by deriving the expected
 * state from the repo rather than restating it.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const PLUGIN_DIR = path.join(REPO_ROOT, ".claude-plugin");
const MARKETPLACE_PATH = path.join(PLUGIN_DIR, "marketplace.json");
const PLUGIN_PATH = path.join(PLUGIN_DIR, "plugin.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const marketplace = readJson(MARKETPLACE_PATH);
const plugin = readJson(PLUGIN_PATH);
const pkg = readJson(path.join(REPO_ROOT, "package.json"));

/** Plugin and marketplace names are kebab-case: lowercase, digits, hyphens. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every skill folder this repo actually ships. */
function shippedSkills() {
  return fs
    .readdirSync(path.join(REPO_ROOT, "skills"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO_ROOT, "skills", e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────
// Shape — the keys the marketplace format requires
// ─────────────────────────────────────────────────────────────────────────

test("both manifests are valid JSON objects", () => {
  for (const [label, value] of [["marketplace", marketplace], ["plugin", plugin]]) {
    assert.equal(typeof value, "object", `${label}.json is not an object`);
    assert.notEqual(value, null);
    assert.ok(!Array.isArray(value), `${label}.json is an array`);
  }
});

test("the marketplace declares a name, an owner with a name, and a plugins array", () => {
  assert.equal(typeof marketplace.name, "string");
  assert.ok(marketplace.name.length > 0);
  assert.equal(typeof marketplace.owner, "object");
  assert.equal(typeof marketplace.owner.name, "string");
  assert.ok(marketplace.owner.name.length > 0);
  assert.ok(Array.isArray(marketplace.plugins));
  assert.ok(marketplace.plugins.length > 0, "the marketplace lists no plugins");
});

test("the marketplace name is kebab-case", () => {
  assert.match(marketplace.name, KEBAB);
});

test("the marketplace name is not one of the reserved names", () => {
  // Reserved by Claude Code; a marketplace using one of these cannot be added.
  const reserved = new Set([
    "claude-code-marketplace",
    "claude-plugins-official",
    "anthropic-marketplace",
    "healthcare",
    "first-party-plugins",
    "claude-tag-plugins",
  ]);
  assert.ok(!reserved.has(marketplace.name), `"${marketplace.name}" is a reserved marketplace name`);
});

test("every plugin entry has a kebab-case name and a source", () => {
  for (const entry of marketplace.plugins) {
    assert.equal(typeof entry.name, "string", "a plugin entry has no name");
    assert.match(entry.name, KEBAB, `plugin name "${entry.name}" is not kebab-case`);
    assert.ok(entry.source !== undefined, `plugin "${entry.name}" has no source`);
  }
});

test("plugin names are unique", () => {
  const names = marketplace.plugins.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, "two plugin entries share a name");
});

// ─────────────────────────────────────────────────────────────────────────
// The source has to point at something that exists
// ─────────────────────────────────────────────────────────────────────────

test("every relative plugin source resolves to a directory in this repo", () => {
  for (const entry of marketplace.plugins) {
    if (typeof entry.source !== "string") continue; // remote sources are not ours to check
    const resolved = path.resolve(REPO_ROOT, entry.source);
    assert.ok(fs.existsSync(resolved), `plugin "${entry.name}" source does not exist: ${entry.source}`);
    assert.ok(
      fs.statSync(resolved).isDirectory(),
      `plugin "${entry.name}" source is not a directory: ${entry.source}`,
    );
  }
});

test("every local plugin source has a skills directory holding at least one SKILL.md", () => {
  // Skills are auto-discovered from <plugin root>/skills/. If that folder is
  // missing or empty, the plugin installs and does nothing at all.
  for (const entry of marketplace.plugins) {
    if (typeof entry.source !== "string") continue;
    const skillsDir = path.resolve(REPO_ROOT, entry.source, "skills");
    assert.ok(fs.existsSync(skillsDir), `plugin "${entry.name}" has no skills/ directory`);
    const found = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")));
    assert.ok(found.length > 0, `plugin "${entry.name}" ships no SKILL.md files`);
  }
});

test("skills live at the plugin root, never inside .claude-plugin/", () => {
  // Claude Code does not look inside .claude-plugin/ for components. A skills
  // folder placed there loads nothing, and the mistake is invisible until a
  // user reports that the plugin is empty.
  assert.ok(
    !fs.existsSync(path.join(PLUGIN_DIR, "skills")),
    ".claude-plugin/skills exists — move it to the plugin root",
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Agreement between the manifests and the rest of the repo
// ─────────────────────────────────────────────────────────────────────────

test("plugin.json names the same plugin the marketplace lists", () => {
  assert.equal(typeof plugin.name, "string");
  const listed = marketplace.plugins.map((p) => p.name);
  assert.ok(
    listed.includes(plugin.name),
    `plugin.json is "${plugin.name}" but the marketplace lists ${listed.join(", ")}`,
  );
});

test("the plugin version matches package.json, so the two cannot drift apart", () => {
  assert.equal(
    plugin.version,
    pkg.version,
    `plugin.json version ${plugin.version} does not match package.json ${pkg.version}`,
  );
});

test("the plugin and the package agree on the licence", () => {
  assert.equal(plugin.license, pkg.license);
});

test("the marketplace description mentions every skill this repo ships", () => {
  // The description is what a reader sees before installing. A skill missing
  // from it is a skill nobody knows they are getting — and in practice this is
  // the line that gets forgotten when a skill is added.
  const entry = marketplace.plugins.find((p) => p.name === plugin.name);
  const description = String(entry.description || "");
  for (const skill of shippedSkills()) {
    assert.ok(
      description.includes(skill),
      `the marketplace description never mentions the "${skill}" skill`,
    );
  }
});

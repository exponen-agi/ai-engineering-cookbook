/**
 * Repo-level invariants about the skills this repository *publishes*.
 *
 * `scripts/check-skills.js` answers "is this a valid skill?" for any skill
 * anywhere. These tests answer a narrower question that only applies here:
 * "is every skill we ship wired up and attributable?"
 *
 * The drift they prevent is the quiet kind. A skill folder can be added
 * without an installer, and nothing on this repo's main line notices: the CLI
 * tests walk from the installer list *outwards*, so a skill with no installer
 * is simply never visited. The result is a skill that exists in the repository,
 * is listed in the README, and cannot be installed by anybody.
 *
 * Run: npm test   (uses node:test, built into Node 22+; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const REPO_URL = "https://github.com/exponen-agi/ai-engineering-cookbook";

/** Every skill directory this repo publishes. */
function publishedSkills() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The raw frontmatter block of a skill, as text. */
function frontmatter(skill) {
  const body = fs.readFileSync(path.join(SKILLS_DIR, skill, "SKILL.md"), "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
  assert.ok(m, `${skill}: SKILL.md has no frontmatter block`);
  return m[1];
}

/** Read a scalar frontmatter field. */
function field(fm, name) {
  const m = new RegExp(`^${name}:[ \\t]*(.*)$`, "m").exec(fm);
  return m ? m[1].trim() : null;
}

test("this repo actually publishes skills", () => {
  // Guards against a glob or a rename silently emptying the set, which would
  // make every test below vacuously pass.
  assert.ok(publishedSkills().length >= 4, `only found: ${publishedSkills().join(", ")}`);
});

test("every published skill declares its provenance in metadata", () => {
  // skills/skill-review/SKILL.md teaches the reader to ask "who published this,
  // and can you reach a real repository for it?". A skill we publish that
  // cannot answer that question fails our own review step.
  for (const skill of publishedSkills()) {
    const fm = frontmatter(skill);
    assert.match(
      fm,
      /^metadata:/m,
      `${skill}: no metadata block, so its provenance cannot be checked`,
    );
    assert.ok(
      fm.includes(REPO_URL),
      `${skill}: metadata does not name ${REPO_URL} as its source`,
    );
  }
});

test("every published skill's name matches its directory", () => {
  // The Agent Skills spec requires it, and a mismatch makes a skill
  // un-invokable in some clients rather than merely untidy.
  for (const skill of publishedSkills()) {
    assert.equal(field(frontmatter(skill), "name"), skill, `${skill}: name/folder mismatch`);
  }
});

test("every published skill says WHEN to use it, not just what it does", () => {
  // A description with no trigger is the single most common reason a skill is
  // installed and then silently never fires.
  for (const skill of publishedSkills()) {
    const description = field(frontmatter(skill), "description");
    assert.ok(description, `${skill}: no description`);
    assert.match(description, /\bwhen\b/i, `${skill}: description never says when to use it`);
  }
});

test("every published skill is installable through the CLI", () => {
  // The gap this closes: the CLI tests enumerate installers and check each one
  // behaves. Nothing walked the other way, from skills/ to the installer, so a
  // skill could ship with no way to install it.
  const cli = fs.readFileSync(path.join(REPO_ROOT, "bin", "cli.js"), "utf8");

  for (const skill of publishedSkills()) {
    assert.ok(
      cli.includes(`'${skill}':`),
      `${skill}: not registered in bin/cli.js subcommands — it cannot be installed`,
    );
    assert.ok(
      cli.includes(`skill: '${skill}'`),
      `${skill}: missing from the interactive picker, so it is invisible to anyone running the bare command`,
    );
    const installer = path.join(REPO_ROOT, "bin", `install-${skill}.js`);
    assert.ok(fs.existsSync(installer), `${skill}: no installer at bin/install-${skill}.js`);
  }
});

test("every published skill's installer is exposed as a package bin", () => {
  // Without this, `npx install-<skill>` works from a git clone and not from an
  // npm install — the shape of bug that only consumers ever see.
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const skill of publishedSkills()) {
    assert.equal(
      pkg.bin[`install-${skill}`],
      `./bin/install-${skill}.js`,
      `${skill}: missing or wrong package.json bin entry`,
    );
  }
});

test("every published skill has a guide, linked from the README", () => {
  const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  for (const skill of publishedSkills()) {
    const doc = path.join(REPO_ROOT, "docs", `${skill}.md`);
    assert.ok(fs.existsSync(doc), `${skill}: no docs/${skill}.md`);
    assert.ok(
      readme.includes(`./docs/${skill}.md`),
      `${skill}: docs/${skill}.md is not linked from the README`,
    );
  }
});

test("no published skill uses a vendor-specific frontmatter field", () => {
  // --strict in CI already blocks this. Asserting it here too means the rule
  // survives someone relaxing the lint script's flags.
  const VENDOR = ["when_to_use", "context", "model", "effort", "hooks", "globs", "alwaysApply"];
  for (const skill of publishedSkills()) {
    const fm = frontmatter(skill);
    for (const key of VENDOR) {
      assert.ok(
        !new RegExp(`^${key}:`, "m").test(fm),
        `${skill}: uses the vendor-only field "${key}" — it would not be portable`,
      );
    }
  }
});

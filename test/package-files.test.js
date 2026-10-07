/**
 * Unit tests for the published package contents.
 *
 * The installers copy files out of the package root. `package.json` `files[]`
 * decides what npm actually publishes. When those two disagree, the failure
 * only appears for people who installed from npm — never for anyone running
 * from a git clone, which is everyone who develops this repo. That is the
 * worst shape a bug can have: invisible to its authors, reproducible for
 * every user.
 *
 * It had already happened once. `install-doc-coherence --with-ci` copied
 * `.github/workflows/doc-coherence.yml`, which `files[]` did not publish, so
 * the command exited 1 on an npm install after having already written three
 * other files.
 *
 * These tests read the installers rather than trusting a list, so a source
 * added tomorrow is checked tomorrow.
 *
 * Run: npm test   (uses node:test, built into Node; no dependencies)
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

const installerNames = fs
  .readdirSync(path.join(REPO_ROOT, "bin"))
  .filter((f) => f.startsWith("install-") && f.endsWith(".js"))
  .sort();

/**
 * Every `path.join(PKG_ROOT, "a", "b")` in a file, as a repo-relative path.
 *
 * @param {string} source
 * @returns {string[]}
 */
function packageRootSources(source) {
  const found = [];
  const call = /path\.join\(\s*PKG_ROOT\s*,\s*([^)]*)\)/g;
  let match;
  while ((match = call.exec(source)) !== null) {
    // Keep the leading run of string literals and stop at the first segment
    // built from a variable (`SKILL_NAME`), because its value is not known
    // here. The directory above it still gets checked, and a `files[]` entry
    // covers a directory, so that is the level the check needs anyway.
    const parts = [];
    for (const raw of match[1].split(",")) {
      const literal = /^\s*"([^"]+)"\s*$/.exec(raw);
      if (!literal) break;
      parts.push(literal[1]);
    }
    if (parts.length === 0) continue;
    found.push(parts.join("/"));
  }
  return found;
}

/**
 * Does `files[]` publish this path? A trailing slash publishes a whole tree.
 *
 * @param {string} relPath
 * @returns {boolean}
 */
function isPublished(relPath) {
  return pkg.files.some((entry) => {
    if (!entry.endsWith("/")) return entry === relPath;
    // A `files[]` entry of "skills/" publishes both the directory itself and
    // everything under it.
    return relPath === entry.slice(0, -1) || relPath.startsWith(entry);
  });
}

test("there is at least one installer to check", () => {
  assert.ok(installerNames.length > 0, "expected bin/install-*.js to exist");
});

test("every file an installer copies is actually published to npm", () => {
  const unpublished = [];

  for (const name of installerNames) {
    const source = fs.readFileSync(path.join(REPO_ROOT, "bin", name), "utf8");
    for (const rel of packageRootSources(source)) {
      if (!isPublished(rel)) unpublished.push(`${name} reads ${rel}`);
    }
  }

  assert.deepEqual(
    unpublished,
    [],
    "these files are copied by an installer but are missing from package.json files[],\n" +
      "so the command fails for anyone who installed from npm:\n" +
      unpublished.join("\n"),
  );
});

test("every file an installer copies exists in this repository", () => {
  // The other half of the same failure: a published path that is not there.
  const missing = [];

  for (const name of installerNames) {
    const source = fs.readFileSync(path.join(REPO_ROOT, "bin", name), "utf8");
    for (const rel of packageRootSources(source)) {
      const abs = path.join(REPO_ROOT, ...rel.split("/"));
      // Directories are fine — a variable segment was skipped above.
      if (!fs.existsSync(abs)) missing.push(`${name} reads ${rel}`);
    }
  }

  assert.deepEqual(missing, [], `installer sources that do not exist:\n${missing.join("\n")}`);
});

test("the workflow the doc-coherence installer ships is published", () => {
  // Pinned by name, because this is the one that actually broke.
  const rel = ".github/workflows/doc-coherence.yml";
  assert.ok(fs.existsSync(path.join(REPO_ROOT, ...rel.split("/"))), `${rel} must exist`);
  assert.ok(isPublished(rel), `${rel} must be listed in package.json files[]`);
});

test("every bin entry point exists and is published", () => {
  for (const [command, target] of Object.entries(pkg.bin)) {
    const rel = target.replace(/^\.\//, "");
    assert.ok(fs.existsSync(path.join(REPO_ROOT, ...rel.split("/"))), `${command} → ${rel} is missing`);
    assert.ok(isPublished(rel), `${command} → ${rel} is not published`);
  }
});

test("the shared tool table is published, since every installer requires it", () => {
  // It is required at run time by all three installers and by the CLI. If it
  // is ever moved outside a published directory, every install breaks at once.
  assert.ok(isPublished("bin/tool-profiles.js"));
});

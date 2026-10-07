#!/usr/bin/env node
/**
 * check-hidden-chars
 *
 * The invisible-character scan from `check-skills.js`, run across the whole
 * repository instead of only `skills/`.
 *
 * Why a second entry point: `check-skills` treats a folder as a skill and
 * checks its frontmatter, so it cannot be pointed at `docs/`. But a doc is
 * read by agents too — CLAUDE.md and AGENTS.md tell them to load these files —
 * and a character a reviewer cannot see is just as invisible in a guide as in
 * a SKILL.md. This gate reuses the exact same character rules, so the two can
 * never disagree about what counts as hidden.
 *
 * It adds one rule of its own. U+FE0F (variation selector) and U+200D
 * (zero-width joiner) are allowed in prose because emoji are built from them.
 * Inside a Markdown link target they are never legitimate: `[x](#-heading)`
 * with a U+FE0F after the `#` looks identical to the one without, and
 * silently points nowhere. That exact bug shipped in this repo once, in three
 * anchors, and nothing caught it.
 *
 * No dependencies, no network — identical on macOS, Windows and Linux.
 *
 * Usage:
 *   node scripts/check-hidden-chars.js [path ...] [--ignore <path>] [--strict] [--json] [--quiet]
 *
 * Exit codes: 0 clean | 1 problems found | 2 usage error
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findHiddenCharacters, looksLikeText } = require("./check-skills.js");

/** Directories never worth scanning: dependencies, VCS data, generated installs. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".specify",
  ".claude",
  ".cursor",
  "dist",
  "build",
  ".next",
]);

/** File types that hold text a person or an agent reads. */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".js",
  ".cjs",
  ".mjs",
  ".jsx",
  ".ts",
  ".json",
  ".yml",
  ".yaml",
  ".html",
  ".txt",
  ".sh",
  ".ps1",
  ".toml",
]);

/**
 * Files that contain hidden characters on purpose. The check-skills test suite
 * is a set of fixtures for exactly these characters; scanning it would only
 * prove the fixtures exist.
 */
const DEFAULT_IGNORES = ["test/check-skills.test.js"];

/** Code points that are fine in emoji but never belong in a link target. */
const EMOJI_JOINERS = new Set([0xfe0f, 0x200d]);

/**
 * Find U+FE0F / U+200D inside Markdown link targets — both inline
 * `[text](target)` and reference definitions `[label]: target`.
 *
 * @param {string} text
 * @returns {Array<{id: string, level: string, codePoint: string, line: number, column: number, why: string}>}
 */
function findEmojiInLinkTargets(text) {
  const found = [];
  const lines = text.split("\n");
  const patterns = [/\]\(([^)\s]*)/g, /^\s*\[[^\]]+\]:\s*(\S+)/g];

  lines.forEach((lineText, i) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(lineText)) !== null) {
        const target = match[1];
        const targetStart = match.index + match[0].length - target.length;
        let offset = 0;
        for (const char of target) {
          const cp = char.codePointAt(0);
          if (EMOJI_JOINERS.has(cp)) {
            found.push({
              id: "emoji-joiner-in-link",
              level: "error",
              codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
              line: i + 1,
              column: [...lineText.slice(0, targetStart + offset)].length + 1,
              why: "Emoji joiner inside a link target — invisible, and the link no longer matches the anchor it looks like.",
            });
          }
          offset += char.length;
        }
      }
    }
  });
  return found;
}

/**
 * Scan one file's contents. Markdown also gets the link-target rule.
 *
 * @param {string} relPath POSIX-style path, used for messages and the .md test.
 * @param {string} text
 */
function scanText(relPath, text) {
  const hits = findHiddenCharacters(text);
  if (relPath.endsWith(".md")) hits.push(...findEmojiInLinkTargets(text));
  return hits.map((hit) => ({ file: relPath, ...hit }));
}

/**
 * Every text file under `start`, skipping the directories above.
 *
 * @param {string} start Absolute path to a file or directory.
 * @param {string} root Absolute repository root, for relative paths.
 * @returns {Array<{absPath: string, relPath: string}>}
 */
function collectFiles(start, root) {
  const out = [];
  const toRel = (abs) => path.relative(root, abs).split(path.sep).join("/");

  const visit = (abs) => {
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(abs)) && abs !== start) return;
      for (const name of fs.readdirSync(abs).sort()) visit(path.join(abs, name));
    } else if (stat.isFile() && (abs === start || TEXT_EXTENSIONS.has(path.extname(abs).toLowerCase()))) {
      out.push({ absPath: abs, relPath: toRel(abs) });
    }
  };

  visit(start);
  return out;
}

const HELP = [
  "Usage: node scripts/check-hidden-chars.js [path ...] [--ignore <path>] [--strict] [--json] [--quiet]",
  "",
  "Scans text files for characters a reviewer cannot see (the same rules as",
  "check-skills), plus emoji joiners inside Markdown link targets.",
  "",
  "  path       File or directory to scan (default: the current directory)",
  "  --ignore   Repo-relative path to skip; repeatable. Defaults always apply:",
  `             ${DEFAULT_IGNORES.join(", ")}`,
  "  --strict   Warnings fail the run too",
  "  --json     Machine-readable output",
  "  --quiet    Print nothing on success",
  "",
  "Exit codes: 0 clean | 1 problems found | 2 usage error",
].join("\n");

function parseArgs(argv) {
  const opts = { paths: [], ignores: [...DEFAULT_IGNORES], strict: false, json: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") opts.strict = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--ignore") {
      if (i + 1 >= argv.length) return { ...opts, error: "--ignore needs a path" };
      opts.ignores.push(argv[++i].split(path.sep).join("/").replace(/\/$/, ""));
    } else if (arg.startsWith("-")) {
      return { ...opts, error: `unknown option "${arg}"` };
    } else {
      opts.paths.push(arg);
    }
  }
  if (opts.paths.length === 0) opts.paths.push(".");
  return opts;
}

function main(argv = process.argv.slice(2), root = process.cwd()) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP + "\n");
    return 0;
  }
  if (opts.error) {
    process.stderr.write(`! ${opts.error}\n\n${HELP}\n`);
    return 2;
  }

  const isIgnored = (rel) => opts.ignores.some((ig) => rel === ig || rel.startsWith(ig + "/"));
  const files = [];
  for (const p of opts.paths) {
    const abs = path.resolve(root, p);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`! no such path: ${p}\n`);
      return 2;
    }
    files.push(...collectFiles(abs, root).filter((f) => !isIgnored(f.relPath)));
  }

  const findings = [];
  for (const file of files) {
    const buf = fs.readFileSync(file.absPath);
    if (!looksLikeText(buf)) continue;
    findings.push(...scanText(file.relPath, buf.toString("utf8")));
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");
  const failed = errors.length > 0 || (opts.strict && warnings.length > 0);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ ok: !failed, scanned: files.length, errors, warnings }, null, 2) + "\n");
    return failed ? 1 : 0;
  }

  for (const f of [...errors, ...warnings]) {
    const tag = f.level === "error" ? "✗ error" : "! warning";
    process.stdout.write(`${tag}  ${f.file}:${f.line}:${f.column}  [${f.id}] ${f.codePoint}\n`);
    process.stdout.write(`         ${f.why}\n`);
  }

  if (failed) {
    process.stdout.write(
      `✗ check-hidden-chars: ${files.length} file(s) scanned, ${errors.length} error(s), ${warnings.length} warning(s).\n`,
    );
  } else if (!opts.quiet) {
    process.stdout.write(
      `✓ check-hidden-chars: ${files.length} file(s) scanned, no errors` +
        (warnings.length ? `, ${warnings.length} warning(s).\n` : ".\n"),
    );
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  DEFAULT_IGNORES,
  SKIP_DIRS,
  TEXT_EXTENSIONS,
  findEmojiInLinkTargets,
  scanText,
  collectFiles,
  parseArgs,
  main,
};

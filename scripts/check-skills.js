#!/usr/bin/env node
/**
 * check-skills
 *
 * Deterministic gate for Agent Skills (`SKILL.md`). It answers two questions
 * about a skill folder without asking a model anything:
 *
 *   1. Does it conform to the Agent Skills specification?
 *      (https://agentskills.io/specification — frontmatter fields and limits)
 *   2. Does it contain characters a human reviewer cannot see?
 *
 * Question 2 is the one that matters most for a skill you did not write. A
 * reviewer reads shapes on a screen; the model reads code points. When those
 * two differ, the review you did was of a different document than the one the
 * agent will follow. `docs/agent-security.md` explains that attack; this script
 * is the executable form of the check it describes.
 *
 * No dependencies, no network, no LLM — plain substring and code-point
 * matching — so it is safe to run in CI and identical on macOS, Windows and
 * Linux.
 *
 * Usage:
 *   node scripts/check-skills.js [dir ...] [options]
 *
 * Options:
 *   --dir <path>   Directory to scan (repeatable). Default: ./skills
 *                  Accepts either a folder of skills (<dir>/<name>/SKILL.md)
 *                  or a single skill folder (<dir>/SKILL.md).
 *   --strict       Treat warnings as failures too.
 *   --json         Emit machine-readable JSON instead of text.
 *   --quiet        Print only on failure.
 *   -h, --help     Show help.
 *
 * Exit codes: 0 = clean, 1 = problems found, 2 = bad usage / nothing to scan.
 */

const fs = require("fs");
const path = require("path");

// --- the specification, encoded ------------------------------------------
// Limits come from the Agent Skills specification. Changing one here without
// a matching spec change makes this gate lie, so they live in one place.
const SPEC = {
  nameMaxChars: 64,
  descriptionMaxChars: 1024,
  compatibilityMaxChars: 500,
  bodyMaxLines: 500,
  // Lowercase alphanumerics separated by single hyphens. No leading, trailing
  // or consecutive hyphens.
  namePattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  requiredFields: ["name", "description"],
  // The whole specification is these six fields. A skill that uses only these
  // runs everywhere; anything else is a bet on one vendor.
  specFields: ["name", "description", "license", "compatibility", "metadata", "allowed-tools"],
};

/**
 * Frontmatter fields that one specific agent understands and the others do not.
 *
 * These are not typos, so calling them "unknown" would be wrong and readers
 * would learn to ignore the message. They are a real portability decision: some
 * parsers ignore a field they do not know, and some reject the file outright.
 * The gate names the trade-off instead of guessing which parser you will meet.
 */
const VENDOR_FIELDS = {
  "when_to_use": "Claude Code",
  "context": "Claude Code",
  "model": "Claude Code",
  "effort": "Claude Code",
  "hooks": "Claude Code",
  "paths": "Claude Code",
  "agent": "Claude Code",
  "disable-model-invocation": "Claude Code",
  "disallowed-tools": "Claude Code",
  "argument-hint": "Claude Code",
  "shell": "Claude Code",
  "version": "various hosts",
};

/**
 * Characters that render as nothing (or reorder what you see) and what to do
 * about each. Severity follows the reasoning in docs/agent-security.md: a
 * character with a legitimate use in real prose is a warning; one with no
 * honest reason to be in a Markdown file is an error.
 *
 * U+200D (zero-width joiner) and U+FE0F (variation selector) are deliberately
 * absent: emoji sequences such as 👩‍💻 are built from them, and this repo's own
 * docs are full of emoji. Flagging them would train readers to ignore the gate.
 */
const HIDDEN_CHARACTERS = [
  {
    id: "unicode-tag-block",
    level: "error",
    test: (cp) => cp >= 0xe0000 && cp <= 0xe007f,
    why: "Unicode tag character — invisible, and has no legitimate use in Markdown.",
  },
  {
    id: "bidi-override",
    level: "error",
    test: (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069),
    why: "Bidirectional override — can display text in a different order than the model reads it.",
  },
  {
    id: "zero-width",
    level: "error",
    test: (cp) => cp === 0x200b || (cp >= 0x2060 && cp <= 0x2064),
    why: "Zero-width character — invisible on screen but read by the model.",
  },
  {
    id: "byte-order-mark",
    level: "byteOrderMark", // error, unless it is the very first character
    test: (cp) => cp === 0xfeff,
    why: "Byte-order mark. Harmless at the very start of the file; invisible padding anywhere else.",
  },
  {
    id: "directional-or-joining-mark",
    level: "warn",
    test: (cp) => cp === 0x00ad || cp === 0x200c || cp === 0x200e || cp === 0x200f,
    why: "Invisible, but legitimate in right-to-left and some Indic scripts. Confirm it belongs.",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers — exported so the test suite can exercise them directly.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Split a SKILL.md into its YAML frontmatter and body.
 *
 * Deliberately not a YAML parser. The specification's frontmatter is a flat
 * map of short scalars, so a line reader covers it with no dependency. Nested
 * blocks (`metadata:` and friends) are captured as raw text and their contents
 * are not interpreted — this gate checks the fields the spec puts limits on,
 * and says so rather than pretending to validate arbitrary YAML.
 *
 * @param {string} text Full file contents.
 * @returns {{ok: boolean, error?: string, fields: Map<string, {value: string, line: number}>, bodyStartLine: number}}
 */
function parseFrontmatter(text) {
  const fields = new Map();
  // A byte-order mark before the opening fence is untidy, not fatal; the
  // hidden-character scan reports it separately.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);

  if (lines[0] !== "---") {
    return {
      ok: false,
      error: "no YAML frontmatter — the file must start with a line containing exactly ---",
      fields,
      bodyStartLine: 1,
    };
  }

  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closing = i;
      break;
    }
  }
  if (closing === -1) {
    return {
      ok: false,
      error: "frontmatter is never closed — add a line containing exactly --- after the last field",
      fields,
      bodyStartLine: 1,
    };
  }

  let currentKey = null;
  for (let i = 1; i < closing; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;

    // An indented line continues the value of the key above it.
    if (/^\s/.test(line) && currentKey) {
      const entry = fields.get(currentKey);
      entry.value = entry.value ? `${entry.value}\n${line.trim()}` : line.trim();
      continue;
    }

    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      currentKey = null;
      continue;
    }
    currentKey = match[1];
    fields.set(currentKey, { value: unquote(match[2].trim()), line: i + 1 });
  }

  return { ok: true, fields, bodyStartLine: closing + 2 };
}

/** Strip one layer of matching quotes, and drop a block-scalar indicator. */
function unquote(raw) {
  if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") return "";
  if (raw.length >= 2 && raw[0] === raw[raw.length - 1] && (raw[0] === '"' || raw[0] === "'")) {
    return raw.slice(1, raw.length - 1);
  }
  return raw;
}

/**
 * Find every character in `text` that a reviewer cannot see.
 *
 * @param {string} text Full file contents.
 * @returns {Array<{id: string, level: 'error'|'warn', codePoint: string, line: number, column: number, why: string}>}
 */
function findHiddenCharacters(text) {
  const found = [];
  let line = 1;
  let column = 1;
  let offset = 0;

  for (const char of text) {
    const cp = char.codePointAt(0);

    if (char === "\n") {
      line += 1;
      column = 1;
      offset += char.length;
      continue;
    }

    const rule = HIDDEN_CHARACTERS.find((r) => r.test(cp));
    if (rule) {
      // A byte-order mark is expected at offset 0 and suspicious anywhere else.
      const level = rule.level === "byteOrderMark" ? (offset === 0 ? "warn" : "error") : rule.level;
      found.push({
        id: rule.id,
        level,
        codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
        line,
        column,
        why: rule.why,
      });
    }

    column += 1;
    offset += char.length;
  }

  return found;
}

/**
 * Check one skill.
 *
 * @param {{dirName: string, relPath: string, content: string}} skill
 *   `dirName` is the folder the SKILL.md sits in (the spec requires `name` to
 *   match it), `relPath` is what gets printed to the user.
 * @returns {Array<{level: 'error'|'warn', code: string, file: string, line: number, message: string, fix: string}>}
 */
function checkSkill({ dirName, relPath, content }) {
  const findings = [];
  const add = (level, code, line, message, fix) =>
    findings.push({ level, code, file: relPath, line, message, fix });

  // --- hidden characters, before anything that reads the text as meaning ---
  for (const hit of findHiddenCharacters(content)) {
    add(
      hit.level,
      `hidden-character:${hit.id}`,
      hit.line,
      `invisible character ${hit.codePoint} at column ${hit.column} — ${hit.why}`,
      hit.level === "error"
        ? "Open the file in a hex viewer and delete the character. Do not install this skill until you know who put it there."
        : "Confirm the character is intentional; delete it if it is not.",
    );
  }

  // --- frontmatter ---------------------------------------------------------
  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    add("error", "frontmatter-invalid", 1, fm.error, "See https://agentskills.io/specification");
    return findings;
  }

  for (const required of SPEC.requiredFields) {
    if (!fm.fields.has(required) || fm.fields.get(required).value.trim() === "") {
      add(
        "error",
        `${required}-missing`,
        1,
        `frontmatter is missing a non-empty "${required}"`,
        `Add "${required}: ..." between the --- fences.`,
      );
    }
  }

  const name = fm.fields.get("name");
  if (name && name.value.trim() !== "") {
    const value = name.value.trim();
    if (value.length > SPEC.nameMaxChars) {
      add(
        "error",
        "name-too-long",
        name.line,
        `name is ${value.length} characters; the specification allows ${SPEC.nameMaxChars}`,
        "Shorten the name.",
      );
    }
    if (!SPEC.namePattern.test(value)) {
      add(
        "error",
        "name-invalid",
        name.line,
        `name "${value}" must be lowercase letters, numbers and single hyphens, and may not start or end with a hyphen`,
        "Rename it, for example: my-skill-name",
      );
    }
    if (dirName && value !== dirName) {
      add(
        "error",
        "name-dir-mismatch",
        name.line,
        `name "${value}" does not match the folder it lives in ("${dirName}")`,
        `Rename the folder to "${value}", or change the name field to "${dirName}".`,
      );
    }
  }

  const description = fm.fields.get("description");
  if (description && description.value.trim() !== "") {
    const value = description.value.trim();
    if (value.length > SPEC.descriptionMaxChars) {
      add(
        "error",
        "description-too-long",
        description.line,
        `description is ${value.length} characters; the specification allows ${SPEC.descriptionMaxChars}`,
        "Move the detail into the body. Only the description is loaded for every skill, every session.",
      );
    }
    // Every skill's description is in context at all times; the agent picks a
    // skill from it alone. A description that says what the skill does but not
    // when to reach for it will simply not be chosen.
    if (!/\bwhen\b/i.test(value)) {
      add(
        "warn",
        "description-no-trigger",
        description.line,
        "description never says WHEN to use the skill, so an agent has nothing to match a task against",
        'Add a trigger clause, for example: "Use when the user asks to ...".',
      );
    }
  }

  const compatibility = fm.fields.get("compatibility");
  if (compatibility && compatibility.value.trim().length > SPEC.compatibilityMaxChars) {
    add(
      "error",
      "compatibility-too-long",
      compatibility.line,
      `compatibility is ${compatibility.value.trim().length} characters; the specification allows ${SPEC.compatibilityMaxChars}`,
      "Shorten it, or move the detail into the body.",
    );
  }

  for (const [key, entry] of fm.fields) {
    if (SPEC.specFields.includes(key)) continue;
    if (VENDOR_FIELDS[key]) {
      add(
        "warn",
        "non-portable-field",
        entry.line,
        `"${key}" is understood by ${VENDOR_FIELDS[key]} but is not in the specification — other agents ignore it, and strict parsers reject the whole file`,
        `Keep it only if this skill is for ${VENDOR_FIELDS[key]} alone. For a portable skill, use the six spec fields: ${SPEC.specFields.join(", ")}.`,
      );
    } else {
      add(
        "warn",
        "unknown-field",
        entry.line,
        `"${key}" is not a field in the Agent Skills specification`,
        `Spec fields: ${SPEC.specFields.join(", ")}. Remove it, or move it under "metadata".`,
      );
    }
  }

  // --- angle brackets in frontmatter --------------------------------------
  // Frontmatter values are pasted into the agent's skill listing, which for
  // several models is itself an XML-ish document. A "<" in a description can
  // therefore open or close a tag in the surrounding prompt rather than being
  // read as text — the same class of bug as unescaped HTML in a web page.
  for (const field of ["name", "description", "compatibility"]) {
    const entry = fm.fields.get(field);
    if (entry && /[<>]/.test(entry.value)) {
      add(
        "warn",
        "angle-bracket-in-frontmatter",
        entry.line,
        `"${field}" contains < or >, which can be read as a tag by the prompt this value is pasted into`,
        'Rewrite without angle brackets — for example "under 300 tokens" instead of "<300 tokens".',
      );
    }
  }

  // --- body length ---------------------------------------------------------
  const lineCount = content.split(/\r?\n/).length;
  if (lineCount > SPEC.bodyMaxLines) {
    add(
      "warn",
      "body-too-long",
      SPEC.bodyMaxLines,
      `SKILL.md is ${lineCount} lines; the specification recommends staying under ${SPEC.bodyMaxLines}`,
      "Move reference material into references/ and link to it, so it loads only when needed.",
    );
  }

  return findings;
}

/**
 * Find every skill under `dir`.
 *
 * Accepts a folder of skills (`skills/<name>/SKILL.md`) or a single skill
 * folder (`some-skill/SKILL.md`), because both are things a reader will point
 * this at — the repo's own `skills/`, and one downloaded skill they are about
 * to trust.
 *
 * @param {string} dir Absolute path.
 * @param {string} root Absolute path that printed paths are relative to.
 * @returns {Array<{dirName: string, relPath: string, absPath: string}>}
 */
function discoverSkills(dir, root) {
  const rel = (p) => path.relative(root, p).split(path.sep).join("/") || path.basename(p);
  const found = [];

  const direct = path.join(dir, "SKILL.md");
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    found.push({ dirName: path.basename(dir), relPath: rel(direct), absPath: direct });
    return found;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      found.push({ dirName: entry.name, relPath: rel(skillMd), absPath: skillMd });
    }
  }
  // Stable order, so output is identical on every platform and in every run.
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ─────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────

const HELP = [
  "check-skills — validate Agent Skills (SKILL.md) for spec conformance and hidden characters",
  "",
  "Usage: node scripts/check-skills.js [dir ...] [--dir <path>] [--strict] [--json] [--quiet]",
  "",
  "  Scans ./skills by default. Point it at .claude/skills (or .cursor/skills,",
  "  .codex/skills, ...) to check a skill you are about to trust.",
  "",
  "Exit codes: 0 clean | 1 problems found | 2 usage error",
].join("\n");

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{dirs: string[], strict: boolean, json: boolean, quiet: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const opts = { dirs: [], strict: false, json: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") opts.strict = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "--dir") {
      if (i + 1 >= argv.length) return { ...opts, error: "--dir needs a path" };
      opts.dirs.push(argv[++i]);
    } else if (arg.startsWith("-")) {
      return { ...opts, error: `unknown option "${arg}"` };
    } else {
      opts.dirs.push(arg);
    }
  }
  if (opts.dirs.length === 0) opts.dirs.push("skills");
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

  const skills = [];
  for (const dir of opts.dirs) {
    const abs = path.resolve(root, dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      process.stderr.write(`! not a directory: ${dir}\n`);
      return 2;
    }
    skills.push(...discoverSkills(abs, root));
  }

  if (skills.length === 0) {
    process.stderr.write(`! no SKILL.md found under: ${opts.dirs.join(", ")}\n`);
    return 2;
  }

  const findings = [];
  for (const skill of skills) {
    findings.push(
      ...checkSkill({
        dirName: skill.dirName,
        relPath: skill.relPath,
        content: fs.readFileSync(skill.absPath, "utf8"),
      }),
    );
  }

  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");
  const failed = errors.length > 0 || (opts.strict && warnings.length > 0);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        { ok: !failed, scanned: skills.map((s) => s.relPath), errors, warnings },
        null,
        2,
      ) + "\n",
    );
    return failed ? 1 : 0;
  }

  for (const finding of [...errors, ...warnings]) {
    const tag = finding.level === "error" ? "✗ error" : "! warning";
    process.stdout.write(`${tag}  ${finding.file}:${finding.line}  [${finding.code}]\n`);
    process.stdout.write(`         ${finding.message}\n`);
    process.stdout.write(`         → ${finding.fix}\n\n`);
  }

  if (failed) {
    process.stdout.write(
      `✗ check-skills: ${skills.length} skill(s) scanned, ${errors.length} error(s), ${warnings.length} warning(s).\n`,
    );
  } else if (!opts.quiet) {
    process.stdout.write(
      `✓ check-skills: ${skills.length} skill(s) scanned, no errors` +
        (warnings.length ? `, ${warnings.length} warning(s).\n` : ".\n"),
    );
  }

  return failed ? 1 : 0;
}

// Only run the CLI when invoked directly, so the test suite can require() the
// pure helpers without the process exiting.
if (require.main === module) {
  process.exit(main());
}

module.exports = {
  SPEC,
  VENDOR_FIELDS,
  HIDDEN_CHARACTERS,
  parseFrontmatter,
  findHiddenCharacters,
  checkSkill,
  discoverSkills,
  parseArgs,
  main,
};

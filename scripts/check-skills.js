#!/usr/bin/env node
/**
 * check-skills
 *
 * Deterministic gate for Agent Skills. It answers three questions about a
 * skill FOLDER without asking a model anything:
 *
 *   1. Does SKILL.md conform to the Agent Skills specification?
 *      (https://agentskills.io/specification — frontmatter fields and limits)
 *   2. Does anything in the folder contain characters a reviewer cannot see?
 *   3. Does anything in the folder ask for something worth a second look —
 *      a script piped into a shell, a path where credentials live, a package
 *      installed with no version, instructions fetched while it runs?
 *
 * Questions 2 and 3 are the ones that matter for a skill you did not write.
 * A reviewer reads shapes on a screen; the model reads code points. When those
 * two differ, the review you did was of a different document than the one the
 * agent will follow.
 *
 * And a skill is a folder, not a file. The page a registry shows you is
 * SKILL.md; the thing that runs can be `install.sh` sitting next to it. That
 * gap is how the 2026 skill-registry poisoning campaigns worked, so this gate
 * reads every file in the folder. `docs/agent-security.md` explains the
 * attacks; this script is the executable form of the checks it describes.
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
 *   --file-only    Check SKILL.md only; skip the bundled files beside it.
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
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

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

// ─────────────────────────────────────────────────────────────────────────
// The rest of the package — every file that ships beside SKILL.md
// ─────────────────────────────────────────────────────────────────────────

/**
 * Limits for walking a skill folder.
 *
 * A gate that hangs on a folder somebody handed you is a gate you stop
 * running, so the walk is bounded in both directions: how many files it will
 * look at, and how much of each one it will read. Hitting a limit is reported,
 * never silently ignored — "I stopped looking" and "there was nothing to
 * find" must not look the same to a reader.
 */
const PACKAGE = {
  maxFiles: 400,
  maxScanBytes: 256 * 1024,
  // Not part of the skill a publisher authored: caches, checkouts and build
  // output. Scanning them produces noise about files nobody shipped.
  skipDirs: new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    "dist",
    "build",
  ]),
  // Extensions whose contents an agent or a shell will execute. The list is
  // about intent, not about the executable bit: a `.sh` in a skill folder is
  // there to be run, whether or not the checkout preserved its mode — and a
  // Windows checkout never does.
  codeExtensions: new Set([
    ".sh", ".bash", ".zsh", ".ksh", ".fish",
    ".ps1", ".psm1", ".psd1", ".bat", ".cmd",
    ".py", ".rb", ".pl", ".php", ".lua", ".r",
    ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
    ".exe", ".dll", ".so", ".dylib", ".jar", ".bin", ".app",
  ]),
};

/**
 * Patterns that describe something a skill can ask for which is worth a second
 * look. Each is written against ONE line of text.
 *
 * Two deliberate choices, both learned from gates people end up disabling:
 *
 *   - Only the unambiguous ones are errors. `curl … | sh` has no safe reading.
 *     Naming `~/.ssh/` might be an attack or might be a security skill
 *     explaining one, so it is a warning that asks a human to look.
 *   - Every rule can be suppressed on the line, because a document that
 *     teaches you to recognise an attack has to be able to quote it. See
 *     `parseAllowList`.
 *
 * Sources for the shapes themselves are in docs/agent-security.md; they are
 * the techniques observed in the 2026 skill-registry poisoning campaigns,
 * where the payload sat in a bundled file rather than in SKILL.md.
 */
const RISK_PATTERNS = [
  {
    id: "pipe-to-shell",
    level: "error",
    // curl … | sh   ·   wget … | sudo bash
    test: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:\/usr\/bin\/env\s+)?(?:ba|z|k|da)?sh\b/i,
    why: "downloads a script and runs it in one step, so nobody ever reads what ran",
    fix: "Download it to a file, read the file, then run it — or pin a release and check its hash.",
  },
  {
    id: "pipe-to-shell",
    level: "error",
    // The Windows spelling of the same thing: iwr … | iex
    test: /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^\n|]*\|\s*(?:iex|invoke-expression)\b/i,
    why: "downloads a script and runs it in one step (PowerShell), so nobody ever reads what ran",
    fix: "Save it with Invoke-WebRequest -OutFile, read the file, then run it.",
  },
  {
    id: "reverse-shell",
    level: "error",
    test: /\/dev\/tcp\/|\bnc\b[^\n]{0,40}\s-e\s|\bncat\b[^\n]{0,40}--exec|\bbash\s+-i\s+>&/i,
    why: "opens a shell back to a remote machine — there is no legitimate reason for a skill to do this",
    fix: "Do not install this skill. Report it to whoever published it.",
  },
  {
    id: "credential-path",
    level: "warn",
    test: /\.ssh[/\\](?:id_[a-z0-9_]+|authorized_keys|config)\b|\bid_rsa\b|\bid_ed25519\b|\.aws[/\\]credentials\b|\.netrc\b|\.npmrc\b|\.gnupg\b|login\.keychain|\bsecurity\s+find-generic-password\b/i,
    why: "names a place where credentials live — a skill that reads it inherits every key you own",
    fix: "Confirm the skill genuinely needs this. If it does, the description must say so. If it does not, do not install it.",
  },
  {
    id: "outbound-data-post",
    level: "warn",
    test: /\bcurl\b[^\n]{0,120}(?:\s-d\b|\s--data\b|\s--data-binary\b|\s--data-raw\b|\s-F\b|\s--upload-file\b)|\bInvoke-(?:WebRequest|RestMethod)\b[^\n]{0,120}-Method\s+Post\b/i,
    why: "sends data to a server — fine for an API the skill is about, and the exfiltration step otherwise",
    fix: "Check the destination host. It should be the service the skill is named after, and nothing else.",
  },
  {
    id: "runtime-instruction-fetch",
    level: "warn",
    test: /\b(?:fetch|download|retrieve|pull|load|read)\b[^.\n]{0,60}\b(?:latest|current|newest|up[-\s]to[-\s]date)\b[^.\n]{0,60}\b(?:instructions?|rules?|prompts?|guidelines?|steps?|config(?:uration)?)\b/i,
    why: "instructions fetched while the skill runs can change after you reviewed it",
    fix: "Pin the instructions into the skill and commit them, so an upstream edit cannot reach you silently.",
  },
  {
    id: "runtime-instruction-fetch",
    level: "warn",
    test: /\b(?:instructions?|rules?|prompt|playbook)\b[^.\n]{0,40}\bfrom\s+https?:\/\//i,
    why: "instructions fetched while the skill runs can change after you reviewed it",
    fix: "Pin the instructions into the skill and commit them, so an upstream edit cannot reach you silently.",
  },
];

/**
 * Package installs that name no version.
 *
 * This is the rug-pull shape: a skill is reviewed and adopted while the
 * package behind it is harmless, and the package is updated afterwards. It is
 * exactly the npm supply-chain problem, reached through a skill instead of a
 * `package.json` — and unlike a `package.json`, nothing here has a lockfile.
 *
 * Written as a function rather than a pattern because deciding "is this
 * pinned?" means looking at the package token, and `@scope/name` puts an `@`
 * in a place that would fool a regex.
 */
const INSTALL_COMMANDS = [
  { kind: "npx", re: /\bnpx\s+(?:(?:-y|--yes|-q|--quiet|--no-install)\s+)*(@?[A-Za-z0-9][^\s'"`;|&()]*)/gi },
  { kind: "npm", re: /\b(?:npm|pnpm|bun)\s+(?:i|install|add)\s+(?:(?:-g|--global|-D|--save-dev|--save|-S|-E|-y)\s+)*(@?[A-Za-z0-9][^\s'"`;|&()]*)/gi },
  { kind: "npm", re: /\byarn\s+(?:global\s+)?add\s+(?:(?:-D|--dev)\s+)*(@?[A-Za-z0-9][^\s'"`;|&()]*)/gi },
  { kind: "pip", re: /\bpip3?\s+install\s+(?:(?:-U|--upgrade|--user|-q|--quiet|--no-cache-dir)\s+)*([A-Za-z][^\s'"`;|&()]*)/gi },
  { kind: "pip", re: /\buv\s+(?:tool\s+install|pip\s+install)\s+(?:(?:-U|--upgrade|-q)\s+)*([A-Za-z][^\s'"`;|&()]*)/gi },
];

/**
 * Does this package specifier name a version?
 *
 * @param {string} kind  Which ecosystem the command belongs to.
 * @param {string} spec  The token that followed the install command.
 * @returns {boolean}
 */
function isPinnedSpec(kind, spec) {
  if (kind === "pip") return /[=<>~!]=|@/.test(spec);
  // npm-family: `pkg@1.2.3` is pinned, `@scope/pkg` is not — so the `@` has to
  // be somewhere other than the first character.
  return spec.lastIndexOf("@") > 0;
}

/**
 * Read any `check-skills-allow:` markers on a line.
 *
 * A guide that teaches you to spot `curl … | sh` has to be allowed to write
 * `curl … | sh`. Without an escape hatch the honest documents fail and the
 * hostile ones pass, which is the wrong way round. The marker is deliberately
 * visible in the rendered page rather than hidden in a comment the reader
 * never sees: someone silencing a check should have to do it in public.
 *
 * Recognised on the offending line itself or on the line directly above it:
 *
 *     <!-- check-skills-allow: pipe-to-shell, credential-path -->
 *
 * @param {string} line
 * @returns {Set<string>} rule ids suppressed by this line
 */
function parseAllowList(line) {
  const allowed = new Set();
  if (typeof line !== "string") return allowed;
  const match = /check-skills-allow:([^\n]*)/i.exec(line);
  if (!match) return allowed;
  // Take the rest of the line and keep only things shaped like a rule id, so
  // the marker works inside any comment syntax — `<!-- ... -->`, `# ...`,
  // `// ...` — without the closing delimiter being read as an id.
  for (const token of match[1].split(/[\s,;]+/)) {
    if (/^[a-z0-9*][a-z0-9-]*$/i.test(token)) allowed.add(token.toLowerCase());
  }
  return allowed;
}

/**
 * Scan one file's text for the risk patterns above.
 *
 * @param {string} text
 * @returns {Array<{id: string, level: 'error'|'warn', line: number, match: string, why: string, fix: string}>}
 */
function scanRisks(text) {
  const found = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const allowed = new Set([...parseAllowList(line), ...parseAllowList(lines[i - 1])]);
    const suppressed = (id) => allowed.has(id) || allowed.has("*");

    for (const rule of RISK_PATTERNS) {
      if (suppressed(rule.id)) continue;
      const hit = rule.test.exec(line);
      if (!hit) continue;
      found.push({
        id: rule.id,
        level: rule.level,
        line: i + 1,
        match: hit[0].trim().slice(0, 120),
        why: rule.why,
        fix: rule.fix,
      });
    }

    if (!suppressed("unpinned-install")) {
      for (const { kind, re } of INSTALL_COMMANDS) {
        re.lastIndex = 0;
        let hit;
        while ((hit = re.exec(line)) !== null) {
          const spec = hit[1];
          if (isPinnedSpec(kind, spec)) continue;
          found.push({
            id: "unpinned-install",
            level: "warn",
            line: i + 1,
            match: hit[0].trim().slice(0, 120),
            why: `installs "${spec}" with no version, so the code that runs can change after you reviewed this skill`,
            fix: `Pin it — for example "${spec}${kind === "pip" ? "==1.2.3" : "@1.2.3"}".`,
          });
        }
      }
    }
  }

  return found;
}

/**
 * Decide whether a buffer is text we can review.
 *
 * A NUL byte in the first few kilobytes is the same test `grep` and `git` use,
 * and it beats trusting the extension: a payload renamed to `.txt` is still a
 * payload, and a `.py` with no extension is still Python.
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
function looksLikeText(buf) {
  return !buf.subarray(0, 4096).includes(0);
}

/**
 * Every file that ships inside a skill folder, SKILL.md included.
 *
 * @param {string} skillDir Absolute path to the folder holding SKILL.md.
 * @returns {{files: Array<{relPath: string, absPath: string, size: number}>, truncated: boolean, skippedDirs: string[]}}
 */
function collectPackageFiles(skillDir) {
  const files = [];
  const skippedDirs = [];
  let truncated = false;

  const walk = (dir, prefix) => {
    if (truncated) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // Sorted so the report is identical on macOS, Windows and Linux; readdir
    // order is not guaranteed and a gate whose output reorders per machine is
    // one you cannot diff.
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (truncated) return;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (PACKAGE.skipDirs.has(entry.name)) {
          skippedDirs.push(rel);
          continue;
        }
        walk(abs, rel);
        continue;
      }
      // A symlink is not followed. It can point outside the folder you think
      // you are reviewing, and "what did I actually install" should not depend
      // on where a link lands.
      if (!entry.isFile()) continue;

      let size = 0;
      try {
        size = fs.statSync(abs).size;
      } catch {
        continue;
      }
      if (files.length >= PACKAGE.maxFiles) {
        truncated = true;
        return;
      }
      files.push({ relPath: rel, absPath: abs, size });
    }
  };

  walk(skillDir, "");
  return { files, truncated, skippedDirs };
}

/**
 * Review everything in the skill folder that is NOT the frontmatter of
 * SKILL.md: the bundled scripts, references and data files.
 *
 * This is the half of a skill that a registry listing does not show you. The
 * page you read before installing is `SKILL.md`; the thing that runs may be
 * `install.sh` sitting next to it. Reviewing only the page is how the 2026
 * registry poisoning campaigns worked.
 *
 * @param {{skillDir: string, relDir: string, skillContent: string}} input
 * @returns {Array<{level: 'error'|'warn', code: string, file: string, line: number, message: string, fix: string}>}
 */
function checkPackage({ skillDir, relDir, skillContent }) {
  const findings = [];
  const add = (level, code, file, line, message, fix) =>
    findings.push({ level, code, file, line, message, fix });

  const { files, truncated, skippedDirs } = collectPackageFiles(skillDir);
  const rel = (p) => (relDir ? `${relDir}/${p}` : p);

  if (truncated) {
    add(
      "warn",
      "package-too-large",
      rel("."),
      1,
      `the folder holds more than ${PACKAGE.maxFiles} files, so the scan stopped early and part of this skill was never looked at`,
      "Review the folder by hand, or ask the publisher why a skill ships this many files.",
    );
  }
  for (const dir of skippedDirs) {
    add(
      "warn",
      "package-vendored-directory",
      rel(dir),
      1,
      `"${dir}" ships inside the skill and was not scanned — a skill should not carry a dependency tree or a checkout`,
      "Delete it from the skill and declare the dependency instead, so it can be pinned and audited.",
    );
  }

  for (const file of files) {
    if (file.relPath === "SKILL.md") continue; // already checked, in full
    const ext = path.extname(file.relPath).toLowerCase();
    const isCode = PACKAGE.codeExtensions.has(ext);

    // Does SKILL.md ever mention this file? A bundled file the instructions
    // never name is either dead weight or a payload the reviewer was not
    // pointed at. Matched on the basename as well as the path, because
    // SKILL.md usually writes `scripts/run.py` but sometimes just `run.py`.
    const base = path.basename(file.relPath);
    const referenced =
      skillContent.includes(file.relPath) || (base !== file.relPath && skillContent.includes(base));

    if (isCode) {
      add(
        "warn",
        "bundled-executable",
        rel(file.relPath),
        1,
        "runs with every permission you have, and installing the skill installs it too",
        "Read it the way you would read a dependency before adding it. If you cannot explain what it does, do not install the skill.",
      );
    }

    if (!referenced) {
      add(
        "warn",
        "unreferenced-bundled-file",
        rel(file.relPath),
        1,
        "ships with the skill but SKILL.md never mentions it, so nothing tells a reviewer to open it",
        "Delete it, or reference it from SKILL.md so the next reviewer knows it is there and why.",
      );
    }

    let buf;
    try {
      buf = fs.readFileSync(file.absPath);
    } catch {
      continue;
    }

    if (!looksLikeText(buf)) {
      add(
        isCode ? "error" : "warn",
        "unreviewable-binary",
        rel(file.relPath),
        1,
        isCode
          ? "is a compiled binary shipped inside a skill — nobody can review what it does by reading it"
          : "is not text, so this gate cannot review it",
        isCode
          ? "Do not install a skill that ships a binary. Ask the publisher for source you can build."
          : "Confirm the file is what its name says — an image or a data file, not a payload.",
      );
      continue;
    }
    if (file.size > PACKAGE.maxScanBytes) {
      add(
        "warn",
        "file-too-large-to-scan",
        rel(file.relPath),
        1,
        `is ${Math.round(file.size / 1024)} KB; only the first ${PACKAGE.maxScanBytes / 1024} KB were scanned`,
        "Review the rest by hand, or ask why a skill ships a file this size.",
      );
    }

    const text = buf.subarray(0, PACKAGE.maxScanBytes).toString("utf8");

    for (const hit of findHiddenCharacters(text)) {
      const level = hit.level;
      add(
        level,
        `hidden-character:${hit.id}`,
        rel(file.relPath),
        hit.line,
        `invisible character ${hit.codePoint} at column ${hit.column} — ${hit.why}`,
        level === "error"
          ? "Open the file in a hex viewer and delete the character. Do not install this skill until you know who put it there."
          : "Confirm the character is intentional; delete it if it is not.",
      );
    }

    for (const risk of scanRisks(text)) {
      add(risk.level, `risk:${risk.id}`, rel(file.relPath), risk.line, `${risk.match} — ${risk.why}`, risk.fix);
    }
  }

  return findings;
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

  // --- risky instructions --------------------------------------------------
  // SKILL.md is not documentation the agent reads for background. Every fenced
  // block in it is a command the agent may run, so the same patterns that
  // matter in a bundled script matter here.
  for (const risk of scanRisks(content)) {
    add(risk.level, `risk:${risk.id}`, risk.line, `${risk.match} — ${risk.why}`, risk.fix);
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
  // Resolve symlinks on BOTH sides before comparing them. A path can reach the
  // same file by two different routes — macOS makes os.tmpdir() a symlink, and
  // plenty of people keep a project under one — and path.relative comparing an
  // unresolved argument against a resolved cwd walks all the way up to the
  // common ancestor and back down. That turns "alpha/SKILL.md" into a screen of
  // "../" and makes the report useless exactly when someone is trying to read
  // it. Resolving both leaves a genuinely outside-root path relative and
  // readable, which is what a reader wants.
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  const realRoot = real(root);
  const rel = (p) => path.relative(realRoot, real(p)).split(path.sep).join("/") || path.basename(p);
  const found = [];

  const direct = path.join(dir, "SKILL.md");
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    found.push({ dirName: path.basename(dir), relPath: rel(direct), absPath: direct, skillDir: dir, relDir: rel(dir) });
    return found;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(dir, entry.name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      found.push({
        dirName: entry.name,
        relPath: rel(skillMd),
        absPath: skillMd,
        skillDir: path.join(dir, entry.name),
        relDir: rel(path.join(dir, entry.name)),
      });
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
  "Usage: node scripts/check-skills.js [dir ...] [--dir <path>] [--strict] [--file-only] [--json] [--quiet]",
  "",
  "  Scans ./skills by default. Point it at .claude/skills (or .cursor/skills,",
  "  .codex/skills, ...) to check a skill you are about to trust.",
  "",
  "  The WHOLE skill folder is reviewed, not just SKILL.md: bundled scripts,",
  "  references and data files are scanned too. --file-only checks SKILL.md",
  "  alone, which is faster but reviews the page instead of the package.",
  "",
  "Exit codes: 0 clean | 1 problems found | 2 usage error",
].join("\n");

/**
 * @param {string[]} argv Arguments after the script name.
 * @returns {{dirs: string[], strict: boolean, json: boolean, quiet: boolean, help: boolean}}
 */
function parseArgs(argv) {
  const opts = { dirs: [], strict: false, json: false, quiet: false, fileOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--strict") opts.strict = true;
    else if (arg === "--file-only") opts.fileOnly = true;
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
    const content = fs.readFileSync(skill.absPath, "utf8");
    findings.push(
      ...checkSkill({
        dirName: skill.dirName,
        relPath: skill.relPath,
        content,
      }),
    );
    if (!opts.fileOnly && skill.skillDir) {
      findings.push(
        ...checkPackage({
          skillDir: skill.skillDir,
          relDir: skill.relDir,
          skillContent: content,
        }),
      );
    }
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
  PACKAGE,
  RISK_PATTERNS,
  INSTALL_COMMANDS,
  parseFrontmatter,
  findHiddenCharacters,
  parseAllowList,
  isPinnedSpec,
  scanRisks,
  looksLikeText,
  collectPackageFiles,
  checkPackage,
  checkSkill,
  discoverSkills,
  parseArgs,
  main,
};

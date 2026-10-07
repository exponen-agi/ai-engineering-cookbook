#!/usr/bin/env node
/**
 * install-doc-coherence
 *
 * Installs the Doc Coherence skill (an Agent Skills / SKILL.md open-standard
 * skill, https://agentskills.io) into any compatible agentic tool, plus the
 * deterministic gate that makes it enforceable: the checker script and a
 * starter registry (coherence.config.json).
 *
 * The skill teaches an agent to keep a docs corpus coherent (single source of
 * truth — "pointers, not copies"). The gate (scripts/check-doc-coherence.js +
 * coherence.config.json) lets CI fail a PR when a doc restates a fact owned by
 * another doc. There is NO session-start hook for this skill.
 *
 * Usage:
 *   install-doc-coherence [options]
 *
 * Options:
 *   --tool <name>   Target tool: agents | claude | cursor | vscode | codex | antigravity | roo | others | custom.
 *                   Default: claude. (Controls only where SKILL.md lands.)
 *                   "others" installs into a .coding/ folder to rename later.
 *   --target <dir>  With --tool custom, install SKILL.md under <dir>/doc-coherence/.
 *   --user          Install the SKILL.md to the tool's user-global config dir if
 *                   supported. The gate (script + config) is always project-scoped.
 *   --skill-only    Install only SKILL.md; skip the checker script and registry.
 *   --with-ci       Also drop a GitHub Actions workflow at
 *                   .github/workflows/doc-coherence.yml.
 *   --force         Overwrite existing files.
 *   --dry-run       Print planned actions; write nothing.
 *   -h, --help      Show help.
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const opts = {
  tool: (flagValue("--tool") || "claude").toLowerCase(),
  target: flagValue("--target"),
  user: args.includes("--user"),
  skillOnly: args.includes("--skill-only"),
  withCi: args.includes("--with-ci"),
  force: args.includes("--force"),
  dryRun: args.includes("--dry-run"),
  help: args.includes("-h") || args.includes("--help"),
};

if (opts.help) {
  process.stdout.write(
    [
      "install-doc-coherence — install the Doc Coherence skill + single-source-of-truth gate",
      "",
      "Usage:",
      "  install-doc-coherence [options]",
      "",
      "Options:",
      "  --tool <name>   agents (portable) | claude (default) | cursor | vscode | codex | antigravity | roo | others | custom",
      "  --target <dir>  Required with --tool custom. Skill lands at <dir>/doc-coherence/SKILL.md.",
      "  --user          Install SKILL.md to user-global dir if supported. Gate stays project-scoped.",
      "  --skill-only    Install only SKILL.md; skip checker script + registry.",
      "  --with-ci       Also write .github/workflows/doc-coherence.yml.",
      "  --force         Overwrite existing files.",
      "  --dry-run       Print planned actions; write nothing.",
      "  -h, --help      Show this help.",
      "",
      "Examples:",
      "  # Claude Code, project scope, with skill + gate (default)",
      "  install-doc-coherence",
      "",
      "  # Skill + gate + CI workflow",
      "  install-doc-coherence --with-ci",
      "",
      "  # Just the skill for Cursor, no gate tooling",
      "  install-doc-coherence --tool cursor --skill-only",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const SKILL_NAME = "doc-coherence";
const PKG_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(PKG_ROOT, "skills", SKILL_NAME, "SKILL.md");
const CHECKER_SRC = path.join(PKG_ROOT, "scripts", "check-doc-coherence.js");
const CONFIG_SRC = path.join(PKG_ROOT, "templates", "coherence.config.json");
const WORKFLOW_SRC = path.join(PKG_ROOT, ".github", "workflows", "doc-coherence.yml");

// --- Resolve target paths per tool --------------------------------------
// Where each agent reads skills from lives in one shared table, so the CLI
// picker and all three installers cannot disagree. See bin/tool-profiles.js.
const { resolveSkillsBase, legacyInstallNotice } = require("./tool-profiles.js");

const resolved = resolveSkillsBase({
  tool: opts.tool,
  user: opts.user,
  target: opts.target,
  cwd: process.cwd(),
});
if (!resolved.ok) {
  process.stderr.write(`! ${resolved.error}\n`);
  process.exit(2);
}
const { base: skillsBase, profile } = resolved;

const legacyNotice = legacyInstallNotice(profile, process.cwd());

const SKILL_DEST = path.join(skillsBase, SKILL_NAME, "SKILL.md");
const cwd = process.cwd();
const CHECKER_DEST = path.join(cwd, "scripts", "check-doc-coherence.js");
const CONFIG_DEST = path.join(cwd, "coherence.config.json");
const WORKFLOW_DEST = path.join(cwd, ".github", "workflows", "doc-coherence.yml");

// --- Helpers ------------------------------------------------------------
const log = (msg) => process.stdout.write(msg + "\n");
const dry = opts.dryRun ? "[dry-run] " : "";

function copyFile(src, dest, label) {
  if (!fs.existsSync(src)) {
    log(`! source missing: ${src}`);
    process.exit(1);
  }
  if (fs.existsSync(dest) && !opts.force) {
    log(`- ${label} already exists, skipping (use --force to overwrite): ${dest}`);
    return false;
  }
  if (opts.dryRun) {
    log(`${dry}would write ${label} → ${dest}`);
    return true;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  log(`✓ installed ${label} → ${dest}`);
  return true;
}

// --- Run ----------------------------------------------------------------
log(
  `Installing Doc Coherence for ${profile.label}${opts.user ? " (user-global skill)" : ""}${opts.dryRun ? " (dry-run)" : ""}`,
);

copyFile(SKILL_SRC, SKILL_DEST, "skill");

if (!opts.skillOnly) {
  copyFile(CHECKER_SRC, CHECKER_DEST, "checker script");
  // seed the registry at the repo root; never clobber an existing one without --force
  copyFile(CONFIG_SRC, CONFIG_DEST, "starter registry (coherence.config.json)");
} else {
  log("- skipping gate tooling (--skill-only)");
}

if (opts.withCi) {
  copyFile(WORKFLOW_SRC, WORKFLOW_DEST, "CI workflow");
}

log("");
if (legacyNotice) {
  log(`\x1b[1m\x1b[33m! ${legacyNotice}\x1b[0m`);
  log("");
}
log("Done. Next steps:");
if (opts.tool === "claude") {
  log("  1. Restart Claude Code (or open a new session) so the skill registers.");
  log("  2. Try `/doc-coherence` (or ask the agent to use the doc-coherence skill).");
} else if (profile.renameNote) {
  const placeholderDir = path.resolve(cwd, ".coding");
  log("\x1b[1m\x1b[33m  ! Installed into a placeholder directory: .coding/\x1b[0m");
  log(`     ${placeholderDir}`);
  log("  Your agent was not in the known list, so the skill landed in a generic folder.");
  log("  1. Rename .coding/ to the skills directory your agent actually reads, e.g.:");
  log("       mv .coding .<your-agent>   # (whatever config dir your tool expects)");
  log(`  2. Restart ${profile.label} so it picks up the skill.`);
} else {
  log(`  1. Restart ${profile.label} so it picks up the new skill.`);
  log(`  2. Ask your agent to "use the doc-coherence skill to audit our docs".`);
}
if (!opts.skillOnly) {
  log("  3. Edit coherence.config.json — declare the canonical owner of each fact/term.");
  log("  4. Run the gate:  node scripts/check-doc-coherence.js");
}

#!/usr/bin/env node
/**
 * install-agent-tracing
 *
 * Installs the Agent Tracing skill (an Agent Skills / SKILL.md open-standard
 * skill, https://agentskills.io) into any compatible agentic tool, plus the
 * deterministic gate that makes its first step real: `scripts/check-semconv.js`.
 *
 * The skill teaches an agent to instrument an AI agent against the
 * OpenTelemetry GenAI semantic conventions — spans for agent turns, model
 * calls, tool calls and Agent Skill loads, with token and cost accounting. The
 * gate is the part that does not depend on anyone's judgement: it checks that
 * the `gen_ai.*` attribute names in a codebase are real, current, and spelled
 * the way a backend expects. So it is installed by default and can be wired
 * into CI.
 *
 * A worked example is installed alongside it, because the fastest way to get
 * the span shape right is to copy one that already passes the gate.
 *
 * There is NO session-start hook for this skill.
 *
 * Usage:
 *   install-agent-tracing [options]
 *
 * Options:
 *   --tool <name>   Target tool: claude | cursor | roo | vscode | codex | antigravity | others | custom.
 *                   Default: claude. (Controls only where SKILL.md lands.)
 *                   "others" installs into a .coding/ folder to rename later.
 *   --target <dir>  With --tool custom, install SKILL.md under <dir>/agent-tracing/.
 *   --user          Install the SKILL.md to the tool's user-global config dir if
 *                   supported. The gate is always project-scoped.
 *   --skill-only    Install only SKILL.md; skip the checker script and example.
 *   --force         Overwrite existing files.
 *   --dry-run       Print planned actions; write nothing.
 *   -h, --help      Show help.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

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
  force: args.includes("--force"),
  dryRun: args.includes("--dry-run"),
  help: args.includes("-h") || args.includes("--help"),
};

if (opts.help) {
  process.stdout.write(
    [
      "install-agent-tracing — install the Agent Tracing skill + the GenAI attribute gate",
      "",
      "Usage:",
      "  install-agent-tracing [options]",
      "",
      "Options:",
      "  --tool <name>   claude (default) | cursor | roo | vscode | codex | antigravity | others | custom",
      "  --target <dir>  Required with --tool custom. Skill lands at <dir>/agent-tracing/SKILL.md.",
      "  --user          Install SKILL.md to user-global dir if supported. Gate stays project-scoped.",
      "  --skill-only    Install only SKILL.md; skip the checker script and example.",
      "  --force         Overwrite existing files.",
      "  --dry-run       Print planned actions; write nothing.",
      "  -h, --help      Show this help.",
      "",
      "Examples:",
      "  # Claude Code, project scope, skill + gate + example (default)",
      "  install-agent-tracing",
      "",
      "  # Just the skill for Cursor, no gate tooling",
      "  install-agent-tracing --tool cursor --skill-only",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const SKILL_NAME = "agent-tracing";
const PKG_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(PKG_ROOT, "skills", SKILL_NAME, "SKILL.md");
const CHECKER_SRC = path.join(PKG_ROOT, "scripts", "check-semconv.js");
const EXAMPLE_SRC = path.join(PKG_ROOT, "templates", "tracing", "instrumentation.example.js");

// --- Resolve target paths per tool --------------------------------------
const TOOL_PROFILES = {
  claude: {
    label: "Claude Code",
    skillsDirProject: ".claude/skills",
    skillsDirUser: path.join(os.homedir(), ".claude", "skills"),
    supportsUser: true,
  },
  cursor: { label: "Cursor", skillsDirProject: ".cursor/skills", supportsUser: false },
  roo: { label: "Roo Code", skillsDirProject: ".roo/skills", supportsUser: false },
  vscode: {
    label: "VS Code Copilot",
    skillsDirProject: ".github/skills",
    skillsDirUser:
      process.platform === "win32" && process.env.APPDATA
        ? path.join(process.env.APPDATA, "github-copilot", "skills")
        : path.join(os.homedir(), ".copilot", "skills"),
    supportsUser: true,
  },
  codex: {
    label: "OpenAI Codex",
    skillsDirProject: ".codex/skills",
    skillsDirUser: path.join(os.homedir(), ".codex", "skills"),
    supportsUser: true,
  },
  antigravity: {
    label: "Google Antigravity",
    skillsDirProject: ".agents/skills",
    skillsDirUser: path.join(os.homedir(), ".gemini", "antigravity", "skills"),
    supportsUser: true,
  },
  others: {
    label: "Other / unlisted agent",
    skillsDirProject: ".coding/skills",
    supportsUser: false,
    renameNote: true,
  },
  custom: { label: "Custom", supportsUser: false },
};

const profile = TOOL_PROFILES[opts.tool];
if (!profile) {
  process.stderr.write(`! unknown --tool "${opts.tool}". Known: ${Object.keys(TOOL_PROFILES).join(", ")}\n`);
  process.exit(2);
}
if (opts.tool === "custom" && !opts.target) {
  process.stderr.write("! --tool custom requires --target <dir>\n");
  process.exit(2);
}
if (opts.user && !profile.supportsUser) {
  process.stderr.write(`! --user is not supported for ${profile.label} (project-scoped only)\n`);
  process.exit(2);
}

const skillsBase =
  opts.tool === "custom"
    ? path.resolve(opts.target)
    : opts.user
      ? profile.skillsDirUser
      : path.resolve(process.cwd(), profile.skillsDirProject);

const SKILL_DEST = path.join(skillsBase, SKILL_NAME, "SKILL.md");
const cwd = process.cwd();
const CHECKER_DEST = path.join(cwd, "scripts", "check-semconv.js");
const EXAMPLE_DEST = path.join(cwd, "templates", "tracing", "instrumentation.example.js");

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
  `Installing Agent Tracing for ${profile.label}${opts.user ? " (user-global skill)" : ""}${opts.dryRun ? " (dry-run)" : ""}`,
);

copyFile(SKILL_SRC, SKILL_DEST, "skill");

if (!opts.skillOnly) {
  copyFile(CHECKER_SRC, CHECKER_DEST, "checker script");
  copyFile(EXAMPLE_SRC, EXAMPLE_DEST, "tracing example");
} else {
  log("- skipping gate tooling and example (--skill-only)");
}

log("");
log("Done. Next steps:");
if (opts.tool === "claude") {
  log("  1. Restart Claude Code (or open a new session) so the skill registers.");
  log("  2. Try `/agent-tracing` (or ask the agent to use the agent-tracing skill).");
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
  log(`  2. Ask your agent to "use the agent-tracing skill to add tracing to this agent".`);
}
if (!opts.skillOnly) {
  log("  3. Check the instrumentation you already have:");
  log("       node scripts/check-semconv.js src --strict");
  log("  4. Read the worked example, which passes the gate as shipped:");
  log("       templates/tracing/instrumentation.example.js");
  log("  5. Optional — add it to CI:  node scripts/check-semconv.js src --strict");
}

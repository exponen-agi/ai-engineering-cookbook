#!/usr/bin/env node
/**
 * install-prompt-optimizer
 *
 * Installs the Prompt Optimizer skill (an Agent Skills / SKILL.md open-standard
 * skill, https://agentskills.io) into any compatible agentic tool.
 *
 * For Claude Code, also installs the optional UserPromptSubmit "session-start
 * gate" hook that offers prompt optimization on the first substantive prompt
 * of every new session. Hooks are NOT part of the open standard, so this
 * piece is Claude Code–only.
 *
 * Usage:
 *   install-prompt-optimizer [options]
 *
 * Options:
 *   --tool <name>   Target tool: agents | claude | cursor | vscode | codex | antigravity | roo | others | custom.
 *                   Default: claude. "others" installs into a .coding/ folder to rename later.
 *   --target <dir>  With --tool custom, install SKILL.md under <dir>/<name>/.
 *   --user          Install to the tool's user-global config dir if supported.
 *                   (Claude Code: ~/.claude/. Cursor/Roo: not supported — project only.)
 *   --no-hook       Claude Code only: install the skill but skip the gate hook.
 *   --force         Overwrite existing files.
 *   --dry-run       Print planned actions; write nothing.
 *   -h, --help      Show help.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { hookCommandFor } = require("./hook-command");

const args = process.argv.slice(2);

function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const opts = {
  tool: (flagValue("--tool") || "claude").toLowerCase(),
  target: flagValue("--target"),
  user: args.includes("--user"),
  noHook: args.includes("--no-hook"),
  force: args.includes("--force"),
  dryRun: args.includes("--dry-run"),
  help: args.includes("-h") || args.includes("--help"),
};

if (opts.help) {
  process.stdout.write(
    [
      "install-prompt-optimizer — install the Prompt Optimizer skill into your agentic tool",
      "",
      "Usage:",
      "  install-prompt-optimizer [options]",
      "",
      "Options:",
      "  --tool <name>   agents (portable) | claude (default) | cursor | vscode | codex | antigravity | roo | others | custom",
      "  --target <dir>  Required with --tool custom. Skill lands at <dir>/prompt-optimizer/SKILL.md.",
      "  --user          Install to user-global dir if supported (claude, codex, antigravity, vscode).",
      "  --no-hook       Claude Code only: skill only; skip the session-start gate hook.",
      "  --force         Overwrite existing files.",
      "  --dry-run       Print planned actions; write nothing.",
      "  -h, --help      Show this help.",
      "",
      "Examples:",
      "  # Claude Code, project scope, with auto-gate (default)",
      "  install-prompt-optimizer",
      "",
      "  # Cursor",
      "  install-prompt-optimizer --tool cursor",
      "",
      "  # Roo Code",
      "  install-prompt-optimizer --tool roo",
      "",
      "  # Any tool that loads SKILL.md from a custom directory",
      "  install-prompt-optimizer \\",
      "      --tool custom --target ./my-skills",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

const SKILL_NAME = "prompt-optimizer";
const PKG_ROOT = path.resolve(__dirname, "..");
const SKILL_SRC = path.join(PKG_ROOT, "skills", SKILL_NAME, "SKILL.md");
const HOOK_SRC = path.join(PKG_ROOT, "hooks", "prompt-optimizer-gate.js");

// --- Resolve target paths per tool --------------------------------------
const { TOOL_PROFILES: BASE_PROFILES, resolveSkillsBase, legacyInstallNotice } = require("./tool-profiles.js");

// Where each agent reads skills from lives in one shared table — see
// bin/tool-profiles.js. Only the session-start hook is specific to this
// installer, so only that is layered on here.
const TOOL_PROFILES = Object.fromEntries(
  Object.entries(BASE_PROFILES).map(([tool, profile]) => [
    tool,
    tool === "claude"
      ? {
          ...profile,
          supportsHook: true,
          hooksDirProject: ".claude/hooks",
          hooksDirUser: path.join(os.homedir(), ".claude", "hooks"),
          settingsPathProject: ".claude/settings.json",
          settingsPathUser: path.join(os.homedir(), ".claude", "settings.json"),
        }
      : { ...profile, supportsHook: false },
  ]),
);

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

function installClaudeHook() {
  const hookDest = path.join(
    opts.user ? profile.hooksDirUser : path.resolve(process.cwd(), profile.hooksDirProject),
    "prompt-optimizer-gate.js",
  );
  const settingsPath = opts.user
    ? profile.settingsPathUser
    : path.resolve(process.cwd(), profile.settingsPathProject);

  copyFile(HOOK_SRC, hookDest, "gate hook");

  // The command string must resolve on the machine that reads settings.json,
  // which is not necessarily this one — see bin/hook-command.js.
  const hookEntry = {
    type: "command",
    command: hookCommandFor(hookDest, { user: opts.user, cwd: process.cwd() }),
  };

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch (e) {
      log(`! could not parse existing settings.json: ${e.message}`);
      log("  resolve manually, then re-run.");
      process.exit(1);
    }
  }
  settings.hooks = settings.hooks || {};
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];

  const alreadyRegistered = settings.hooks.UserPromptSubmit.some((group) =>
    (group.hooks || []).some(
      (h) => typeof h.command === "string" && h.command.includes("prompt-optimizer-gate.js"),
    ),
  );

  if (alreadyRegistered) {
    log(`- hook already registered in settings.json, skipping`);
    return;
  }

  settings.hooks.UserPromptSubmit.push({ hooks: [hookEntry] });

  if (opts.dryRun) {
    log(`${dry}would register UserPromptSubmit hook in ${settingsPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  log(`✓ registered hook in ${settingsPath}`);
}

// --- Run ----------------------------------------------------------------
log(
  `Installing Prompt Optimizer for ${profile.label}${opts.user ? " (user-global)" : ""}${opts.dryRun ? " (dry-run)" : ""}`,
);

copyFile(SKILL_SRC, SKILL_DEST, "skill");

if (profile.supportsHook && !opts.noHook) {
  installClaudeHook();
} else if (profile.supportsHook && opts.noHook) {
  log("- skipping gate hook (--no-hook)");
} else if (opts.tool !== "custom") {
  log(`- gate hook is Claude Code–only; ${profile.label} will use the skill via manual invocation.`);
}

log("");
if (legacyNotice) {
  log(`\x1b[1m\x1b[33m! ${legacyNotice}\x1b[0m`);
  log("");
}
log("Done. Next steps:");
if (opts.tool === "claude") {
  log("  1. Restart Claude Code (or open a new session) so settings.json reloads.");
  log("  2. Try `/prompt-optimizer` to verify the skill is registered.");
  if (!opts.noHook) {
    log("  3. Start a new session with a prompt > 30 chars — the gate should ask if you want to optimize.");
  }
} else if (profile.renameNote) {
  const placeholderDir = path.resolve(process.cwd(), ".coding");
  log("\x1b[1m\x1b[33m  ! Installed into a placeholder directory: .coding/\x1b[0m");
  log(`     ${placeholderDir}`);
  log("  Your agent was not in the known list, so the skill landed in a generic folder.");
  log("  1. Rename .coding/ to the skills directory your agent actually reads, e.g.:");
  log("       mv .coding .<your-agent>   # (whatever config dir your tool expects)");
  log(`  2. Restart ${profile.label} so it picks up the skill.`);
} else {
  log(`  1. Restart ${profile.label} so it picks up the new skill.`);
  log(`  2. Invoke the skill by asking your agent to "use the prompt-optimizer skill on this: ..."`);
}

/**
 * tool-profiles
 *
 * One table of "where does this coding agent read skills from", shared by the
 * CLI picker and by every installer.
 *
 * It used to be four copies — `bin/cli.js` plus one per installer — and they
 * had already drifted apart. A copy that is wrong is worse here than almost
 * anywhere else in this repo: the installer reports success, writes the file,
 * and the agent never loads it. Nothing fails, so nobody investigates.
 *
 * Every path below carries the source it came from. When one of them moves,
 * change it here and the whole CLI moves with it.
 *
 * ── Two kinds of directory ──────────────────────────────────────────────
 *
 * `.agents/skills/` is the shared, cross-agent convention. Most agents now
 * read it, so a skill installed there works in more than one tool at once.
 * The vendor-specific folders (`.claude/skills/`, `.cursor/skills/`, ...) are
 * still read by the tool that owns them, and Claude Code reads only its own.
 *
 * If you do not know which to pick, pick `agents`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = (...parts) => path.join(os.homedir(), ...parts);

/**
 * @typedef {object} ToolProfile
 * @property {string}  label             Human name, shown in the installer.
 * @property {string}  [skillsDirProject] Project-scoped skills directory.
 * @property {string}  [skillsDirUser]    User-global skills directory.
 * @property {boolean} supportsUser       Whether `--user` is meaningful.
 * @property {string}  [legacyDirProject] A directory this installer used to
 *   write to. If it still exists we say so, because a stale copy left behind
 *   means the agent may load the skill twice under one name.
 * @property {boolean} [renameNote]       Landed in a placeholder folder.
 * @property {string}  [source]           Where the paths were verified.
 */

/** @type {Record<string, ToolProfile>} */
const TOOL_PROFILES = {
  // The portable choice. Read by Codex, Cursor, Copilot, Gemini CLI, Amp,
  // OpenCode, Droid, Cline, Zed, Kilo, Firebender and others.
  agents: {
    label: "Any agent using the shared convention (recommended)",
    skillsDirProject: ".agents/skills",
    skillsDirUser: home(".agents", "skills"),
    supportsUser: true,
    source: "agentskills.io client-implementation guide; vercel-labs/skills agent table",
  },

  // Claude Code is the one major agent that reads only its own folder, so it
  // keeps a vendor-specific entry.
  claude: {
    label: "Claude Code",
    skillsDirProject: ".claude/skills",
    skillsDirUser: home(".claude", "skills"),
    supportsUser: true,
    source: "code.claude.com/docs/en/skills",
  },

  // Cursor reads .agents/skills first and .cursor/skills for compatibility.
  // We keep writing the vendor folder so an existing install is not orphaned,
  // and the user-global path is now wired up.
  cursor: {
    label: "Cursor",
    skillsDirProject: ".cursor/skills",
    skillsDirUser: home(".cursor", "skills"),
    supportsUser: true,
    source: "cursor.com/docs/skills",
  },

  // GitHub documents three project locations for Copilot — .github/skills,
  // .claude/skills and .agents/skills — and ~/.copilot/skills for personal
  // skills on every platform.
  vscode: {
    label: "GitHub Copilot (VS Code)",
    skillsDirProject: ".github/skills",
    skillsDirUser: home(".copilot", "skills"),
    supportsUser: true,
    source: "docs.github.com/en/copilot/concepts/agents/about-agent-skills",
  },

  // Codex does NOT read a .codex/skills folder in a project. OpenAI documents
  // .agents/skills at the working directory, at any parent inside the repo,
  // and at the repository root, with $HOME/.agents/skills for personal
  // skills. Earlier versions of this installer wrote .codex/skills, which
  // Codex silently ignored — hence legacyDirProject.
  codex: {
    label: "OpenAI Codex",
    skillsDirProject: ".agents/skills",
    skillsDirUser: home(".agents", "skills"),
    supportsUser: true,
    legacyDirProject: ".codex/skills",
    source: "developers.openai.com/codex/skills — 'Where Codex loads local skills'",
  },

  antigravity: {
    label: "Google Antigravity",
    skillsDirProject: ".agents/skills",
    skillsDirUser: home(".gemini", "antigravity", "skills"),
    supportsUser: true,
    source: "antigravity.google/docs/skills; vercel-labs/skills agent table",
  },

  roo: {
    label: "Roo Code",
    skillsDirProject: ".roo/skills",
    skillsDirUser: home(".roo", "skills"),
    supportsUser: true,
    source: "docs.roocode.com/features/skills",
  },

  // For an agent that is not listed. Lands somewhere obviously wrong so the
  // reader cannot forget to move it.
  others: {
    label: "Others (installs to .coding/, rename it afterward)",
    skillsDirProject: ".coding/skills",
    supportsUser: false,
    renameNote: true,
  },

  custom: { label: "Custom", supportsUser: false },
};

/**
 * The order the interactive picker lists environments in.
 *
 * `custom` is deliberately absent: it needs a `--target` path, so it is a
 * flag, not a menu entry.
 */
const MENU_ORDER = ["agents", "claude", "cursor", "vscode", "codex", "antigravity", "roo", "others"];

/**
 * The picker's rows, derived from the table above rather than restated.
 *
 * @type {Array<{tool: string, label: string, dir: string}>}
 */
const ENVIRONMENTS = MENU_ORDER.map((tool) => ({
  tool,
  label: TOOL_PROFILES[tool].label,
  dir: TOOL_PROFILES[tool].skillsDirProject,
}));

/** Tool keys an installer's `--tool` flag accepts. */
const TOOL_KEYS = Object.keys(TOOL_PROFILES);

/**
 * Work out where a skill should be written.
 *
 * @param {object} args
 * @param {string} args.tool    Key into TOOL_PROFILES.
 * @param {boolean} [args.user] Install to the user-global directory.
 * @param {string} [args.target] Directory for `--tool custom`.
 * @param {string} [args.cwd]   Project root. Defaults to process.cwd().
 * @returns {{ok: true, base: string, profile: ToolProfile} | {ok: false, error: string}}
 */
function resolveSkillsBase({ tool, user = false, target = null, cwd = process.cwd() }) {
  const profile = TOOL_PROFILES[tool];
  if (!profile) {
    return { ok: false, error: `unknown --tool "${tool}". Known: ${TOOL_KEYS.join(", ")}` };
  }
  if (tool === "custom") {
    if (!target) return { ok: false, error: "--tool custom requires --target <dir>" };
    return { ok: true, base: path.resolve(target), profile };
  }
  if (user) {
    if (!profile.supportsUser || !profile.skillsDirUser) {
      return { ok: false, error: `--user is not supported for ${profile.label} (project-scoped only)` };
    }
    return { ok: true, base: profile.skillsDirUser, profile };
  }
  return { ok: true, base: path.resolve(cwd, profile.skillsDirProject), profile };
}

/**
 * A warning to print when an earlier version of this installer wrote somewhere
 * the agent does not read.
 *
 * Leaving the old copy in place is not harmless: some agents load every skills
 * directory they know about, so two folders holding the same `name` produce a
 * duplicate the agent may resolve either way.
 *
 * @param {ToolProfile} profile
 * @param {string} [cwd]
 * @returns {string|null} The message, or null when there is nothing to say.
 */
function legacyInstallNotice(profile, cwd = process.cwd()) {
  if (!profile || !profile.legacyDirProject) return null;
  const abs = path.resolve(cwd, profile.legacyDirProject);
  if (!fs.existsSync(abs)) return null;
  return (
    `"${profile.legacyDirProject}" still exists in this project. ` +
    `${profile.label} does not read it, and an older version of this installer wrote there. ` +
    "Delete it so the same skill name cannot be loaded from two places."
  );
}

module.exports = {
  TOOL_PROFILES,
  ENVIRONMENTS,
  MENU_ORDER,
  TOOL_KEYS,
  resolveSkillsBase,
  legacyInstallNotice,
};

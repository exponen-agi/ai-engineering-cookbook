# Prompt Optimizer Skill

A reusable prompt-engineering skill that turns vague requests into production-grade prompts — framework selection (COSTAR / RISEN / RODES / PICO / RTF / CHAT / APE), model-specific calibration (Claude / GPT-4o / Gemini), adversarial red-team, and a quality scorecard.

It is packaged as an **[Agent Skills / SKILL.md](https://agentskills.io/specification)** skill — the open standard Anthropic released in December 2025 that is now supported by 30+ agentic tools including Claude Code, Cursor, Roo Code, VS Code Copilot, OpenAI Codex, and Google Antigravity. The same `SKILL.md` file works everywhere; only the install directory differs per tool.

There are **two install profiles**, depending on whether you want the optional session-start gate (Claude Code only) or just the portable skill.

---

## 📦 Install

Install the skill directly in your target repository using `npx`:

```bash
npx ai-engineering-cookbook prompt-optimizer
```

> **💡 Note on execution:** Since this cookbook is published to npm, we use `npx ai-engineering-cookbook prompt-optimizer` as a single router entry point. This downloads and runs the installer directly without polluting your global node_modules. Requires **Node.js 22+**.

### 🛠️ Troubleshooting & Fallbacks (If npx fails)

If `npx` fails or you are working in an environment with restricted network access/unresolved binary shims (common with direct GitHub URLs on Windows), you can install the package via `npm`:

#### Local Fallback (Recommended)

```bash
# From npm registry:
npm install --save-dev ai-engineering-cookbook
# OR from GitHub:
npm install --save-dev github:exponen-agi/ai-engineering-cookbook

# Run the installer:
npx ai-engineering-cookbook prompt-optimizer
```

#### Global Fallback

```bash
# From npm registry:
npm install -g ai-engineering-cookbook
# OR from GitHub:
npm install -g github:exponen-agi/ai-engineering-cookbook

# Run the installer:
ai-engineering-cookbook prompt-optimizer
```

---

## Profile A — With Claude Code (skill + auto-gate)

You get the slash-invokable skill **plus** an optional session-start gate that automatically offers prompt optimization on the first substantive prompt of every new session. The gate is a `UserPromptSubmit` hook — that mechanism is Claude-Code-specific (hooks are not part of the open standard), which is why it lives in this profile.

### Run the installer

```bash
npx ai-engineering-cookbook prompt-optimizer
```

Installs the skill into `./.claude/skills/prompt-optimizer/`, the hook into `./.claude/hooks/`, and registers the hook in `./.claude/settings.json`. Restart Claude Code (or open a new session) so `settings.json` reloads.

> **Maintainers — single source of truth:** the canonical skill file is [`skills/prompt-optimizer/SKILL.md`](../skills/prompt-optimizer/SKILL.md). The copy under `.claude/skills/prompt-optimizer/SKILL.md` is **generated install output** (git-ignored, produced by [`bin/install-prompt-optimizer.js`](../bin/install-prompt-optimizer.js)). Edit only the `skills/` source, then re-run the installer — never hand-edit the `.claude/` copy, or the shipped and local versions will silently drift.

### Behavior

| Trigger | What happens |
| :--- | :--- |
| You type `/prompt-optimizer` mid-conversation | Skill runs immediately. Works any time, in any session. |
| You start a new session with a first message > 30 chars | Hook fires once, asks "Run `prompt-optimizer` on your prompt first? (yes/no)". You stay in control. |
| First message is ≤ 30 chars, starts with `/`, or you already passed the gate | Hook is silent. Session proceeds normally. |
| A subagent / background orchestrator runs | Hook does **not** fire. `UserPromptSubmit` only triggers on top-level user prompts. |

### Common variants

```bash
# Skill only — no auto-gate
npx ai-engineering-cookbook prompt-optimizer --no-hook

# Global install (~/.claude/) — applies to every project
npx ai-engineering-cookbook prompt-optimizer --user

# Dry-run — show what would change
npx ai-engineering-cookbook prompt-optimizer --dry-run
```

### Tune the gate

Open `.claude/hooks/prompt-optimizer-gate.js` and edit `MIN_LENGTH` (default `30` chars).

### Uninstall

```bash
# macOS / Linux
rm -rf .claude/skills/prompt-optimizer .claude/hooks/prompt-optimizer-gate.js .claude/state/prompt-optimizer
```

```powershell
# Windows (PowerShell) — Windows paths use backslashes
Remove-Item -Recurse -Force .claude\skills\prompt-optimizer, .claude\hooks\prompt-optimizer-gate.js, .claude\state\prompt-optimizer
```

Remove the `UserPromptSubmit` entry from `.claude/settings.json`.

---

## Profile B — Any other agentic tool (skill only, manual invocation)

The session-start auto-gate is Claude-Code-specific. Everywhere else you **invoke the skill manually** by asking your agent to use it (e.g., *"use the prompt-optimizer skill on this prompt: ..."*). The skill body itself is fully portable — same file, different folder.

### Run the installer per tool

*(If running via global or local installation, replace `npx ai-engineering-cookbook` with `ai-engineering-cookbook` or your preferred path).*

```bash
# Any agent reading the shared folder (portable — start here)
#                             → .agents/skills/prompt-optimizer/
npx ai-engineering-cookbook prompt-optimizer --tool agents

# Cursor (project)            → .cursor/skills/prompt-optimizer/
# Cursor (global)             → ~/.cursor/skills/prompt-optimizer/
npx ai-engineering-cookbook prompt-optimizer --tool cursor

# Roo Code (project)          → .roo/skills/prompt-optimizer/
# Roo Code (global)           → ~/.roo/skills/prompt-optimizer/
npx ai-engineering-cookbook prompt-optimizer --tool roo

# VS Code Copilot (project)   → .github/skills/prompt-optimizer/
# VS Code Copilot (global)    → ~/.copilot/skills/prompt-optimizer/   (same on Windows)
npx ai-engineering-cookbook prompt-optimizer --tool vscode
npx ai-engineering-cookbook prompt-optimizer --tool vscode --user

# OpenAI Codex (project)      → .agents/skills/prompt-optimizer/
# OpenAI Codex (global)       → ~/.agents/skills/prompt-optimizer/
#   Codex reads .agents/skills, never .codex/skills. If an older install left
#   a .codex/skills folder behind, delete it.
npx ai-engineering-cookbook prompt-optimizer --tool codex
npx ai-engineering-cookbook prompt-optimizer --tool codex --user

# Google Antigravity (project)→ .agents/skills/prompt-optimizer/
# Google Antigravity (global) → ~/.gemini/antigravity/skills/prompt-optimizer/
npx ai-engineering-cookbook prompt-optimizer --tool antigravity
npx ai-engineering-cookbook prompt-optimizer --tool antigravity --user

# Any tool that loads SKILL.md from a custom directory
npx ai-engineering-cookbook prompt-optimizer \
    --tool custom --target ./my-skills
```

### How to invoke it

Once installed, ask your agent — phrasing that reliably activates the skill across tools:

> "Use the prompt-optimizer skill on this prompt: ..."

Most modern agents auto-discover skills via the `name` + `description` in the SKILL.md frontmatter (progressive disclosure pattern in the open standard). If your tool doesn't auto-discover, just paste the skill body into your tool's system-prompt / rules slot.

### Supported install locations (summary)

| Tool | Project scope | User scope | Auto-gate shipped by this installer? | Tool's own hook system |
| :--- | :--- | :--- | :--- | :--- |
| **Claude Code** | `.claude/skills/` | `~/.claude/skills/` | ✅ Yes | `UserPromptSubmit` ([docs](https://code.claude.com/docs/en/hooks-guide)) |
| **Cursor** | `.cursor/skills/` (also reads `.agents/skills/`) | `~/.cursor/skills/` ([per docs](https://cursor.com/docs/skills)) | ❌ Not yet | `beforeSubmitPrompt` since v1.7 ([Cursor Hooks docs](https://cursor.com/docs/hooks)) — port feasible |
| **Roo Code** | `.roo/skills/` | `~/.roo/skills/` | ❌ No | No equivalent prompt-submit hook |
| **VS Code Copilot** | `.github/skills/` (also reads `.agents/skills/`) | `~/.copilot/skills/` (same on Windows) | ❌ No | No equivalent prompt-submit hook today |
| **OpenAI Codex** | `.agents/skills/` | `~/.agents/skills/` | ❌ Not yet | `UserPromptSubmit`, `SessionStart`, etc. ([Codex Hooks docs](https://developers.openai.com/codex/hooks)) — port feasible |
| **Google Antigravity** | `.agents/skills/` | `~/.gemini/antigravity/skills/` | ❌ No | Skill lifecycle hooks exist but no prompt-submit equivalent confirmed |
| **Custom** | `<--target>/` | — | ❌ No | N/A |

Sources: [Agent Skills spec](https://agentskills.io/specification) · [Claude Code](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) · [Cursor Skills](https://cursor.com/docs/skills) · [Cursor Hooks](https://cursor.com/docs/hooks) · [Roo Code](https://docs.roocode.com/features/skills) · [VS Code](https://code.visualstudio.com/docs/copilot/customization/agent-skills) · [Codex Skills](https://developers.openai.com/codex/skills) · [Codex Hooks](https://developers.openai.com/codex/hooks) · [Antigravity](https://antigravity.google/docs/skills).

### Auto-gate availability — what the column means

"Auto-gate shipped by this installer" = whether `install-prompt-optimizer` currently writes a working hook script for that tool. Today, only the Claude Code hook is shipped.

**Cursor and Codex now both expose pre-submit hooks** (`beforeSubmitPrompt` and `UserPromptSubmit` respectively), so a port is technically straightforward — the existing `hooks/prompt-optimizer-gate.js` would need a tool-specific adapter for each vendor's stdin/stdout JSON contract. That work isn't done yet; contributions welcome.

For **Roo Code, VS Code Copilot, and Antigravity**, no public prompt-submit hook is available at this writing, so the gate can only be approximated by a markdown rule. The model would have to self-enforce it, which drifts after context compaction — manual invocation is more reliable.

---

## Installer options reference

```
--tool <name>   claude (default) | cursor | roo | vscode | codex | antigravity | custom
--target <dir>  Required with --tool custom. SKILL.md lands at <dir>/prompt-optimizer/SKILL.md.
--user          Install to user-global dir (claude, codex, antigravity, vscode).
--no-hook       Claude Code only: skill only, skip the session-start gate hook.
--force         Overwrite existing files.
--dry-run       Print planned actions; write nothing.
-h, --help      Show help.
```

Requirements: **Node.js 22+** on `PATH`.

---

## What the skill does (regardless of tool)

When invoked, it follows this protocol:

1. **Intake** — Asks 4 questions: target model, deployment slot, usage context, token budget.
2. **Diagnosis** — Identifies domain, goal, audience, output type, stakes, deployment slot.
3. **Framework selection** — Picks COSTAR / RISEN / RODES / PICO / RTF / CHAT / APE with rationale.
4. **Optimized prompt** — Returns a complete, copy-paste-ready prompt (with XML tags for Claude targets).
5. **Adversarial red-team** — Generates 3 failure scenarios + ease ratings; adjusts score for "Easy" failures.
6. **Quality scorecard** — Rates clarity, specificity, context-richness, output-guidance, persona-alignment, model calibration, token efficiency.
7. **Design choices + micro-variants** — Explains decisions and offers token-constrained or alternative-framework variants.

Full protocol: see [`skills/prompt-optimizer/SKILL.md`](../skills/prompt-optimizer/SKILL.md).

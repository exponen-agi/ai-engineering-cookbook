# Doc-Coherence Skill

A portable Agent Skill that kills cross-document drift — the failure mode where two docs disagree but **both look valid**. It enforces single-source-of-truth: every fact or term has exactly **one** canonical owning file declared in a registry (`coherence.config.json`), and every other doc must **point to it** (a link) rather than restate it. This turns CLAUDE.md §8's "pointers, not copies" rule from advice into an enforced CI gate — a deterministic grep that fails the build the moment an owned phrase is copied into a non-owner. It is packaged as an **[Agent Skills / SKILL.md](https://agentskills.io/specification)** skill and installs into any repo via `npx`, exactly like its sibling [prompt-optimizer](./prompt-optimizer.md).

---

## 📦 Install

Install the skill directly in your target repository using `npx`:

```bash
npx ai-engineering-cookbook doc-coherence
```

> **💡 Note on execution:** Since this cookbook is published to npm, we use `npx ai-engineering-cookbook doc-coherence` as a single router entry point. This downloads and runs the installer directly without polluting your global node_modules. Requires **Node.js 22+**.

### 🛠️ Troubleshooting & Fallbacks (If npx fails)

If `npx` fails or you are working in an environment with restricted network access/unresolved binary shims (common with direct GitHub URLs on Windows), you can install the package via `npm`:

#### Local Fallback (Recommended)

```bash
# From npm registry:
npm install --save-dev ai-engineering-cookbook
# OR from GitHub:
npm install --save-dev github:exponen-agi/ai-engineering-cookbook

# Run the installer:
npx ai-engineering-cookbook doc-coherence
```

#### Global Fallback

```bash
# From npm registry:
npm install -g ai-engineering-cookbook
# OR from GitHub:
npm install -g github:exponen-agi/ai-engineering-cookbook

# Run the installer:
ai-engineering-cookbook doc-coherence
```

---

Installs `skills/doc-coherence/SKILL.md` into the tool's skills directory (default `./.claude/skills/doc-coherence/`). The same `SKILL.md` works across every Agent-Skills-compatible tool; only the install folder differs. Unlike prompt-optimizer, this skill ships **no session-start hook** — enforcement happens in CI, not on every prompt.

| Flag | Effect |
| :--- | :--- |
| `--tool <name>` | `claude` (default) `\| cursor \| roo \| vscode \| codex \| antigravity \| custom`. Picks the install dir. |
| `--target <dir>` | Required with `--tool custom`. SKILL.md lands at `<dir>/doc-coherence/SKILL.md`. |
| `--user` | Install to the user-global skills dir instead of the project dir. |
| `--force` | Overwrite an existing install. |
| `--dry-run` | Print planned actions; write nothing. |

### Run the installer per tool

*(If running via global or local installation, replace `npx ai-engineering-cookbook` with `ai-engineering-cookbook` or your preferred path).*

```bash
# Claude Code (default)       → .claude/skills/doc-coherence/
npx ai-engineering-cookbook doc-coherence

# Cursor                      → .cursor/skills/doc-coherence/
npx ai-engineering-cookbook doc-coherence --tool cursor

# Roo Code                    → .roo/skills/doc-coherence/
npx ai-engineering-cookbook doc-coherence --tool roo

# VS Code Copilot (project)   → .github/skills/doc-coherence/
# VS Code Copilot (global)    → ~/.copilot/skills/doc-coherence/
#                                (Windows: %APPDATA%\github-copilot\skills\)
npx ai-engineering-cookbook doc-coherence --tool vscode
npx ai-engineering-cookbook doc-coherence --tool vscode --user

# OpenAI Codex (project)      → .codex/skills/doc-coherence/
# OpenAI Codex (global)       → ~/.codex/skills/doc-coherence/
npx ai-engineering-cookbook doc-coherence --tool codex
npx ai-engineering-cookbook doc-coherence --tool codex --user

# Google Antigravity (project)→ .agents/skills/doc-coherence/
# Google Antigravity (global) → ~/.gemini/antigravity/skills/doc-coherence/
npx ai-engineering-cookbook doc-coherence --tool antigravity
npx ai-engineering-cookbook doc-coherence --tool antigravity --user

# Any tool that loads SKILL.md from a custom directory
npx ai-engineering-cookbook doc-coherence \
    --tool custom --target ./my-skills
```

Requirements: **Node.js 22+** on `PATH`. The CI gate itself (`scripts/check-doc-coherence.js`) is dependency-free Node.

---

## ⚙️ How it works

Three layers, in order of trust:

1. **The registry** — `coherence.config.json` declares which file owns each fact and the distinctive marker strings that must live only there. It is the machine-readable twin of a glossary.
2. **Deterministic detection** — the gate greps each fact's markers across every scanned doc. A marker found **outside** its owner (and outside the fact's `allow` list and the `generated` globs) is drift → exit 1 with `file:line`. No LLM, no tokens, no network — it is fast and never flaky, so it is safe to wire into CI.
3. **Self-validation** — the gate also checks itself. If a marker is **missing** from its declared owner (a stale registry) or an owner anchor matches no heading, it prints a **registry warning**. Warnings are advisory and **do not fail the build** (still exit 0) — only real drift fails.

### 🔎 The honest limit

Marker matching catches **verbatim and near-verbatim** restatement. It does **not** catch pure paraphrase — if a second doc rewrites an owned fact in entirely different words, the grep will miss it. For paraphrase-level conflicts the skill offers an **optional advisory LLM pass**, run by the agent **on demand**, never inside the CI gate. This is a deliberate tradeoff: CI stays deterministic and green-or-red, while the fuzzy, judgment-heavy work stays out of the pipeline where it could go flaky.

---

## 🗂️ The registry (`coherence.config.json`)

```jsonc
{
  "include": ["**/*.md"],
  "ignore": ["node_modules/**", ".git/**", "dist/**", "build/**", "**/CHANGELOG.md"],
  "generated": [".claude/skills/**", ".cursor/skills/**", ".github/skills/**"],
  "authorityOrder": [
    ".specify/memory/constitution.md",
    "README.md",
    "CLAUDE.md",
    "docs/governance.md"
  ],
  "tiebreak": "codeowners",
  "facts": [
    {
      "id": "canonical-glossary",
      "title": "Glossary of canonical terms",
      "owner": "README.md#glossary-canonical-terms",
      "rule": "owner-only",
      "markers": ["<distinctive sentence that must appear ONLY in the owner>"],
      "allow": [],
      "note": "Why this fact has one home, in human words."
    }
  ]
}
```

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `include` | `string[]` | Globs of docs to scan. Default `["**/*.md"]`. |
| `ignore` | `string[]` | Globs to skip — vendored code, build output, changelogs. |
| `generated` | `string[]` | Globs of generated / installed output (e.g. `.claude/skills/**`). Generated files **never win** over their source and are **never blamed** for drift (CLAUDE.md §8, rule 2). |
| `authorityOrder` | `string[]` | Ordered list, **highest authority first**. Decides which file *should* own a contested fact. |
| `tiebreak` | `"codeowners" \| "git-blame-recency" \| "none"` | When `authorityOrder` doesn't settle ownership, fall back to `.github/CODEOWNERS` or git-blame recency. The repo-native analog of a "social graph for authority". |
| `facts[].id` | `string` | Stable identifier for the fact. |
| `facts[].title` | `string` | Human label shown in reports. |
| `facts[].owner` | `"file.md#anchor"` | The one canonical owner — file plus optional heading anchor. |
| `facts[].rule` | `"owner-only"` | Enforcement rule: the markers may appear only in the owner. |
| `facts[].markers` | `string[]` | Distinctive text strings that must appear **only** in the owner. |
| `facts[].allow` | `string[]` | Files exempted from this fact — for **declared, intentional** duplication. |
| `facts[].note` | `string` | Human rationale for the ownership decision. |

---

## 🧭 The 4 modes

The agent picks a mode from the ask; no flags needed.

| Mode | When | What it does |
| :--- | :--- | :--- |
| **audit** | "I have no registry yet." | Scans the docs and proposes a starter `coherence.config.json` — candidate facts, suggested owners, draft markers. |
| **detect** | "Is anything drifting?" | Runs the deterministic gate (+ optional paraphrase pass) and reports conflicts, ranked by `authorityOrder`. |
| **resolve** | "Fix the drift." | Refactors non-owner restatements into links; picks the canonical owner via `authorityOrder` + `tiebreak`. |
| **enforce** | "Stop it coming back." | Wires or refreshes the CI workflow so drift can't reappear silently. |

---

## 🚦 CLI reference

> [!NOTE]
> **Every `npx` and `npm` command on this page is identical on macOS, Windows and Linux** — type them exactly as written. The only thing that changes between platforms is the path separator when you invoke the gate script directly, shown below.

```bash
# macOS and Linux
node scripts/check-doc-coherence.js [--config <path>] [--root <dir>] [--json] [--quiet]
```

```powershell
# Windows (PowerShell) — same command, only the path separator differs
node scripts\check-doc-coherence.js [--config <path>] [--root <dir>] [--json] [--quiet]
```

| Flag | Effect |
| :--- | :--- |
| `--config <path>` | Registry file to use. |
| `--root <dir>` | Repo root to scan. Default: current working directory. |
| `--json` | Emit machine-readable JSON (`{ ok, violations, configWarnings }`) instead of text. |
| `--quiet` | Print only on failure. |
| `-h, --help` | Show help. |

**Exit codes:** `0` clean · `1` drift found · `2` config / usage error.

**Config resolution order:** `--config` if given, else `./coherence.config.json`, else `./templates/coherence.config.json`.

---

## 🔁 CI integration

`enforce` mode wires a GitHub Actions workflow at `.github/workflows/doc-coherence.yml` that runs on pull requests touching `*.md` files. It invokes the CLI and lets the exit code decide the verdict — drift (exit `1`) fails the check and blocks the merge; a clean scan (exit `0`) passes.

```yaml
# .github/workflows/doc-coherence.yml (illustrative — authored by `enforce` mode)
on:
  pull_request:
    paths: ["**/*.md"]
jobs:
  doc-coherence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: node scripts/check-doc-coherence.js
```

Because the gate is pure substring matching — no model call, no network — the same command runs identically on a laptop and in CI. Run it locally before pushing to catch drift early.

---

## 🧳 Portability

The skill is fully config-driven with **no hardcoded paths** — every doc location, owner, and marker lives in `coherence.config.json`. To adopt it in any repo: drop a `coherence.config.json` at the root (start from `templates/coherence.config.json` or generate one with **audit** mode), install the skill, and optionally run **enforce** to wire CI. The `SKILL.md` and the CLI are identical everywhere; only the registry is repo-specific.

---

## ➡️ Next Steps

- [Context Engineering](./context-engineering.md) — how to keep the working set lean so docs stay the source of truth.
- [AI Governance & Observability](./governance.md) — where coherence enforcement fits the broader governance layer.
- [Main README](../README.md) — the cookbook overview and the canonical glossary this skill protects.

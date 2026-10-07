# Quickstart: Zero to AI-Native Feature in 5 Minutes

Welcome! This guide is designed to get you set up and running your first AI-implemented feature using **Spec-Kit** (planning) and **Superpowers** (execution) as quickly as possible. No prior AI engineering background is required.

---

## 🚀 3-Step Setup

### Step 1: Install `uv` (Fast Python Package Manager)

Spec-Kit requires `uv` to manage dependencies. Run the following command:

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

> [!NOTE]
> **Windows users:** After installing `uv`, close and reopen your terminal before continuing. To reload the PATH without restarting, run:
>
> ```powershell
> $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
> ```

### Step 2: Install Spec-Kit

Install the Spec-Kit CLI globally using `uv`:

```bash
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
```

Verify the installation:

```bash
specify --version
# Expected output: specify-cli x.y.z
```

### Step 3: Install Superpowers in your Agent

If you are using **Claude Code**, run this command inside the chat interface:

```
/plugin install superpowers@claude-plugins-official
```

> [!TIP]
> For other agents like Cursor or Gemini CLI, refer to the [Installation Guide](./docs/installation.md).

---

## 🛠 Your First Run (Greenfield Example)

Let's build a small CLI calculator project to see the workflow in action.

### 1. Initialize the Project

Create an empty folder and initialize Spec-Kit:

```bash
# macOS and Linux
mkdir cli-calculator
cd cli-calculator
specify init . --integration claude --script sh
```

```powershell
# Windows (PowerShell)
New-Item -ItemType Directory cli-calculator
Set-Location cli-calculator
specify init . --integration claude --script ps
```

> [!NOTE]
> Replace `claude` with your own agent's integration key, and see
> [why `--script` matters](./docs/installation.md#pick-the-helper-script-language-for-your-platform)
> if your team mixes macOS and Windows.

### 2. Set Up Your Constitution

Define the tech stack and guidelines that the agent must adhere to:

```
/speckit-constitution Create principles:
  - Tech stack: Node.js, Jest for unit testing
  - Constraint: Keep code structure minimal, standard ES modules
```

### 3. Specify the Feature

Describe what you want to build. Spec-Kit will write the specifications:

```
/speckit-specify Build a simple calculator that performs addition and subtraction.
```

*This creates the `.specify/specs/001-simple-calculator/spec.md` file and a new Git branch.*

### 4. Clarify & Plan

Let Spec-Kit ask questions and generate the step-by-step tasks:

```
/speckit-clarify
# Respond to questions, then plan and generate tasks:
/speckit-plan
/speckit-tasks
```

> [!NOTE]
> `/speckit-clarify` is an **optional quality gate**. For a feature this small you
> can skip straight to `/speckit-plan`. Use it when the spec has real ambiguity —
> which, on anything a team will maintain, is most of the time.

*This generates a `tasks.md` file, which is our formal checklist.*

### 5. Start Execution (The Handoff)

Copy and paste the following handoff message to your coding agent:

```text
Use the implementation plan in:
  .specify/specs/001-simple-calculator/tasks.md

Constraints:
  - Do not generate a new plan
    (Spec-Kit already generated the authoritative plan — regenerating wastes tokens and may contradict the approved spec)
  - Do not create a new git branch (already created by Spec-Kit)
    (Spec-Kit created and checked out the feature branch during /speckit-specify — creating another would orphan your work)
  - Write tests before implementation code (TDD)
    (The RED phase — a test that fails before the code exists — is proof that the test actually verifies something)
```

### ✅ What to Expect

Once the handoff message is sent, Superpowers will:

1. Create an isolated git worktree for this feature
2. Pick up Task 1 from `tasks.md`
3. Write a **failing test** (RED phase) — you'll see test output showing a failure
4. Write the minimum code to make the test pass (GREEN phase)
5. Clean up the code without breaking the test (REFACTOR phase)
6. Commit the task and move to Task 2

You don't need to do anything during this process. Monitor the output and step in only if the agent pauses and asks a clarifying question.

---

## ⚡ Command & Skill Cheatsheet

### Spec-Kit Skills (You Run These In Your Agent's Chat)

> [!IMPORTANT]
> These are **skills you type into your agent's chat**, not terminal commands — and
> the prefix differs by agent (`/speckit-` in most, `$speckit-` in Codex CLI). The
> full step list and the per-agent prefix table live in
> [Installation → How to invoke Spec-Kit in your agent](./docs/installation.md#-how-to-invoke-spec-kit-in-your-agent).

| Skill | Purpose | Output File |
| :--- | :--- | :--- |
| `/speckit-constitution` | Set project-wide rules & tech stack | `constitution.md` |
| `/speckit-specify <idea>` | Describe feature delta / requirements | `spec.md` |
| `/speckit-clarify` | Run interactive Q&A to resolve ambiguities *(optional gate)* | Appends to `spec.md` |
| `/speckit-plan` | Design technical approach & files | `plan.md` |
| `/speckit-tasks` | Convert plan into a checklist | `tasks.md` (Handoff) |
| `/speckit-converge` | Re-check the built code against the spec and list what is still missing | Appends to `tasks.md` |

### Superpowers Skills (Triggered Automatically)

| Skill | Activates When... | Responsibility |
| :--- | :--- | :--- |
| `using-git-worktrees` | Implementation starts on a feature | Creates an isolated development environment |
| `test-driven-development` | Each task starts | Enforces RED → GREEN → REFACTOR cycles |
| `requesting-code-review` | Task/Feature completes | Quality gate for spec and code reviews |

---

## ⚠️ Essential Rules of the Road

> [!IMPORTANT]
> **1. Intent First, Code Second**  
> If the agent is unsure about a design decision, it must stop and ask. It's much cheaper to clarify than to refactor generated code.
>
> **2. The Handoff is Sacred**  
> Never start implementing without pasting the handoff message. Otherwise, the agent will replan, creating duplicate files and git branches.
>
> **3. Enforce the TDD Loop**  
> Never skip the RED phase (the failing test). A test that doesn't fail before the code is implemented is not verifying the feature.

---

### 📖 Next Steps

- Learn more about the stack requirements: [Installation & Setup](./docs/installation.md)
- Walk through a complex project from scratch: [Greenfield Guide](./docs/greenfield.md)
- Add AI workflows to an existing app: [Brownfield Guide](./docs/brownfield.md)
- Learn about the governance layer: [AI Observability & Roles](./docs/governance.md)
- Hit a problem? Check the [Troubleshooting Guide](./docs/troubleshooting.md)
- Don't know a term? See the [Glossary](./GLOSSARY.md)

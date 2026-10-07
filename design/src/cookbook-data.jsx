/* global React */
// Data extracted from the AI Engineering Cookbook repo.
// Single source of truth for the explorer UI.

const COOKBOOK = {
  meta: {
    issue: "VOL. 01",
    title: "AI Engineering",
    titleItalic: "Cookbook",
    subtitle: "Practical patterns for building software autonomously with AI agents.",
    repo: "exponen-agi/ai-engineering-cookbook",
    edition: "Edition 2026.10",
  },

  principles: [
    {
      n: "01",
      title: "Intent First, Code Second",
      body: "Code that passes tests but misses design intent is a liability. Clarify intent before generating.",
      pull: "If the agent is unsure, it must stop and ask.",
    },
    {
      n: "02",
      title: "Verify, Don't Just Generate",
      body: "Value is measured by spec adherence, not lines produced. A smaller, correct implementation is always preferred.",
      pull: "Smaller + correct beats larger + incorrect.",
    },
    {
      n: "03",
      title: "Precision Over Productivity",
      body: "Architectural consistency protects the codebase. Adhere to project guidelines even if they require extra steps.",
      pull: "Constraints exist to protect the team.",
    },
    {
      n: "04",
      title: "Observability is Non-Negotiable",
      body: "Every coding session must record reflections to feed the continuous learning loop.",
      pull: "Unlogged execution is invisible.",
    },
    {
      n: "05",
      title: "Blameless Culture",
      body: "Production bugs and gate escapes are system failures. We update spec-rules, check-gates, or prompt-skills to prevent them.",
      pull: "The log is evidence, not accusation.",
    },
  ],

  // Spec-Kit phases — "What to build"
  specKit: [
    {
      cmd: "/speckit-constitution",
      label: "Constitution",
      tag: "RULES",
      output: ".specify/memory/constitution.md",
      role: "Planner",
      blurb: "Encode tech stack, constraints, protected paths, and coverage floors. Wins on every conflict.",
      example: `Create principles for an expense tracker:
  - Tech stack: Next.js 14, TypeScript, Prisma, SQLite
  - Testing: Vitest and React Testing Library
  - Minimum test coverage: 80%
  - Currency rule: store amounts as integers (cents), never floats.`,
    },
    {
      cmd: "/speckit-specify",
      label: "Specify",
      tag: "IDEA",
      output: "spec.md",
      role: "Planner",
      blurb: "Describe the user-facing feature. Focus on what, not how. Spec-Kit creates the feature branch.",
      example: `Build a simple expense tracker dashboard.
Users can add an expense with amount, category, date, description.
Users can view expenses sorted by date (newest first).
Users can filter by category. Show a running total.`,
    },
    {
      cmd: "/speckit-clarify",
      label: "Clarify",
      tag: "Q&A · OPTIONAL GATE",
      output: "spec.md (appended)",
      role: "Planner",
      blurb: "Interactive Q&A flushes ambiguity. Every acceptance criterion must be mechanically verifiable. An optional quality gate — skip it on a small, unambiguous change.",
      example: `Q: What are the pre-defined categories? Custom?
A: Pre-defined: Food, Rent, Transport, Entertainment, Utilities, Other.

Q: Should the database persist locally?
A: Yes, use a local SQLite database through Prisma.`,
    },
    {
      cmd: "/speckit-plan",
      label: "Plan",
      tag: "ARCHITECTURE",
      output: "plan.md",
      role: "Orchestrator",
      blurb: "Translate clarified intent into a concrete technical approach — schema, files, dependencies.",
      example: `Proposed Database Schema
  Expense: id (UUID), amount (Int cents), category, date, description

Proposed Files
  prisma/schema.prisma
  src/lib/db.ts
  src/components/ExpenseForm.tsx
  src/components/ExpenseList.tsx
  src/app/page.tsx`,
    },
    {
      cmd: "/speckit-tasks",
      label: "Tasks",
      tag: "CHECKLIST",
      output: "tasks.md  →  /speckit-implement",
      role: "Orchestrator",
      blurb: "Convert plan into a checkbox checklist. This file is the contract /speckit-implement executes.",
      example: `- [ ] Task 1: Setup Prisma schema + migrations
- [ ] Task 2: Implement db client helper + seed
- [ ] Task 3: Unit tests for expense CRUD helpers
- [ ] Task 4: Implement expense CRUD helpers
- [ ] Task 5: ExpenseForm component with validation
- [ ] Task 6: ExpenseList + CategoryFilter
- [ ] Task 7: Integrate page with state mgmt
- [ ] Task 8: Integration tests`,
    },
  ],

  // Execution phases — "How to build". Spec-Kit is the executor; Superpowers
  // skills are an optional discipline layer inside the implement step.
  execution: [
    {
      n: "06",
      label: "Implement",
      skill: "/speckit-implement",
      blurb: "Execute tasks.md in order, with the handoff constraints. The handoff is sacred — never replan, never re-branch. One executor per feature.",
    },
    {
      n: "07",
      label: "TDD Loop",
      skill: "RED → GREEN → REFACTOR",
      blurb: "Runs inside /speckit-implement for every task. Failing tests must fail for the right reason. Optional: the Superpowers test-driven-development skill makes this harder to skip.",
    },
    {
      n: "08",
      label: "Converge",
      skill: "/speckit-converge",
      blurb: "Re-reads the built code against spec, plan and tasks, then appends whatever is still outstanding. Repeat implement \u2192 converge until it reports Converged.",
    },
    {
      n: "09",
      label: "Review & Verify",
      skill: "two-stage review + gates",
      blurb: "Spec compliance first, then code quality; then the pre-merge gates — coverage floor, no secrets, log entries present, all tasks committed.",
    },
    {
      n: "10",
      label: "Finish",
      skill: "merge the branch",
      blurb: "Merge or open the PR. If a gate failed, the postmortem is the deliverable, not the diff.",
    },
  ],

  // Workflows
  workflows: {
    greenfield: {
      name: "Greenfield",
      tag: "From scratch",
      blurb: "New project, empty directory. Focus on stack definition, clean architecture, TDD from day one.",
      example: "Next.js Expense Tracker",
      steps: [
        "specify init . --integration claude",
        "/speckit-constitution",
        "/speckit-specify",
        "/speckit-clarify",
        "/speckit-plan",
        "/speckit-tasks",
        "→ Handoff: /speckit-implement",
        "TDD loop per task",
        "/speckit-converge (repeat until Converged)",
        "Code review & verify",
        "Finish branch",
      ],
      handoff: `/speckit-implement
Constraints:
  - Do not generate a new plan
  - Do not create a new git branch (already created by Spec-Kit)
  - Follow the tech stack defined in .specify/memory/constitution.md
  - Write tests before implementation code (TDD)
  - All tasks must pass the two-stage review`,
    },
    brownfield: {
      name: "Brownfield",
      tag: "Existing code",
      blurb: "Modifying a legacy codebase. Safety first — no regressions, backwards-compatible migrations, respect protected paths.",
      example: "Express.js JWT Auth",
      steps: [
        "Confirm green baseline (npm test)",
        "Brownfield Bootstrap extension (scan, bootstrap)",
        "BrownKit extension (risk assessment)",
        "/speckit-constitution",
        "/speckit-specify (as delta)",
        "/speckit-clarify",
        "/speckit-plan",
        "/speckit-tasks",
        "→ Handoff: /speckit-implement",
        "Verify baseline before edits",
        "TDD loop per task",
        "/speckit-converge (repeat until Converged)",
        "Ripple extension — coupling scan",
      ],
      handoff: `/speckit-implement
Constraints:
  - Do not generate a new plan
  - Do not create a new git branch (already created by Spec-Kit as 001-user-auth)
  - Verify that all existing tests pass BEFORE touching any files
  - Follow the tech stack and protected modules in constitution.md
  - Do not introduce new dependencies without explicit approval
  - All changes must be backward compatible`,
    },
    bugfix: {
      name: "Bug Fix",
      tag: "No Spec-Kit",
      blurb: "Targeted fix on an existing system. Skip the spec phase — root-cause first, TDD the regression.",
      example: "Single regression patch",
      steps: [
        "Find the root cause, not the symptom",
        "RED — write regression test",
        "Confirm test fails for the RIGHT reason",
        "GREEN — minimum fix",
        "REFACTOR — clean up, stay green",
        "Run the verification gates",
        "Code review",
        "Commit fix(scope): description",
      ],
      handoff: `// Bug fix path skips the Spec-Kit handoff.
// The test IS the spec.

1. Reproduce the bug locally.
2. Write a failing test that captures the regression.
3. Confirm it fails for the right reason.
4. Implement the minimum fix.
5. Refactor while staying green.
6. Run the full suite. Commit.`,
    },
  },

  // Multi-agent pod
  pod: [
    {
      role: "Planner",
      who: "Spec authoring & clarification",
      reads: ["Human intent", "constitution.md", "VERIFICATION_AND_EVAL_GUIDE"],
      writes: ["spec.md", "Clarification Q&A"],
      tools: ["/speckit-specify", "/speckit-clarify", "/speckit-analyze"],
      tone: "deliberate",
    },
    {
      role: "Orchestrator",
      who: "Workflow routing & handoff",
      reads: ["AGENT_PROFILE_ROLES", "tasks.md", "constitution.md"],
      writes: ["Handoff constraints", "Escalations"],
      tools: ["/speckit-tasks", "/speckit-implement"],
      tone: "neutral",
    },
    {
      role: "Coder",
      who: "TDD implementation (RED→GREEN→REFACTOR)",
      reads: ["tasks.md", "spec.md", "constitution.md"],
      writes: ["Source + tests", "Commits per task", "Reflection log entry"],
      tools: ["/speckit-implement", "test-driven-development (optional)"],
      tone: "active",
    },
    {
      role: "Reviewer",
      who: "Spec compliance + code quality",
      reads: ["spec.md", "Git diff", "Reflection log"],
      writes: ["APPROVED / BLOCKED", "Inline minor fixes"],
      tools: ["/speckit-converge", "requesting-code-review (optional)"],
      tone: "skeptical",
    },
    {
      role: "Verifier",
      who: "Automated pre-merge safety checks",
      reads: ["VERIFICATION_AND_EVAL_GUIDE", "Test suite output", "tasks.md"],
      writes: ["Gate report", "Postmortem on failure"],
      tools: ["VERIFICATION_AND_EVAL_GUIDE gates", "finishing-a-development-branch (optional)"],
      tone: "strict",
    },
  ],

  // Verification gates
  gates: [
    {
      n: "01",
      title: "Automated Checks",
      when: "Every commit",
      checks: [
        ["Linting", "Zero errors", "Block commit"],
        ["Type checking", "Zero type errors", "Block commit"],
        ["Unit tests", "All pass", "Block commit"],
        ["Coverage", "≥ floor in constitution.md", "Block commit"],
        ["Secret scanning", "Zero secrets", "Block + alert"],
      ],
    },
    {
      n: "02",
      title: "Spec Compliance",
      when: "After each task",
      checks: [
        ["Point to satisfying code", "Per acceptance criterion", "Return to GREEN"],
        ["Failing-test-without-impl exists", "Per criterion", "Write the test"],
        ["No gold-plating", "Behaviour ⊆ spec", "Remove the extra"],
        ["No phantom completions", "Checkbox ↔ commit", "Uncheck the box"],
      ],
    },
    {
      n: "03",
      title: "Human Review Triggers",
      when: "Before merge",
      checks: [
        ["Protected path modified", "Per constitution", "Pause for approval"],
        ["New external dependency", "Supply chain risk", "Cite dep policy"],
        ["Coverage dropped", "Below floor", "Block until restored"],
        ["Spec intent ambiguity", "Agent uncertainty", "Surface, don't resolve"],
      ],
    },
    {
      n: "04",
      title: "Final Pre-Merge",
      when: "Once, after all tasks",
      checks: [
        ["All tasks.md items committed", "Boxed AND in git", "Block merge"],
        ["Full test suite green", "Not just changed-file", "Block merge"],
        ["Reflection log entry present", ".ai/traces/", "Block merge"],
        ["No secrets staged", "Final sweep", "Block + alert"],
      ],
    },
  ],

  // 20 curated extensions
  extensions: [
    { name: "MemoryLint", fit: "Both", phase: "Pre-Spec", note: "After modifying constitution.md", skip: "Greenfield day 0" },
    { name: "Brownfield Bootstrap", fit: "BF", phase: "Pre-Spec", note: "Before /speckit-constitution", skip: "Codebase is small" },
    { name: "BrownKit", fit: "BF", phase: "Pre-Spec", note: "After Bootstrap, before constitution", skip: "Low-risk internal tool" },
    { name: "Project Health Check", fit: "Both", phase: "Pre-Spec", note: "Start of brownfield feature", skip: "Brand new greenfield" },

    { name: "Memory Loader", fit: "Both", phase: "Spec", note: "Before any /speckit-* command", skip: "Auto-loading configured" },
    { name: "Red Team", fit: "Both", phase: "Spec", note: "After clarify, before plan", skip: "Cosmetic refactors" },
    { name: "Spec Critique", fit: "Both", phase: "Spec", note: "After clarify, before plan", skip: "Time-boxed spikes" },

    { name: "OWASP LLM Threat Model", fit: "Both", phase: "Plan", note: "After /speckit-plan", skip: "App doesn't touch LLMs" },
    { name: "Spec Scope", fit: "Both", phase: "Plan", note: "After plan, before tasks", skip: "Rapid prototypes" },
    { name: "Architect Impact Previewer", fit: "Both", phase: "Plan", note: "After /speckit-tasks", skip: "No cross-cutting concerns" },
    { name: "Version Guard", fit: "Both", phase: "Plan", note: "After /speckit-plan", skip: "Non-JS/TS stacks" },

    { name: "SpecTest", fit: "Both", phase: "Impl", note: "Before the RED phase", skip: "Simple tasks" },
    { name: "Checkpoint", fit: "Both", phase: "Impl", note: "After each TDD cycle", skip: "Tiny tasks" },
    { name: "Iterate", fit: "Both", phase: "Impl", note: "When requirements change mid-coding", skip: "Specs are stable" },

    { name: "Verify", fit: "Both", phase: "Post", note: "After final task, before review", skip: "Non-production prototypes" },
    { name: "Verify Tasks", fit: "Both", phase: "Post", note: "Before finishing-branch", skip: "Short checklist" },
    { name: "Cleanup", fit: "Both", phase: "Post", note: "After each task refactor", skip: "< 20 LOC tasks" },
    { name: "Ripple", fit: "Both", phase: "Post", note: "After all tasks complete", skip: "Greenfield with no deps" },
    { name: "Security Review", fit: "Both", phase: "Post", note: "Before finishing branch", skip: "Internal prototypes" },
    { name: "Reconcile", fit: "Both", phase: "Post", note: "Branches open > 1 week", skip: "Short-lived branches" },
  ],

  // The 2026 agent interop stack — see docs/agent-standards.md
  stack2026: [
    {
      layer: "AGENTS.md",
      scope: "Project",
      load: "Always loaded",
      what: "One file at the repo root telling every coding agent how this project works — build commands, test commands, house rules.",
      why: "Read natively by Claude Code, Codex, Cursor, Copilot, Gemini CLI and more. Write the rules once instead of once per tool.",
      home: "Agentic AI Foundation (Linux Foundation)",
    },
    {
      layer: "SKILL.md",
      scope: "Capability",
      load: "Loaded on demand",
      what: "A folder holding one reusable capability: a Markdown file with name + description frontmatter, plus optional scripts and reference files.",
      why: "Progressive disclosure keeps context cheap — only the name and description stay resident until a task actually needs the skill.",
      home: "agentskills.io (open specification)",
    },
    {
      layer: "MCP",
      scope: "Tools & data",
      load: "Called at runtime",
      what: "A protocol for exposing tools, data and prompts to an agent over HTTP, so any client can call any server.",
      why: "The 2026-07-28 revision dropped the session handshake. Servers are now ordinary stateless HTTP workloads — any request can hit any instance.",
      home: "Agentic AI Foundation (Linux Foundation)",
    },
    {
      layer: "Evals",
      scope: "Output quality",
      load: "Run in CI + on production traffic",
      what: "A fixed set of inputs with known-good outputs, scored automatically so you can tell whether a prompt or model change made things better or worse.",
      why: "Tracing tells you what the agent did. Only an eval tells you whether it did it well. Most teams have the first and not the second.",
      home: "promptfoo · DeepEval · Langfuse",
    },
    {
      layer: "OTel GenAI",
      scope: "Observability",
      load: "Emitted every run",
      what: "OpenTelemetry semantic conventions (the gen_ai.* attributes) for recording model calls, token counts and tool invocations as normal traces.",
      why: "Puts agent traces in the same backend as the rest of your system. Still marked Development status, and split into its own repo in June 2026 — expect attribute churn.",
      home: "OpenTelemetry (CNCF)",
    },
    {
      layer: "Agent Security",
      scope: "Blast radius",
      load: "Decided before you connect anything",
      what: "The rules limiting what an agent can reach: tool allowlists, least-privilege credentials, sandboxed execution, and a human check before anything irreversible.",
      why: "Prompt injection is OWASP's number one LLM risk and cannot be prompted away. Every working defence limits what the agent can do, not what it can be told.",
      home: "OWASP LLM Top 10 · OWASP Agentic Skills Top 10",
    },
  ],

  decisionMatrix: [
    ["Starting a new brownfield project", ["Brownfield Bootstrap", "BrownKit", "MemoryLint"]],
    ["Building an LLM/RAG application", ["OWASP LLM Threat Model", "Security Review"]],
    ["Requirements changed mid-coding", ["Iterate"]],
    ["Complex legacy database", ["Ripple", "Architect Impact Previewer"]],
    ["Worried subagent skipped tasks", ["Verify Tasks"]],
    ["Long-running branch with conflicts", ["Reconcile"]],
  ],

  flywheel: [
    { step: "Execution", file: "Agent writes code", color: "ink" },
    { step: "Observability", file: ".ai/traces/AGENT_LOG_REFLECTIONS.md", color: "blue" },
    { step: "Verification", file: ".ai/config/VERIFICATION_AND_EVAL_GUIDE.md", color: "green" },
    { step: "Learning", file: "postmortems/POSTMORTEM_AND_LEARNING_LOG.md", color: "gold" },
    { step: "Refinement", file: "constitution.md  /  prompt-skills", color: "red" },
  ],

  // Sample postmortem (truncated, from repo)
  postmortem: {
    date: "2026-05-23",
    slug: "auth-token-rotation-spec-ambiguity",
    severity: "MEDIUM",
    affected: "001-user-auth · Task 3 · JWT refresh token rotation",
    what: "Coder implemented immediate-invalidation rotation. Spec said 'rotate on every authenticated request' without defining 'rotate.' Concurrent mobile requests with the same token were rejected in QA; partial revert + re-implement with a 30-second overlap window.",
    cause: "Spec used domain jargon ('rotate') without precise definition. constitution.md security section said 'no long-lived tokens' without a millisecond definition. Agent surfaced ambiguity in the reflection log but made a default choice after 8 minutes of no resolution.",
    fix: "Added 30-second grace period for token overlap. Updated auth integration tests with a concurrent-request scenario.",
    guardrail: "VERIFICATION_AND_EVAL_GUIDE Gate 2: added 'For auth-related tasks, include a concurrent-request test scenario before marking COMPLETE.'",
  },

  handoffRules: [
    { rule: "Do not replan", reason: "tasks.md is authoritative" },
    { rule: "Do not create a new branch", reason: "Spec-Kit already made it" },
    { rule: "Verify baseline green first", reason: "Brownfield only — protect existing tests" },
    { rule: "TDD loop is mandatory", reason: "RED → GREEN → REFACTOR, no skipping" },
    { rule: "Constitution overrides tasks on conflict", reason: "Surface, don't resolve silently" },
  ],
};

window.COOKBOOK = COOKBOOK;

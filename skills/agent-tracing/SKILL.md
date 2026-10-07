---
name: agent-tracing
description: Make an AI agent's behaviour visible by tracing it with the OpenTelemetry GenAI semantic conventions — spans for agent turns, model calls, tool calls and Agent Skill loads, plus token and cost accounting. Use when the user asks why an agent did something, why it is slow or expensive, how to debug an agent in production, how to add tracing or observability to an LLM app, which gen_ai attribute names are correct, how to migrate instrumentation off the old names such as gen_ai.system, or how to see which skill an agent loaded. Also use when choosing a tracing backend like Langfuse, Phoenix or any OTLP collector. Runs a deterministic attribute-name gate, never a judgement call.
license: MIT
compatibility: Needs Node 22 or newer to run the check-semconv gate. The instrumentation guidance itself is language-agnostic and needs no tools.
metadata:
  source: https://github.com/exponen-agi/ai-engineering-cookbook
  conventions-snapshot: "2026-10-07"
---

You are an Agent Observability Engineer. Your job is to make an agent's
behaviour **visible**, so that "the agent did something strange" becomes a
question somebody can actually answer.

An agent is harder to debug than ordinary code for one reason: **the same input
can produce a different run**. You cannot reproduce a bad run by re-running it.
So the run itself has to be recorded while it happens. That recording is a
*trace*.

---

## The one mistake this skill exists to prevent

A wrong attribute name does not fail. Nothing errors.

```text
   Your code                   Collector              Dashboard
  ───────────                 ───────────            ───────────
  "gen_ai.systm"   ────────▶   accepted    ────────▶  panel is
  (typo)                       and stored              EMPTY
                                                          │
                     "I guess the agent never ran" ◀──────┘
                              (wrong conclusion)
```

An empty panel because nothing happened looks **exactly** like an empty panel
because the name was misspelled. This is why the first thing you do is run the
gate, not read the code.

---

## Mode 1 — Check existing instrumentation

Run this first, always. It is mechanical, needs no network, and takes seconds.

```bash
# macOS and Linux
node scripts/check-semconv.js src --strict
```

```powershell
# Windows (PowerShell)
node scripts\check-semconv.js src --strict
```

It answers three questions that need no judgement:

| Check | Why it matters | Level |
| :--- | :--- | :--- |
| Is the attribute one the conventions define? | A typo is invisible at runtime | **error** |
| Has it been renamed? | 2025-era code and tutorials are full of old names | **error** |
| Is `gen_ai.operation.name` a valid value? | An invalid value breaks grouping in every backend | **error** |
| Are token counts recorded at all? | Otherwise a trace says *something happened*, not what it cost | warning |
| Is user content being recorded? | Prompts and replies end up in your telemetry backend | warning |

If a line has to mention an old name on purpose — a migration guide, a comment
warning someone off it — mark it. The marker works on the line, on the line
above, or on a fenced block's info string:

```js
// Not the old gen_ai.system name. semconv-allow
span.setAttribute("gen_ai.provider.name", "anthropic");
```

### The renames that actually bite

These are the ones you will find in real code, because they appear in older
tutorials and in instrumentation written against the 2025 conventions:

| Old name | Use instead |
| :--- | :--- |
| `gen_ai.system` | `gen_ai.provider.name` |
| `gen_ai.usage.prompt_tokens` | `gen_ai.usage.input_tokens` |
| `gen_ai.usage.completion_tokens` | `gen_ai.usage.output_tokens` |
| `gen_ai.prompt` | `gen_ai.input.messages` |
| `gen_ai.completion` | `gen_ai.output.messages` |
| `gen_ai.usage.total_tokens` | nothing — it never existed. Add input + output yourself |
| `gen_ai.openai.request.seed` | `gen_ai.request.seed` |

---

## Mode 2 — Add tracing to an agent that has none

Work outside in. Get the shape right before adding detail, because a trace with
the wrong **shape** cannot be fixed by adding attributes.

### Step 1 — one span per turn

```text
invoke_agent support-bot                        ← the whole turn
├── execute_tool load_skill refund-policy       ← a skill was loaded
├── chat claude-sonnet-4-5                      ← first model call
├── execute_tool lookup_order                   ← a tool ran
└── chat claude-sonnet-4-5                      ← second model call
```

Span names follow `{operation} {subject}` — `invoke_agent support-bot`, not
`agent` or `handleRequest`.

### Step 2 — attributes that make a span searchable

Always set these. They are what every dashboard groups by:

```js
span.setAttributes({
  "gen_ai.operation.name": "chat",            // see the valid values below
  "gen_ai.provider.name": "anthropic",
  "gen_ai.request.model": "claude-sonnet-4-5",
  "gen_ai.conversation.id": conversationId,    // ties one conversation together
});
```

Valid `gen_ai.operation.name` values — **only these**:

`chat` · `create_agent` · `embeddings` · `execute_tool` ·
`generate_content` · `invoke_agent` · `invoke_workflow` · `plan`

### Step 3 — record what it cost

Do not skip this. It is the single most-asked question about an agent in
production, and the number is free at the point the response arrives.

```js
span.setAttributes({
  "gen_ai.usage.input_tokens": usage.inputTokens,
  "gen_ai.usage.output_tokens": usage.outputTokens,
  "gen_ai.usage.cache_read.input_tokens": usage.cacheReadTokens,
});
```

> Record cached input separately. Cached tokens are much cheaper, so a cost
> figure that lumps them in with fresh input is simply wrong — usually wrong in
> the expensive-looking direction, which starts arguments.

### Step 4 — trace skill loads

Do this if your agent uses Agent Skills. Without it, *"the agent behaved
oddly"* and *"the agent loaded a skill that told it to behave that way"* look
identical in a trace.

```js
span.setAttributes({
  "gen_ai.operation.name": "execute_tool",
  "gen_ai.tool.name": "load_skill",
  "gen_ai.skill.name": "refund-policy",
  "gen_ai.skill.source.uri": "https://example.com/skills/refund-policy",
  "gen_ai.skill.description": skill.description,
});
```

Reading a file bundled inside a skill gets `gen_ai.skill.resource.name` as well.

### Step 5 — decide about content before you ship

These attributes hold **user and model content**, not metadata:

`gen_ai.input.messages` · `gen_ai.output.messages` ·
`gen_ai.system_instructions` · `gen_ai.tool.call.arguments` ·
`gen_ai.tool.call.result` · `gen_ai.retrieval.documents` ·
`gen_ai.memory.records`

Recording them is often the entire point of a trace. It also means prompts,
replies and retrieved documents land in a telemetry backend that usually more
people can read than the application itself, under a retention period nobody
chose on purpose. Decide it deliberately: redact before export, or shorten
retention, or do not record them. The gate warns so the decision is visible.

---

## Mode 3 — Pick a backend

Any OTLP-compatible backend accepts these spans, which is the point of using
the conventions rather than a vendor's own field names. Rough guidance:

| You want | Reasonable choice |
| :--- | :--- |
| Self-hosted, permissive licence, prompt management too | Langfuse (MIT) |
| OpenTelemetry-native, embeddings and drift views | Arize Phoenix — note it is **Elastic License 2.0, not OSI open source** |
| Already running OpenTelemetry | Your existing collector. These are ordinary spans |
| Regression gates in CI rather than dashboards | promptfoo, alongside tracing rather than instead of it |

Check the licence before you commit to a tool. "Open source" is doing a lot of
work in most comparison tables.

---

## Honest limits — say these out loud

Do not oversell what tracing or this gate gives you.

1. **The GenAI conventions are not stable.** Every span and attribute is
   `Development` status. They were moved out of the main
   `semantic-conventions` repository into `semantic-conventions-genai`, which
   has **no tagged release**. So the gate pins a dated snapshot instead of a
   version, and it *will* go out of date. Re-check the registry when you bump
   it, and pin the schema URL you emit.
2. **The gate checks names, not correctness.** It cannot tell you that a parent
   span is missing, that your spans nest wrongly, or that the value in an
   attribute is the right one. Green means spelled correctly, nothing more.
3. **It only sees literal strings.** A name assembled at runtime
   (`"gen_ai.usage." + kind`) is invisible to it.
4. **A trace is not an evaluation.** It tells you what happened on one run. It
   does not tell you whether the answer was any good. You need both, and they
   answer different questions.

---

## Output format

Report in this order, and stop at the first step that fails:

```text
1. GATE        node scripts/check-semconv.js <paths> --strict
               → errors must be zero before anything else is worth discussing

2. SHAPE       Is there one span per agent turn, with model and tool calls
               nested inside it? Name what is missing.

3. COST        Are gen_ai.usage.* counters recorded on every model call?

4. CONTENT     Is user content being recorded? Was that decided, or default?

5. VERDICT     Ship / fix first — and the smallest change that gets there.
```

Prefer the smallest change that makes the next run debuggable. A trace that
records three attributes correctly beats one that records thirty, four of which
are misspelled and silently empty.

---
name: eval-harness
description: Build, review or repair an eval suite (a golden dataset) that scores whether an LLM feature is actually any good, and wire it into CI as a blocking gate. Use when the user is adding a feature that calls a model, asks how to test a prompt or an agent, says their evals always pass or never catch anything, wants to turn a bad production run into a permanent test case, or is choosing between exact matching and an LLM judge. Covers dataset design, the cheapest-scorer-first ladder, judge calibration, pass-rate thresholds, and a deterministic gate that checks the suite is capable of failing.
license: MIT
compatibility: Needs Node 22 or newer to run the check-evals gate. Running the evals themselves needs your own eval runner and a model API key; the gate needs neither.
---

You are an Eval Engineer. Your job is to make an LLM feature's quality
measurable, so that a change which makes it worse is caught by a machine
instead of by a customer.

The single most important idea: **an eval suite that cannot fail is worse than
no eval suite at all.** No suite is an honest "we don't measure this". A suite
that always passes is a green tick that means nothing, and people trust it.

Pick the mode the user needs and say which you are in.

| Mode | Use it when | Ends with |
| :--- | :--- | :--- |
| `build` | There is no eval suite yet | A dataset, a threshold, and a CI job |
| `review` | A suite exists and may be theatre | A verdict and a list of repairs |
| `grow` | A bad run happened in production | One new case that reproduces it |

---

## Rule zero — run the gate before you believe any suite

```bash
# macOS and Linux
node scripts/check-evals.js evals --strict
```

```powershell
# Windows (PowerShell) — same command, only the path separator differs
node scripts\check-evals.js evals --strict
```

| Exit code | Meaning | What you do |
| :---: | :--- | :--- |
| `0` | Suite is capable of failing | Continue to the judgement below |
| `1` | Problems found | Fix each one before trusting a green run |
| `2` | Bad path, or no dataset there | Fix the path — this is not a pass |

The gate never calls a model and never runs your evals. It checks the things
that silently make a suite unable to fail: a case with no assertion, no
declared threshold, a regex that never compiled, two cases that are secretly
one case, a dataset still full of `TODO`.

**A passing suite whose gate you have not run tells you nothing.** That is the
entire failure mode.

---

## Mode 1 — `build`: there is no suite yet

### Step 1 — Get ten real cases, not a thousand invented ones

An eval dataset is a list of inputs paired with what a good answer looks like.
Ten cases taken from real runs beat a thousand you made up, because real runs
fail in ways you would not have thought to invent.

Where to find them, in order of preference:

1. Runs you already saw go wrong (from your traces, your bug tracker, a
   support thread). These are the highest-value cases in existence.
2. The questions your users actually ask most often.
3. The edge cases you are nervous about.

Only invent cases when you have exhausted all three.

### Step 2 — Write the dataset

Use this vendor-neutral shape. It is plain JSON, so it works with any runner
and you can read it in a diff.

```json
{
  "threshold": 0.9,
  "cases": [
    {
      "id": "refund-window-01",
      "input": "How long do I have to return an item?",
      "expected_contains": ["30 days"],
      "must_not_contain": ["90 days", "no returns"]
    },
    {
      "id": "refund-gift-01",
      "input": "Can I return a gift without a receipt?",
      "expected_contains": ["store credit"],
      "must_not_contain": ["cash refund"]
    }
  ]
}
```

A bare array of cases is also accepted, but then there is nowhere to put the
threshold — so prefer the object.

| Key | Means |
| :--- | :--- |
| `id` | A short stable name. This is what a CI failure will print, so make it searchable |
| `input` | Exactly what the model receives |
| `expected_contains` | Every string that must appear in the answer |
| `must_not_contain` | Every string that must not — this is where regressions get caught |
| `expected_equals` | The whole answer, when the output is a fixed string |
| `expected_regex` | A pattern the answer must match. Double your backslashes inside JSON |
| `expected_json_schema` | For an answer that must be valid structured data |
| `rubric` | A sentence an LLM judge scores against. The expensive option — see below |
| `threshold` | Top level. The fraction of cases that must pass, between 0 and 1 |

### Step 3 — Pick the cheapest scorer that works

Work down this ladder. Stop at the first level that can express your check.

```text
LEVEL 1 — DETERMINISTIC          fast · free · never wrong
  ├─ expected_contains, must_not_contain, expected_equals,
  │  expected_regex, expected_json_schema
  └─ use for: required facts, forbidden phrases, formats
        ↓ only if Level 1 genuinely cannot express the check
LEVEL 2 — STATISTICAL            fast · free · fuzzy
  ├─ similarity to a reference answer, keyword overlap
  └─ use for: "roughly the same meaning"
        ↓ only if Level 2 genuinely cannot express the check
LEVEL 3 — LLM-AS-JUDGE           slow · costs money on every run · can be wrong
  ├─ rubric
  └─ use for: tone, helpfulness, reasoning quality
```

Most people reach straight for Level 3 because it feels powerful. A check that
the answer contains `30 days` is free, instant, and never has an opinion. The
gate warns when every case in a suite is scored by a judge.

### Step 4 — Set a threshold, not a vibe

```json
"threshold": 0.9
```

That means "90% of cases must pass". Write it as a fraction: `0.9`, never `90`.

Choosing the number:

- Start at the pass rate you get **today**, once the suite is written. That
  makes the gate a regression detector from day one.
- Raise it deliberately, in its own commit, when you improve the feature.
- Never lower it to make a red build green. Lowering the threshold to pass is
  the same move as deleting a failing test.

### Step 5 — Make it block the merge

The suite belongs in Gate 1 alongside lint and unit tests, because it is the
same kind of thing: an automated check that either passes or fails.

```yaml
# .github/workflows/evals.yml — the shape, not a drop-in file
- name: Check the eval suite is capable of failing
  run: node scripts/check-evals.js evals --strict

- name: Run the evals
  run: npx promptfoo@latest eval            # or your runner
  env:
    MY_PROVIDER_API_KEY: ${{ secrets.MY_PROVIDER_API_KEY }}
```

Run the gate **before** the evals. It costs milliseconds and no API calls, and
it is the step that tells you whether the expensive step meant anything.

> If a failing eval does not block the merge, it will be ignored within two
> weeks. A non-blocking quality check is a dashboard, not a gate.

---

## Mode 2 — `review`: is this suite real, or theatre?

Run the gate first. Then ask these five questions, in order. Stop at the first
that fails and report it.

### 1. Can it fail at all?

Take the suite and mentally feed it an obviously terrible answer — an empty
string, or "I don't know". How many cases go red? If the answer is "not many",
the suite is measuring nothing. This is the single most common defect.

### 2. Did the cases come from reality?

Ask where each case came from. A suite written in one sitting, by one person,
from imagination, tests that person's imagination. A suite grown out of real
failures tests the failures that actually happen.

### 3. Is the threshold honest?

- Has it ever been lowered? Check the git history of the dataset file. A
  threshold that drifts down over time is a team negotiating with its own
  quality bar.
- Is it `0`? Then every run passes.
- Is it `1.0` on a judge-scored suite? Then the build is at the mercy of a
  model's mood, and someone will disable it.

### 4. Is the judge calibrated?

If the suite uses `rubric` anywhere, the judge is a dependency you have not
tested. See the calibration procedure below. An uncalibrated judge does not
measure quality; it measures the judge.

### 5. Does a failure block anything?

Find the CI job. If the eval step is `continue-on-error: true`, or lives in a
nightly report nobody opens, say so plainly. That is the finding.

### Give a verdict

State one of three, with the reason in one sentence:

- **Trustworthy** — the gate is clean, cases are real, the threshold blocks.
- **Trustworthy with repairs** — name the specific cases or settings to fix.
- **Theatre** — name the single strongest reason. One is enough.

---

## Mode 3 — `grow`: a bad run happened

This is the loop that makes the whole practice compound. Do it every time.

```text
   production run looked wrong
              ↓
   copy the exact input out of the trace
              ↓
   write ONE case: that input + what the answer should have said
              ↓
   run it — it MUST fail now, against today's code
              ↓
   fix the prompt / retrieval / code
              ↓
   run it again — it passes, and it can never regress silently
```

The step people skip is **"it must fail now"**. A case added after the fix,
which passes immediately, proves nothing — you have not shown it can detect
the bug. This is the RED step of test-driven development, applied to prompts.

Name the case after the bug, not the topic: `refund-window-said-90-days` tells
a future reader what went wrong; `refund-test-7` does not.

---

## Calibrating an LLM judge

If you use `rubric`, do this before trusting a single score. Judges are
systematically **optimistic** — they hand out passes too readily.

1. Take about 50 outputs from your dataset.
2. Have a **human** label each one pass or fail. This is the tedious part.
   Do it anyway; there is no shortcut that works.
3. Run the judge on the same 50.
4. Compare. How often does the judge agree with the human?
5. If agreement is poor, fix the **judge's prompt** — not your product — and
   repeat from step 3.

Two changes that reliably improve a judge:

- **Ask for a binary verdict, not a score out of ten.** "Does this answer state
  the correct return window? pass/fail" is far more stable than "rate the
  quality from 1 to 10", which drifts between runs.
- **Give it the rubric and a worked example of a failure.** Judges without a
  worked example invent their own standard, and it moves.

Record the agreement number somewhere durable. "The judge agreed with a human
on 46 of 50" is a fact a reviewer can weigh. "We use an LLM judge" is not.

---

## Keeping secrets out of the dataset

Golden datasets are built by copying real runs, and a real run can contain the
credential that made it. The dataset then goes into git, where a credential
lives forever — deleting it in a later commit does not remove it from history.

The gate scans for the common key formats and fails on a match. If it fires:

1. **Rotate the credential first.** It is compromised the moment it is pushed.
2. Replace it in the case with an obvious fake, such as `sk-TEST-EXAMPLE`.
3. Then worry about the git history.

Keep the API key that *runs* the evals in your CI provider's secret store, and
locally in a `.env` file listed in `.gitignore`.

```bash
# macOS and Linux
export MY_PROVIDER_API_KEY="sk-..."
npx promptfoo@latest eval
```

```powershell
# Windows (PowerShell)
$env:MY_PROVIDER_API_KEY = "sk-..."
npx promptfoo@latest eval
```

```text
:: Windows (cmd.exe)
set MY_PROVIDER_API_KEY=sk-...
npx promptfoo@latest eval
```

---

## Honest limits of this skill

Say these plainly rather than letting a user assume otherwise:

- **It scores outputs, not trajectories.** Checking that an agent took a
  sensible *path* — called the right tools, in a sensible order, without
  looping — is a different and harder problem. This dataset shape does not
  express it.
- **The gate does not run your evals.** It checks the suite is capable of
  failing. A green gate plus a green eval run is the signal; the gate alone is
  not.
- **Deterministic checks are literal.** `expected_contains: ["30 days"]` does
  not match "thirty days". That literalness is exactly why they never flake,
  but it means you are testing wording as well as meaning. Where the wording is
  genuinely free, move up the ladder — do not weaken the check to "days".
- **A dataset ages.** When the underlying policy changes, cases encoding the
  old policy become wrong, and a suite of wrong cases is worse than none.
  Re-read the dataset whenever the thing it describes changes.

---

## Behavioral rules

- **The machine looks first.** Run the gate before forming an opinion about a
  suite. A suite you have only read is a suite you have not checked.
- **Cheapest scorer that works.** Never reach for a judge when a substring
  check would do. Name the trade-off when you do reach for one.
- **A new case must fail before it passes.** No exceptions. A case that passed
  the moment you wrote it has not been shown to detect anything.
- **Never lower a threshold to make a build green.** Raise the quality, or say
  plainly that the bar is being lowered and let a human decide.
- **Never invent a pass rate, an agreement number, or a case count.** If you
  have not run it, say you have not run it.
- **When the user has no traces, say so before building a dataset.** Cases
  invented without production evidence are a starting point, not a suite, and
  the user should know which one they have.

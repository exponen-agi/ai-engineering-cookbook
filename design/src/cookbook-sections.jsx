/* global React, COOKBOOK */
const { useState, useEffect, useMemo, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────
// Shared primitives
// ─────────────────────────────────────────────────────────────────────────

const ckStyles = {
  section: {
    padding: "72px 0",
    borderTop: "1px solid var(--rule)",
  },
  sectionDense: {
    padding: "48px 0",
    borderTop: "1px solid var(--rule)",
  },
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--rule)",
    borderRadius: 0,
  },
};

function Eyebrow({ children, color }) {
  return (
    <div className="eyebrow" style={{ color: color || "var(--muted)", marginBottom: 10 }}>
      {children}
    </div>
  );
}

function SectionHeader({ no, kicker, title, lede }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 32, marginBottom: 48, alignItems: "baseline" }}>
      <div>
        <div className="mono" style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>§ {no}</div>
        <div className="eyebrow" style={{ marginTop: 8 }}>{kicker}</div>
      </div>
      <div>
        <h2 className="display" style={{ fontSize: "clamp(40px, 5vw, 72px)", margin: 0, maxWidth: 900, color: "var(--ink)" }}>
          {title}
        </h2>
        {lede && (
          <p style={{ marginTop: 16, marginBottom: 0, fontSize: 18, lineHeight: 1.5, color: "var(--ink-2)", maxWidth: 720 }}>
            {lede}
          </p>
        )}
      </div>
    </div>
  );
}

function Pill({ children, color = "var(--ink)", bg = "transparent", border = "var(--rule)" }) {
  return (
    <span
      className="mono"
      style={{
        display: "inline-block",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "4px 8px",
        border: `1px solid ${border}`,
        color,
        background: bg,
        lineHeight: 1.4,
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// MASTHEAD
// ─────────────────────────────────────────────────────────────────────────

function Masthead({ meta }) {
  return (
    <header style={{ paddingBottom: 32, borderBottom: "1px solid var(--ink)" }}>
      {/* Top metadata bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 24, borderBottom: "1px solid var(--rule)" }}>
        <div className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>
          {meta.issue} · {meta.edition}
        </div>
        <div className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>
          github.com/{meta.repo}
        </div>
      </div>

      {/* Title block */}
      <div style={{ paddingTop: 28, paddingBottom: 48, display: "grid", gridTemplateColumns: "1fr auto", gap: 32, alignItems: "end" }}>
        <h1 className="display" style={{ fontSize: "clamp(72px, 11vw, 168px)", margin: 0, lineHeight: 0.94, color: "var(--ink)" }}>
          {meta.title}<br />
          <span className="display-italic" style={{ color: "var(--accent)" }}>{meta.titleItalic}</span>
        </h1>
        <div style={{ textAlign: "right", paddingBottom: 18 }}>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--muted)" }}>
            An interactive workflow explorer
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            Spec-Kit · AI-Native SDLC
          </div>
        </div>
      </div>

      {/* Lede */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, paddingTop: 28, borderTop: "1px solid var(--rule)", marginTop: 0 }}>
        <p className="display-italic" style={{ fontSize: 28, lineHeight: 1.25, margin: 0, color: "var(--ink)", maxWidth: 540 }}>
          {meta.subtitle}
        </p>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>The thesis</div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>
            In well-structured agentic pipelines, AI agents generate <strong style={{ color: "var(--accent)" }}>~75% of the implementation code</strong>. That changes the human role from <em className="display-italic">code author</em> to <em className="display-italic">intent definer, outcomes verifier, and system governor</em>.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>
            This cookbook is a working pipeline: <strong>Spec-Kit</strong> plans what to build, executes it and checks it against the spec, and a governance layer keeps the loop honest.
          </p>
        </div>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION I — The Two-Phase SDLC
// ─────────────────────────────────────────────────────────────────────────

function SDLCDiagram({ activePhase, onPhaseClick }) {
  // Manual SVG-friendly layout of the plan -> execute flow (both Spec-Kit)
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--ink)", background: "var(--bg-card)" }}>
      {/* SPEC-KIT (left) */}
      <PhaseColumn
        side="left"
        tag="Phase A — Spec-Kit planning"
        title="What to build"
        nodes={COOKBOOK.specKit.map((s, i) => ({ n: String(i + 1).padStart(2, "0"), label: s.label, cmd: s.cmd, role: s.role }))}
        active={activePhase}
        onClick={onPhaseClick}
        accent="var(--accent)"
        prefix="A"
      />
      {/* EXECUTION (right) */}
      <PhaseColumn
        side="right"
        tag="Phase B — Spec-Kit execution"
        title="How to build it"
        nodes={COOKBOOK.execution.map((s) => ({ n: s.n, label: s.label, cmd: s.skill, role: "Coder" }))}
        active={activePhase}
        onClick={onPhaseClick}
        accent="var(--green)"
        prefix="B"
      />
    </div>
  );
}

function PhaseColumn({ side, tag, title, nodes, active, onClick, accent, prefix }) {
  return (
    <div style={{ padding: "32px 36px", borderLeft: side === "right" ? "1px solid var(--rule)" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div className="eyebrow" style={{ color: accent }}>{tag}</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>{nodes.length} steps</div>
      </div>
      <h3 className="display" style={{ fontSize: 36, margin: "0 0 24px", color: "var(--ink)" }}>{title}</h3>

      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {nodes.map((node, i) => {
          const id = `${prefix}${i}`;
          const isActive = active === id;
          return (
            <li key={id}>
              <button
                onClick={() => onClick(id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "grid",
                  gridTemplateColumns: "44px 1fr auto",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  border: isActive ? `1px solid ${accent}` : "1px solid transparent",
                  background: isActive ? "var(--bg-soft)" : "transparent",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "var(--ink)",
                  transition: "all 0.15s ease",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-soft)"; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span className="mono" style={{ fontSize: 11, color: accent, fontWeight: 600 }}>{node.n}</span>
                <span style={{ fontSize: 16, fontWeight: 500 }}>{node.label}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{node.cmd}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div style={{ marginTop: 24, padding: "12px 14px", background: "var(--bg-soft)", border: "1px dashed var(--rule)" }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Handoff boundary</div>
        <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
          {side === "left" ? "tasks.md → Coding Agent" : "Coding Agent ← tasks.md"}
        </div>
      </div>
    </div>
  );
}

function PhaseDetail({ phaseId }) {
  if (!phaseId) {
    return (
      <div style={{ padding: "32px 36px", background: "var(--bg-soft)", border: "1px solid var(--rule)", borderTop: "none" }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Tip</div>
        <p className="display-italic" style={{ fontSize: 22, lineHeight: 1.3, margin: 0, color: "var(--ink-2)" }}>
          Click any step above to inspect its command, output file, and an example invocation.
        </p>
      </div>
    );
  }
  const isA = phaseId.startsWith("A");
  const idx = parseInt(phaseId.slice(1), 10);
  const data = isA ? COOKBOOK.specKit[idx] : COOKBOOK.execution[idx];
  if (!data) return null;

  return (
    <div style={{ padding: "32px 36px", background: "var(--bg-card)", border: "1px solid var(--ink)", borderTop: "none" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.8fr", gap: 40 }}>
        <div>
          <Eyebrow color={isA ? "var(--accent)" : "var(--green)"}>{isA ? "Planning phase" : "Execution phase"} · {data.tag || data.skill}</Eyebrow>
          <h4 className="display" style={{ fontSize: 44, margin: "0 0 12px", color: "var(--ink)" }}>{data.label}</h4>
          <div className="mono" style={{ fontSize: 13, color: "var(--accent)", marginBottom: 16 }}>{data.cmd || data.skill}</div>
          <p style={{ margin: "0 0 16px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>{data.blurb}</p>
          {data.output && (
            <div style={{ marginTop: 16 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Output</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink)", padding: "6px 10px", background: "var(--bg-soft)", border: "1px solid var(--rule)", display: "inline-block" }}>
                {data.output}
              </div>
            </div>
          )}
          {data.role && (
            <div style={{ marginTop: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Owned by</div>
              <Pill color={isA ? "var(--accent)" : "var(--green)"} border={isA ? "var(--accent)" : "var(--green)"}>{data.role}</Pill>
            </div>
          )}
        </div>
        {data.example && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Example invocation / output</div>
            <pre className="mono" style={{ margin: 0, padding: "20px 24px", background: "var(--ink)", color: "var(--bg)", fontSize: 13, lineHeight: 1.6, overflow: "auto", maxHeight: 340 }}>{data.example}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowSection() {
  const [active, setActive] = useState("A0");
  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="01"
        kicker="The Pipeline"
        title={<>Two phases, one <em className="display-italic" style={{ color: "var(--accent)" }}>handoff</em>.</>}
        lede="Planning owns the spec. /speckit-implement owns the diff. The contract between them is tasks.md."
      />
      <SDLCDiagram activePhase={active} onPhaseClick={setActive} />
      <PhaseDetail phaseId={active} />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION II — Five Principles
// ─────────────────────────────────────────────────────────────────────────

function PrinciplesSection() {
  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="02"
        kicker="The Doctrine"
        title={<>Five <em className="display-italic" style={{ color: "var(--accent)" }}>principles</em>, non-negotiable.</>}
        lede="Five rules manage the shift from code-author to intent-definer. Every gate, log, and skill in this cookbook traces back to one of them."
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 0, border: "1px solid var(--rule)" }}>
        {COOKBOOK.principles.map((p, i) => (
          <div key={p.n} style={{
            padding: "28px 28px 32px",
            background: i % 2 === 0 ? "var(--bg-card)" : "var(--bg-soft)",
            borderRight: "1px solid var(--rule)",
            borderBottom: "1px solid var(--rule)",
            position: "relative",
            minHeight: 280,
            display: "flex",
            flexDirection: "column",
          }}>
            <div className="display-italic" style={{ fontSize: 72, lineHeight: 1, color: "var(--accent)", marginBottom: 12, opacity: 0.85 }}>{p.n}</div>
            <h3 className="display" style={{ fontSize: 28, margin: "0 0 12px", color: "var(--ink)", lineHeight: 1.05 }}>{p.title}</h3>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)", flex: 1 }}>{p.body}</p>
            <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px dashed var(--rule)" }}>
              <div className="display-italic" style={{ fontSize: 16, color: "var(--accent-ink)", lineHeight: 1.3 }}>
                "{p.pull}"
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION III — Interactive Walkthrough
// ─────────────────────────────────────────────────────────────────────────

function WalkthroughSection({ workflow, setWorkflow }) {
  const wf = COOKBOOK.workflows[workflow];
  const [step, setStep] = useState(0);
  useEffect(() => { setStep(0); }, [workflow]);

  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="03"
        kicker="The Walkthrough"
        title={<>Three <em className="display-italic" style={{ color: "var(--accent)" }}>workflows</em>, one loop.</>}
        lede="Greenfield, brownfield, and bug-fix paths differ at the front. Past the handoff, they converge on TDD."
      />

      {/* Workflow tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 32, border: "1px solid var(--ink)" }}>
        {Object.entries(COOKBOOK.workflows).map(([key, w], i) => {
          const isActive = key === workflow;
          return (
            <button
              key={key}
              onClick={() => setWorkflow(key)}
              style={{
                flex: 1,
                padding: "18px 24px",
                background: isActive ? "var(--ink)" : "var(--bg-card)",
                color: isActive ? "var(--bg)" : "var(--ink)",
                border: "none",
                borderRight: i < 2 ? "1px solid var(--ink)" : "none",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
                transition: "background 0.15s",
              }}
            >
              <div className="eyebrow" style={{ color: isActive ? "var(--accent)" : "var(--muted)", marginBottom: 6 }}>
                Workflow {String(i + 1).padStart(2, "0")} · {w.tag}
              </div>
              <div className="display" style={{ fontSize: 26, lineHeight: 1 }}>{w.name}</div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 0, border: "1px solid var(--rule)" }}>
        {/* Steps rail */}
        <div style={{ borderRight: "1px solid var(--rule)", background: "var(--bg-soft)", padding: "24px 0" }}>
          <div className="eyebrow" style={{ padding: "0 24px", marginBottom: 16 }}>
            {wf.name} sequence · {wf.steps.length} steps
          </div>
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {wf.steps.map((s, i) => {
              const isActive = i === step;
              const isHandoff = s.includes("Handoff");
              return (
                <li key={i}>
                  <button
                    onClick={() => setStep(i)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "grid",
                      gridTemplateColumns: "32px 1fr",
                      gap: 8,
                      padding: "10px 24px",
                      border: "none",
                      background: isActive ? "var(--bg-card)" : "transparent",
                      borderLeft: isActive ? "3px solid var(--accent)" : "3px solid transparent",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: isHandoff ? "var(--accent)" : "var(--ink)",
                      fontWeight: isHandoff ? 600 : 400,
                    }}
                  >
                    <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{String(i + 1).padStart(2, "0")}</span>
                    <span className={isHandoff ? "" : "mono"} style={{ fontSize: isHandoff ? 14 : 12, lineHeight: 1.4 }}>{s}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Detail panel */}
        <div style={{ padding: 36, background: "var(--bg-card)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <Eyebrow>Example case</Eyebrow>
              <h3 className="display" style={{ fontSize: 44, margin: "4px 0 12px", color: "var(--ink)" }}>{wf.example}</h3>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)", maxWidth: 540 }}>{wf.blurb}</p>
            </div>
            <Pill color="var(--accent)" border="var(--accent)">{wf.tag}</Pill>
          </div>

          <div style={{ marginTop: 28, paddingTop: 24, borderTop: "1px solid var(--rule)" }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Handoff · run in your agent</div>
            <pre className="mono" style={{
              margin: 0,
              padding: "20px 24px",
              background: "var(--ink)",
              color: "var(--bg)",
              fontSize: 12,
              lineHeight: 1.7,
              overflow: "auto",
              maxHeight: 280,
            }}>{wf.handoff}</pre>
            <CopyButton text={wf.handoff} />
          </div>
        </div>
      </div>
    </section>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      style={{
        marginTop: 12,
        padding: "8px 14px",
        background: copied ? "var(--green)" : "transparent",
        color: copied ? "var(--bg)" : "var(--ink)",
        border: "1px solid var(--ink)",
        cursor: "pointer",
        fontFamily: "var(--ff-mono)",
        fontSize: 11,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        transition: "all 0.2s",
      }}
    >
      {copied ? "✓ Copied" : "Copy handoff →"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION IV — TDD Loop
// ─────────────────────────────────────────────────────────────────────────

function TDDLoopSection() {
  const [phase, setPhase] = useState(0);
  const phases = [
    {
      name: "RED",
      sub: "Write the failing test",
      color: "var(--red)",
      detail: "Confirm it fails for the RIGHT reason. Wrong-reason failure = fix the test, not the code.",
      code: `// tests/expense-crud.test.ts
test('saves $10.50 as 1050 cents', async () => {
  const e = await saveExpense({
    amount: 10.50, category: 'Food', date: ...
  });
  expect(e.amount).toBe(1050); // ❌ FAIL
});`,
      log: "● expense-crud.test.ts\n  ✗ saves $10.50 as 1050 cents (4ms)\n  → ReferenceError: saveExpense is not defined",
    },
    {
      name: "GREEN",
      sub: "Minimum code to pass",
      color: "var(--green)",
      detail: "Write the MINIMUM. New abstraction not required? Delete it. New dep not in constitution? Ask.",
      code: `// src/lib/expenses.ts
export async function saveExpense(input) {
  return db.expense.create({
    data: { ...input, amount: Math.round(input.amount * 100) }
  });
}`,
      log: "● expense-crud.test.ts\n  ✓ saves $10.50 as 1050 cents (12ms)\n\nTests: 1 passed, 1 total",
    },
    {
      name: "REFACTOR",
      sub: "Clean up, stay green",
      color: "var(--gold)",
      detail: "Run tests after every change. Must stay green. Then proceed to two-stage review.",
      code: `// src/lib/expenses.ts
import { toCents } from './currency';

export async function saveExpense(input: ExpenseInput) {
  return db.expense.create({
    data: { ...input, amount: toCents(input.amount) }
  });
}`,
      log: "● All tests passing\n  ✓ saves $10.50 as 1050 cents (8ms)\n  ✓ toCents utility unit tests (3 passed)\n\n→ Spec compliance ✓ · Code quality ✓",
    },
  ];

  // auto cycle disabled — user controls
  const p = phases[phase];

  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="04"
        kicker="The Loop"
        title={<>RED · GREEN · <em className="display-italic" style={{ color: "var(--accent)" }}>REFACTOR</em>.</>}
        lede="Per task, no exceptions. The two-stage review at the end is blocking — spec compliance first, then code quality."
      />

      {/* Phase selector */}
      <div style={{ display: "flex", gap: 0, border: "1px solid var(--ink)", marginBottom: 0 }}>
        {phases.map((ph, i) => (
          <button
            key={ph.name}
            onClick={() => setPhase(i)}
            style={{
              flex: 1,
              padding: "20px 24px",
              background: phase === i ? ph.color : "var(--bg-card)",
              color: phase === i ? "var(--bg)" : "var(--ink)",
              border: "none",
              borderRight: i < 2 ? "1px solid var(--ink)" : "none",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
              transition: "background 0.2s",
            }}
          >
            <div className="mono" style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Phase {String(i + 1).padStart(2, "0")}</div>
            <div className="display" style={{ fontSize: 32, lineHeight: 1 }}>{ph.name}</div>
            <div className="mono" style={{ fontSize: 11, marginTop: 6, opacity: 0.85 }}>{ph.sub}</div>
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, border: "1px solid var(--ink)", borderTop: "none" }}>
        <div style={{ padding: "28px 32px", background: "var(--bg-card)", borderRight: "1px solid var(--rule)" }}>
          <div className="eyebrow" style={{ color: p.color, marginBottom: 10 }}>Code at this phase</div>
          <pre className="mono" style={{
            margin: 0,
            padding: "20px 24px",
            background: "var(--ink)",
            color: "var(--bg)",
            fontSize: 12.5,
            lineHeight: 1.65,
            overflow: "auto",
            maxHeight: 260,
          }}>{p.code}</pre>
          <p style={{ marginTop: 18, marginBottom: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>
            {p.detail}
          </p>
        </div>
        <div style={{ padding: "28px 32px", background: "var(--bg-soft)" }}>
          <div className="eyebrow" style={{ color: p.color, marginBottom: 10 }}>Test runner output</div>
          <pre className="mono" style={{
            margin: 0,
            padding: "20px 24px",
            background: p.color,
            color: p.name === "REFACTOR" ? "var(--ink)" : "var(--bg)",
            fontSize: 13,
            lineHeight: 1.6,
            overflow: "auto",
            minHeight: 240,
          }}>{p.log}</pre>
          <div style={{ marginTop: 18, padding: 14, border: `1px dashed ${p.color}`, background: "var(--bg-card)" }}>
            <div className="eyebrow" style={{ color: p.color, marginBottom: 6 }}>Next gate</div>
            <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {phase < 2 ? `Phase ${phase + 2}: ${phases[phase + 1].name}` : "Two-stage review → commit → next task"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Export to window
// ─────────────────────────────────────────────────────────────────────────

Object.assign(window, {
  Masthead,
  WorkflowSection,
  PrinciplesSection,
  WalkthroughSection,
  TDDLoopSection,
  SectionHeader,
  Eyebrow,
  Pill,
  ckStyles,
});

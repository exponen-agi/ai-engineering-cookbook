/* global React, ReactDOM, COOKBOOK, Masthead, WorkflowSection, PrinciplesSection, WalkthroughSection, TDDLoopSection, SectionHeader, Eyebrow, Pill, ckStyles, useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakColor, TweakToggle */
const { useState, useEffect } = React;

// ─────────────────────────────────────────────────────────────────────────
// SECTION V — Multi-Agent Pod
// ─────────────────────────────────────────────────────────────────────────

function PodSection() {
  const [hover, setHover] = useState(null);
  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="05"
        kicker="The Pod"
        title={<>Five <em className="display-italic" style={{ color: "var(--accent)" }}>roles</em>, no context bleed.</>}
        lede="In automated pipelines, we partition AI work into five distinct agents. Each one reads, writes, and signals in a known, narrow lane."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, border: "1px solid var(--ink)" }}>
        {COOKBOOK.pod.map((r, i) => {
          const isHover = hover === i;
          return (
            <div
              key={r.role}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{
                padding: "24px 22px 28px",
                background: isHover ? "var(--ink)" : (i % 2 === 0 ? "var(--bg-card)" : "var(--bg-soft)"),
                color: isHover ? "var(--bg)" : "var(--ink)",
                borderRight: i < 4 ? "1px solid var(--rule)" : "none",
                transition: "all 0.2s ease",
                cursor: "default",
                minHeight: 340,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="mono" style={{ fontSize: 11, color: isHover ? "var(--accent)" : "var(--accent)", marginBottom: 8 }}>
                ROLE {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="display" style={{ fontSize: 30, margin: "0 0 6px", lineHeight: 1 }}>{r.role}</h3>
              <p style={{ margin: "0 0 16px", fontSize: 12, color: isHover ? "var(--ink-2)" : "var(--muted)", fontStyle: "italic" }}>
                {r.who}
              </p>

              <div style={{ marginTop: "auto" }}>
                <div className="eyebrow" style={{ color: isHover ? "var(--muted)" : "var(--muted)", marginBottom: 4 }}>Reads</div>
                <ul className="mono" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 10.5, lineHeight: 1.6, color: isHover ? "var(--bg-soft)" : "var(--ink-2)" }}>
                  {r.reads.map((x) => <li key={x}>↳ {x}</li>)}
                </ul>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Writes</div>
                <ul className="mono" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 10.5, lineHeight: 1.6, color: isHover ? "var(--bg-soft)" : "var(--ink-2)" }}>
                  {r.writes.map((x) => <li key={x}>↑ {x}</li>)}
                </ul>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Tools</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {r.tools.map((t) => (
                    <span key={t} className="mono" style={{
                      fontSize: 9.5,
                      padding: "3px 6px",
                      border: `1px solid ${isHover ? "var(--bg-soft)" : "var(--rule)"}`,
                      color: isHover ? "var(--bg-soft)" : "var(--ink-2)",
                    }}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Flow arrow strip */}
      <div style={{ marginTop: 24, padding: "16px 24px", border: "1px dashed var(--rule)", background: "var(--bg-soft)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>Handoff order</div>
        <div className="mono" style={{ fontSize: 13, color: "var(--ink)", letterSpacing: "0.05em" }}>
          Planner <span style={{ color: "var(--accent)" }}>→</span> Orchestrator <span style={{ color: "var(--accent)" }}>→</span> Coder <span style={{ color: "var(--accent)" }}>→</span> Reviewer <span style={{ color: "var(--accent)" }}>→</span> Verifier <span style={{ color: "var(--accent)" }}>→</span> <span className="display-italic" style={{ color: "var(--green)" }}>merge</span>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION VI — Verification Gates
// ─────────────────────────────────────────────────────────────────────────

function GatesSection() {
  const [open, setOpen] = useState(0);
  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="06"
        kicker="The Gates"
        title={<>Four <em className="display-italic" style={{ color: "var(--accent)" }}>gates</em>, in sequence.</>}
        lede="A failure at any gate blocks progression. Gate 1 is automated. Gate 3 requires human consent. Gate 4 is the last check before merge."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {COOKBOOK.gates.map((g, i) => {
          const isOpen = open === i;
          return (
            <button
              key={g.n}
              onClick={() => setOpen(i)}
              style={{
                textAlign: "left",
                padding: "20px 22px 24px",
                background: isOpen ? "var(--ink)" : "var(--bg-card)",
                color: isOpen ? "var(--bg)" : "var(--ink)",
                border: isOpen ? "1px solid var(--ink)" : "1px solid var(--rule)",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.2s",
                position: "relative",
              }}
            >
              <div className="mono" style={{ fontSize: 11, color: isOpen ? "var(--accent)" : "var(--accent)", marginBottom: 8 }}>
                GATE {g.n}
              </div>
              <div className="display" style={{ fontSize: 26, lineHeight: 1.05, marginBottom: 8 }}>{g.title}</div>
              <div className="mono" style={{ fontSize: 11, color: isOpen ? "var(--ink-2)" : "var(--muted)", marginBottom: 8 }}>
                {g.when}
              </div>
              <div style={{ position: "absolute", bottom: 8, right: 10, fontSize: 18, color: isOpen ? "var(--accent)" : "var(--muted)" }}>
                {isOpen ? "—" : "+"}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 16, border: "1px solid var(--ink)", background: "var(--bg-card)" }}>
        <div style={{ padding: "20px 28px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <Eyebrow color="var(--accent)">Gate {COOKBOOK.gates[open].n} · {COOKBOOK.gates[open].when}</Eyebrow>
            <h4 className="display" style={{ fontSize: 32, margin: "4px 0 0" }}>{COOKBOOK.gates[open].title}</h4>
          </div>
          <Pill color="var(--accent)" border="var(--accent)">{COOKBOOK.gates[open].checks.length} checks</Pill>
        </div>
        <div>
          {COOKBOOK.gates[open].checks.map(([check, threshold, action], i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "60px 2fr 2fr 2fr",
              gap: 16,
              padding: "16px 28px",
              borderBottom: i < COOKBOOK.gates[open].checks.length - 1 ? "1px solid var(--rule-soft)" : "none",
              alignItems: "center",
            }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ fontSize: 15, color: "var(--ink)", fontWeight: 500 }}>{check}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{threshold}</div>
              <div className="mono" style={{ fontSize: 12, color: "var(--red)" }}>→ {action}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION VII — Extensions Matrix
// ─────────────────────────────────────────────────────────────────────────

function ExtensionsSection() {
  const phases = ["Pre-Spec", "Spec", "Plan", "Impl", "Post"];
  const phaseLabels = {
    "Pre-Spec": "Setup",
    "Spec": "Spec Phase",
    "Plan": "Plan Phase",
    "Impl": "Implementation",
    "Post": "Post-Impl",
  };
  const [filter, setFilter] = useState("All");

  const filtered = filter === "All"
    ? COOKBOOK.extensions
    : COOKBOOK.extensions.filter((e) => e.fit === filter || (filter === "Both" && e.fit === "Both"));

  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="07"
        kicker="The Catalogue"
        title={<>Twenty <em className="display-italic" style={{ color: "var(--accent)" }}>extensions</em>, mapped.</>}
        lede="Curated community plugins that plug into specific moments in the workflow — security review, scope drift detection, fixture generation, side-effect analysis."
      />

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
        <span className="eyebrow">Filter</span>
        {["All", "BF", "Both"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "6px 14px",
              border: "1px solid var(--ink)",
              background: filter === f ? "var(--ink)" : "transparent",
              color: filter === f ? "var(--bg)" : "var(--ink)",
              cursor: "pointer",
              fontFamily: "var(--ff-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >{f === "BF" ? "Brownfield only" : f === "Both" ? "Both" : "All"}</button>
        ))}
      </div>

      {/* Phase columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, border: "1px solid var(--ink)", background: "var(--bg-card)" }}>
        {phases.map((phase, pi) => {
          const items = filtered.filter((e) => e.phase === phase);
          return (
            <div key={phase} style={{
              padding: "20px 18px 24px",
              borderRight: pi < 4 ? "1px solid var(--rule)" : "none",
              minHeight: 480,
            }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--accent)", marginBottom: 4 }}>
                PHASE {String(pi + 1).padStart(2, "0")}
              </div>
              <h4 className="display" style={{ fontSize: 22, margin: "0 0 16px", color: "var(--ink)" }}>{phaseLabels[phase]}</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {items.map((e) => (
                  <div key={e.name} style={{
                    padding: "10px 12px",
                    background: "var(--bg-soft)",
                    border: "1px solid var(--rule)",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div className="mono" style={{ fontSize: 12.5, color: "var(--ink)", fontWeight: 600 }}>{e.name}</div>
                      <span className="mono" style={{
                        fontSize: 9,
                        padding: "2px 5px",
                        background: e.fit === "BF" ? "var(--gold)" : "transparent",
                        border: `1px solid ${e.fit === "BF" ? "var(--gold)" : "var(--rule)"}`,
                        color: e.fit === "BF" ? "var(--ink)" : "var(--muted)",
                      }}>{e.fit}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.4 }}>{e.note}</div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--muted)", marginTop: 4, lineHeight: 1.4 }}>
                      <span style={{ color: "var(--red)" }}>skip:</span> {e.skip}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Decision matrix */}
      <div style={{ marginTop: 24, padding: "28px 32px", border: "1px solid var(--ink)", background: "var(--bg-soft)" }}>
        <Eyebrow color="var(--accent)">Situation-based decision matrix</Eyebrow>
        <h4 className="display" style={{ fontSize: 26, margin: "4px 0 20px" }}>If your situation is...</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 0 }}>
          {COOKBOOK.decisionMatrix.map(([sit, exts], i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "1fr 2fr",
              gap: 24,
              padding: "14px 0",
              borderTop: "1px solid var(--rule)",
              alignItems: "center",
            }}>
              <div className="display-italic" style={{ fontSize: 18, color: "var(--ink)" }}>"{sit}"</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>→ run</span>
                {exts.map((e) => (
                  <Pill key={e} color="var(--accent)" border="var(--accent)">{e}</Pill>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION VIII — The Flywheel
// ─────────────────────────────────────────────────────────────────────────

function FlywheelSection() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % COOKBOOK.flywheel.length), 1800);
    return () => clearInterval(id);
  }, []);

  const cx = 260, cy = 260, r = 170;
  const steps = COOKBOOK.flywheel;
  const colorMap = {
    ink: "var(--ink)",
    blue: "var(--blue)",
    green: "var(--green)",
    gold: "var(--gold)",
    red: "var(--red)",
  };

  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="08"
        kicker="The Flywheel"
        title={<>Failures are <em className="display-italic" style={{ color: "var(--accent)" }}>learning</em>, logged.</>}
        lede="The continuous improvement loop. Every session adds to the journal; every failure adds to the postmortem; every postmortem sharpens the next cycle's prompts."
      />

      <div style={{ display: "grid", gridTemplateColumns: "520px 1fr", gap: 32, alignItems: "start" }}>
        {/* Flywheel visualization */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--ink)", padding: 24, aspectRatio: "1 / 1", position: "relative" }}>
          <svg viewBox="0 0 520 520" style={{ width: "100%", height: "100%", display: "block" }}>
            {/* Outer circle */}
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--rule)" strokeWidth="1" strokeDasharray="3 4" />
            <circle cx={cx} cy={cy} r={r + 30} fill="none" stroke="var(--rule)" strokeWidth="0.5" />

            {steps.map((s, i) => {
              const angle = (i / steps.length) * Math.PI * 2 - Math.PI / 2;
              const x = cx + Math.cos(angle) * r;
              const y = cy + Math.sin(angle) * r;
              const isActive = tick === i;

              // Arc to next
              const nextAngle = ((i + 1) / steps.length) * Math.PI * 2 - Math.PI / 2;
              const nx = cx + Math.cos(nextAngle) * r;
              const ny = cy + Math.sin(nextAngle) * r;

              return (
                <g key={i}>
                  <path
                    d={`M ${x} ${y} A ${r} ${r} 0 0 1 ${nx} ${ny}`}
                    fill="none"
                    stroke={isActive ? "var(--accent)" : "var(--rule)"}
                    strokeWidth={isActive ? "2.5" : "1"}
                    style={{ transition: "all 0.4s" }}
                  />
                  <circle cx={x} cy={y} r={isActive ? 18 : 14} fill={colorMap[s.color]} stroke="var(--bg)" strokeWidth="3" style={{ transition: "all 0.3s" }} />
                  <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontFamily="JetBrains Mono" fontWeight="600" fill="var(--bg)">
                    {String(i + 1).padStart(2, "0")}
                  </text>

                  {/* Label */}
                  <g transform={`translate(${cx + Math.cos(angle) * (r + 60)}, ${cy + Math.sin(angle) * (r + 60)})`}>
                    <text textAnchor="middle" fontSize="16" fontFamily="Instrument Serif" fill="var(--ink)" style={{ fontStyle: isActive ? "italic" : "normal" }}>
                      {s.step}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Center label */}
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontFamily="JetBrains Mono" fill="var(--muted)" letterSpacing="2">
              CYCLE
            </text>
            <text x={cx} y={cy + 22} textAnchor="middle" fontSize="32" fontFamily="Instrument Serif" fontStyle="italic" fill="var(--accent)">
              {String(tick + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
            </text>
          </svg>
        </div>

        {/* Step ledger */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>The five files of the flywheel</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {steps.map((s, i) => {
              const isActive = tick === i;
              return (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "44px 1fr",
                  gap: 16,
                  padding: "18px 20px",
                  background: isActive ? "var(--bg-card)" : "transparent",
                  borderLeft: isActive ? `4px solid ${colorMap[s.color]}` : "4px solid transparent",
                  borderBottom: "1px solid var(--rule)",
                  transition: "all 0.3s",
                  alignItems: "center",
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: colorMap[s.color],
                    color: "var(--bg)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--ff-mono)", fontSize: 12, fontWeight: 600,
                  }}>{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <div className="display" style={{ fontSize: 22, color: "var(--ink)", marginBottom: 2 }}>{s.step}</div>
                    <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.file}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sample postmortem card */}
          <div style={{ marginTop: 24, border: "1px solid var(--ink)", background: "var(--ink)", color: "var(--bg)" }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--rule)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--accent)" }}>SAMPLE POSTMORTEM · LIVE</div>
              <Pill color="var(--gold)" border="var(--gold)">{COOKBOOK.postmortem.severity}</Pill>
            </div>
            <div style={{ padding: 20 }}>
              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>
                [{COOKBOOK.postmortem.date}] {COOKBOOK.postmortem.slug}
              </div>
              <div className="display-italic" style={{ fontSize: 18, marginBottom: 12, color: "var(--bg)" }}>
                {COOKBOOK.postmortem.affected}
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--accent)" }}>What happened: </strong>{COOKBOOK.postmortem.what}
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--gold)" }}>Root cause: </strong>{COOKBOOK.postmortem.cause}
              </p>
              <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--green)" }}>Guardrail: </strong>{COOKBOOK.postmortem.guardrail}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────────────────────────────────────

function Colophon() {
  return (
    <footer style={{ marginTop: 96, paddingTop: 32, borderTop: "1px solid var(--ink)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 48, paddingBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Repo</div>
          <div className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
            github.com/{COOKBOOK.meta.repo}
          </div>
          <p style={{ marginTop: 10, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Source of truth for every spec, gate, role, and postmortem template surfaced in this explorer.
          </p>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Stack</div>
          <ul className="mono" style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 12, lineHeight: 1.8, color: "var(--ink-2)" }}>
            <li>Spec-Kit — github.com/github/spec-kit</li>
            <li>Superpowers (optional) — github.com/obra/superpowers</li>
            <li>Claude · Cursor · Copilot · Codex</li>
            <li>Antigravity · Roo · + any agent</li>
          </ul>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>Sync to repo</div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
            Drop the bundled HTML into <span className="mono" style={{ color: "var(--accent)" }}>docs/explorer.html</span> or publish via GitHub Pages.
          </p>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 16, borderTop: "1px solid var(--rule)" }}>
        <div className="display-italic" style={{ fontSize: 22, color: "var(--accent)" }}>
          End of issue.
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {COOKBOOK.meta.issue} · {COOKBOOK.meta.edition} · Set in Instrument Serif, Geist, JetBrains Mono
        </div>
      </div>
    </footer>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SECTION IX — The 2026 Stack
// ─────────────────────────────────────────────────────────────────────────

function Stack2026Section() {
  return (
    <section style={ckStyles.section}>
      <SectionHeader
        no="09"
        kicker="The 2026 Stack"
        title={<>Six layers of <em className="display-italic" style={{ color: "var(--accent)" }}>interop</em>.</>}
        lede="The formats and protocols agents now share across vendors. Write to these once and every tool in the chain — editor, CLI, CI runner — reads the same instructions."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {COOKBOOK.stack2026.map((s, i) => (
          <div
            key={s.layer}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: "20px 22px 18px",
              background: "var(--bg-card)",
              border: "1px solid var(--rule)",
              borderTop: "2px solid var(--ink)",
            }}
          >
            <div className="mono" style={{ fontSize: 10, color: "var(--accent)", marginBottom: 8 }}>
              LAYER {String(i + 1).padStart(2, "0")}
            </div>

            <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)", lineHeight: 1.1, marginBottom: 12 }}>
              {s.layer}
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
              <Pill color="var(--ink)" border="var(--ink)">{s.scope}</Pill>
              <Pill color="var(--muted)" border="var(--rule)">{s.load}</Pill>
            </div>

            <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-2)" }}>
              {s.what}
            </p>

            <div style={{ padding: "12px 14px", background: "var(--bg-soft)", borderLeft: "2px solid var(--accent)", marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Why it matters</div>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--ink)" }}>{s.why}</p>
            </div>

            <div className="mono" style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--rule)", fontSize: 10, lineHeight: 1.5, color: "var(--muted)" }}>
              <span style={{ color: "var(--accent)" }}>home:</span> {s.home}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────

function App() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "theme": "paper",
    "workflow": "greenfield",
    "accent": "#c8331d",
    "showGrain": true
  }/*EDITMODE-END*/;

  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Apply theme
  useEffect(() => {
    if (t.theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [t.theme]);

  // Apply accent
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
    // Derive a darker accent-ink
    document.documentElement.style.setProperty("--accent-ink", t.accent);
  }, [t.accent]);

  // Toggle grain
  useEffect(() => {
    const id = "grain-toggle-style";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = t.showGrain ? "" : "body::before { display: none !important; }";
  }, [t.showGrain]);

  return (
    <>
      <Masthead meta={COOKBOOK.meta} />
      <WorkflowSection />
      <PrinciplesSection />
      <WalkthroughSection workflow={t.workflow} setWorkflow={(v) => setTweak("workflow", v)} />
      <TDDLoopSection />
      <PodSection />
      <GatesSection />
      <ExtensionsSection />
      <FlywheelSection />
      <Stack2026Section />
      <Colophon />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme">
          <TweakRadio
            label="Mode"
            value={t.theme}
            onChange={(v) => setTweak("theme", v)}
            options={[
              { value: "paper", label: "Paper" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <TweakColor
            label="Accent color"
            value={t.accent}
            onChange={(v) => setTweak("accent", v)}
            options={["#c8331d", "#2a4d7a", "#2d6a4f", "#b8860b", "#7a2e8c"]}
          />
          <TweakToggle
            label="Paper grain"
            value={t.showGrain}
            onChange={(v) => setTweak("showGrain", v)}
          />
        </TweakSection>
        <TweakSection label="Walkthrough">
          <TweakRadio
            label="Workflow path"
            value={t.workflow}
            onChange={(v) => setTweak("workflow", v)}
            options={[
              { value: "greenfield", label: "Greenfield" },
              { value: "brownfield", label: "Brownfield" },
              { value: "bugfix", label: "Bug fix" },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);

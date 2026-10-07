/**
 * A minimal, correct example of tracing an agent with the OpenTelemetry GenAI
 * semantic conventions.
 *
 * This file is checked by this repository's own CI
 * (`npm run lint:semconv`, which runs `check-semconv --strict`), so the example
 * you copy is always one that passes the gate. If an attribute name here ever
 * goes stale, our build goes red before you ever read it.
 *
 * It is deliberately framework-free: plain `@opentelemetry/api` calls, so you
 * can see which attribute goes on which span without an SDK in the way. Any
 * tracing backend that speaks OTLP will accept these spans.
 *
 * Three spans, which is the shape almost every agent has:
 *
 *   invoke_agent my-agent                 ← the whole turn
 *   ├── chat claude-sonnet-4-5            ← one model call
 *   └── execute_tool load_skill pdf-form  ← loading an Agent Skill
 *
 * Replace the fake `callModel` / `loadSkill` bodies with your own.
 */

"use strict";

const { trace, SpanStatusCode, SpanKind } = require("@opentelemetry/api");

const tracer = trace.getTracer("my-agent", "1.0.0");

/** One model call, traced. */
async function tracedModelCall({ provider, model, messages }) {
  return tracer.startActiveSpan(
    // Span name convention: "{operation} {model}".
    `chat ${model}`,
    { kind: SpanKind.CLIENT },
    async (span) => {
      try {
        span.setAttributes({
          "gen_ai.operation.name": "chat",
          // Note: NOT the older "gen_ai.system" name, which was renamed. semconv-allow
          "gen_ai.provider.name": provider,
          "gen_ai.request.model": model,
          "gen_ai.request.max_tokens": 1024,
          "gen_ai.request.temperature": 0.2,
        });

        const response = await callModel({ model, messages });

        span.setAttributes({
          "gen_ai.response.id": response.id,
          "gen_ai.response.model": response.model,
          "gen_ai.response.finish_reasons": response.finishReasons,
          // The two attributes people most often forget. Without them a trace
          // says something happened but not what it cost.
          "gen_ai.usage.input_tokens": response.usage.inputTokens,
          "gen_ai.usage.output_tokens": response.usage.outputTokens,
          // Worth recording separately: cached input is usually much cheaper,
          // so a cost figure that ignores it is wrong.
          "gen_ai.usage.cache_read.input_tokens": response.usage.cacheReadTokens,
        });

        return response;
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}

/**
 * Loading an Agent Skill, traced.
 *
 * The conventions gained first-class skill attributes, which matters if your
 * agent loads skills: without this span, "the agent behaved oddly" and "the
 * agent loaded a skill that told it to behave that way" look identical in a
 * trace.
 */
async function tracedSkillLoad({ skillName, sourceUri }) {
  return tracer.startActiveSpan(`execute_tool load_skill ${skillName}`, async (span) => {
    try {
      span.setAttributes({
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "load_skill",
        "gen_ai.tool.type": "function",
        "gen_ai.skill.name": skillName,
        "gen_ai.skill.source.uri": sourceUri,
      });

      const skill = await loadSkill(skillName);

      // The skill's own description, which is what made the agent pick it.
      span.setAttribute("gen_ai.skill.description", skill.description);
      return skill;
    } finally {
      span.end();
    }
  });
}

/** Reading a file that ships inside a skill (a script, reference or asset). */
async function tracedSkillResourceRead({ skillName, resourceName }) {
  return tracer.startActiveSpan(
    `execute_tool read_skill_resource ${skillName} ${resourceName}`,
    async (span) => {
      try {
        span.setAttributes({
          "gen_ai.operation.name": "execute_tool",
          "gen_ai.tool.name": "read_skill_resource",
          "gen_ai.skill.name": skillName,
          "gen_ai.skill.resource.name": resourceName,
        });
        return await readSkillResource(skillName, resourceName);
      } finally {
        span.end();
      }
    },
  );
}

/** The whole agent turn, wrapping everything above. */
async function runAgent({ agentName, provider, model, userMessage }) {
  return tracer.startActiveSpan(`invoke_agent ${agentName}`, async (span) => {
    try {
      span.setAttributes({
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.agent.name": agentName,
        "gen_ai.agent.id": "agent-7f3a",
        "gen_ai.provider.name": provider,
        // Ties every span of one conversation together.
        "gen_ai.conversation.id": "conv-1a2b3c",
      });

      // Recording the actual prompt and reply is often exactly what you want
      // when debugging — and it puts user content in your telemetry backend.
      // check-semconv warns about these attributes so the choice is explicit;
      // the marker below records that we made it, after deciding retention.
      // semconv-allow
      span.setAttribute("gen_ai.input.messages", JSON.stringify(redact(userMessage)));

      await tracedSkillLoad({
        skillName: "pdf-form",
        sourceUri: "https://example.com/skills/pdf-form",
      });

      const reply = await tracedModelCall({
        provider,
        model,
        messages: [{ role: "user", content: userMessage }],
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return reply;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// --- stand-ins, so this file reads as real code -------------------------

async function callModel() {
  return {
    id: "msg_01",
    model: "claude-sonnet-4-5",
    finishReasons: ["end_turn"],
    usage: { inputTokens: 412, outputTokens: 118, cacheReadTokens: 0 },
  };
}
async function loadSkill(name) {
  return { name, description: "Fill PDF forms. Use when the user uploads a form." };
}
async function readSkillResource() {
  return "";
}
function redact(text) {
  return String(text).replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email]");
}

module.exports = {
  runAgent,
  tracedModelCall,
  tracedSkillLoad,
  tracedSkillResourceRead,
};

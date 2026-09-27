// ─────────────────────────────────────────────────────────────
// EnvGuard AI analysis layer (hackathon MVP).
//
// Provider-independent interface:
//
//   analyzeConfiguration(scanResults) -> Promise<analysis>
//
// - Input is an allowlist-built subset of the deterministic scanner
//   output: variable NAMES only. Secret VALUES are never present in
//   scanner output and are never sent anywhere here.
// - If a real AI provider is configured via env (see .env.example),
//   it is used; otherwise a deterministic demo explainer runs so the
//   app works with zero credentials. The demo path is always labelled
//   `provider: "demo"` so the UI can mark it "Demo analysis".
// - Do NOT claim any provider is an "application runtime API".
//   IBM Bob is our dev agent; the app uses this neutral abstraction.
// ─────────────────────────────────────────────────────────────

const DEMO_PROVIDER = "demo";

function isConfigured() {
  return (
    (process.env.AI_PROVIDER || "").trim().toLowerCase() === "openai-compatible" &&
    Boolean(process.env.AI_API_URL) &&
    Boolean(process.env.AI_API_KEY)
  );
}

// Allowlist: only names/statuses/locations — never values.
function buildAnalysisInput(scan) {
  if (!scan || !scan.variables) {
    throw new Error("Invalid scan results: missing variables section");
  }
  const pick = (v) => String(v?.variable ?? v ?? "");
  return {
    repository: String(scan.repository ?? "unknown"),
    healthScore: Number(scan.healthScore ?? 0),
    detected: (scan.variables.detected ?? []).map(pick),
    inExampleFile: (scan.variables.documented ?? []).map(pick),
    missing: (scan.variables.missing ?? []).map(pick),
    unused: (scan.variables.unused ?? []).map(pick),
    references: Object.fromEntries(
      (scan.issues ?? [])
        .filter((i) => i?.variable)
        .map((i) => [
          String(i.variable),
          {
            severity: String(i.severity ?? "").toLowerCase(),
            description: String(i.description ?? ""),
            file: String(i.file ?? ""),
            reference: String(i.reference ?? ""),
          },
        ])
    ),
    documentationIssues: (scan.documentationIssues ?? []).map((d) => ({
      variable: pick(d),
      message: String(d?.message ?? ""),
    })),
    configurationFiles: (scan.configurationFiles ?? []).map(String),
  };
}

// Deterministic fallback: turns scanner findings into
// developer-friendly explanations. No network, no credentials.
function demoAnalyze(input) {
  const critical = input.missing.map((variable) => {
    const ref = input.references[variable];
    const where = ref?.reference && ref.reference !== "—" ? ref.reference : "source code";
    const inCompose = input.documentationIssues.some(
      (d) => d.variable === variable && d.message.includes("docker-compose")
    );
    return {
      variable,
      severity: "critical",
      explanation:
        `The application reads ${variable} (${where}) but .env.example does not document it. ` +
        `A developer cloning this repo has no way to know this value is required.`,
      whyItMatters:
        `The app will crash or misbehave at runtime when ${variable} is unset, ` +
        `and onboarding/deploys become guesswork.`,
      recommendation:
        `Add ${variable} to .env.example with a placeholder and a comment describing ` +
        `how to obtain a real value.` +
        (inCompose ? ` It is also referenced by docker-compose, so keep both in sync.` : ``),
      filesToCheck: [where, ".env.example", "README.md"].filter(
        (f, i, a) => f && f !== "—" && a.indexOf(f) === i
      ),
      action: `Document ${variable} in .env.example, then re-scan.`,
    };
  });

  const warnings = [
    ...input.unused.map((variable) => ({
      variable,
      severity: "warning",
      explanation:
        `${variable} is listed in .env.example but nothing in the scanned source references it. ` +
        `It is likely leftover from an earlier version of the project.`,
      whyItMatters:
        `Stale entries confuse developers and can linger as real secrets in .env files ` +
        `long after the code stops needing them.`,
      recommendation:
        `Search the full codebase (including scripts and CI) for ${variable}; ` +
        `if nothing uses it, remove it from .env.example and rotate/delete the real value.`,
      filesToCheck: [".env.example"],
      action: `Verify ${variable} is obsolete, then remove it.`,
    })),
    ...input.documentationIssues
      .filter(
        (d) => !input.missing.includes(d.variable) && !input.unused.includes(d.variable)
      )
      .map((d) => ({
        variable: d.variable,
        severity: "warning",
        explanation: d.message + ".",
        whyItMatters:
          `Setup docs that disagree with the code send developers down the wrong path.`,
        recommendation:
          `Mention ${d.variable} in README.md setup steps or point readers at .env.example as the source of truth.`,
        filesToCheck: ["README.md", ".env.example"],
        action: `Align README.md with the actual configuration.`,
      })),
  ];

  const total = critical.length + warnings.length;
  const summary =
    total === 0
      ? `The repository's configuration is consistent: every variable used in code is documented in .env.example.`
      : `The repository has ${total} configuration inconsistenc${total === 1 ? "y" : "ies"} ` +
        `(${critical.length} critical, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}). ` +
        (critical.length > 0
          ? `${critical.map((c) => c.variable).join(" and ")} must be documented before the app can run reliably elsewhere.`
          : `No missing variables — remaining items are cleanup and documentation alignment.`);

  return {
    provider: DEMO_PROVIDER,
    model: "deterministic-fallback-v1",
    summary,
    issues: [...critical, ...warnings],
    generatedAt: new Date().toISOString(),
  };
}

// Optional real provider: any OpenAI-compatible chat-completions HTTP API.
// Enabled ONLY when AI_PROVIDER=openai-compatible plus AI_API_URL and
// AI_API_KEY are set. Any failure falls back to demo (never throws).
async function httpAnalyze(input) {
  const url = `${process.env.AI_API_URL.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "granite-3-8b-instruct",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You review environment-variable configuration findings and explain them to developers. " +
              "Reply with JSON only: {\"summary\": string, \"issues\": [{\"variable\": string, \"severity\": \"critical\"|\"warning\"|\"ok\", \"explanation\": string, \"whyItMatters\": string, \"recommendation\": string, \"filesToCheck\": string[], \"action\": string}]}. " +
              "Use only the variable names given; never invent secret values.",
          },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    if (!parsed || typeof parsed.summary !== "string" || !Array.isArray(parsed.issues)) {
      throw new Error("unexpected provider response shape");
    }
    return {
      provider: "openai-compatible",
      model: process.env.AI_MODEL || "granite-3-8b-instruct",
      summary: parsed.summary,
      issues: parsed.issues,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function analyzeConfiguration(scanResults) {
  const input = buildAnalysisInput(scanResults); // allowlisted, names-only
  if (isConfigured()) {
    try {
      return await httpAnalyze(input);
    } catch {
      // Provider failure must never break the scanner flow.
      return { ...demoAnalyze(input), providerNote: "live provider unavailable — demo analysis shown" };
    }
  }
  return demoAnalyze(input);
}

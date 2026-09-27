// ─────────────────────────────────────────────────────────────
// EnvGuard fix planner (hackathon MVP).
//
// Turns deterministic scan findings into safe, reviewable file edits.
//
// SAFETY RULES:
// - Only .env.example and README.md (repo root) may be modified.
// - .env is NEVER touched. Source code is NEVER touched.
// - Only variable NAMES are written, always with EMPTY values
//   (e.g. `DATABASE_URL=`). Real secret values are never generated,
//   never read, never logged.
// - Unused variables are NEVER auto-deleted; they are returned as
//   review items ("Review before removal").
// - planFixes() only reads; applyPlan() writes with in-memory
//   originals + rollback on partial failure.
// ─────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

const ALLOWED_FILES = new Set([".env.example", "README.md"]);
const ENV_KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function resolveTarget(repoRoot, file) {
  if (!ALLOWED_FILES.has(file)) {
    throw new Error(`Refusing to modify protected file: ${file}`);
  }
  const abs = path.resolve(repoRoot, file);
  const root = path.resolve(repoRoot);
  if (abs !== path.join(root, file)) {
    throw new Error(`Refusing to write outside repository root: ${file}`);
  }
  return abs;
}

function readExampleKeys(text) {
  const keys = new Set();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(ENV_KEY_LINE);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// Safe placeholder description — heuristic only, no credentials.
export function describeVariable(name) {
  const v = String(name).toUpperCase();
  if (v.includes("DATABASE")) return "Connection string for the application database";
  if (v.includes("CLIENT_ID")) return "OAuth client ID for authentication";
  if (v.includes("CLIENT_SECRET")) return "OAuth client secret for authentication (keep private)";
  if (v.includes("SECRET")) return "Secret for signing/encryption — generate locally, never commit";
  if (v.includes("PORT")) return "Port the service listens on";
  if (v.includes("API_KEY")) return "API key for external service access";
  if (v.includes("TOKEN")) return "Token for service authentication";
  if (v.includes("URL")) return "URL of a required external service";
  return "Required configuration value (see source code for usage)";
}

// Pure planning (reads current files for idempotency, writes nothing).
export function planFixes(scan, repoRoot) {
  if (!scan?.variables) throw new Error("Invalid scan results");
  const missing = scan.variables.missing ?? [];
  const unused = scan.variables.unused ?? [];
  const readmeIssues = (scan.documentationIssues ?? []).filter((d) =>
    String(d?.message ?? "").includes("README.md")
  );

  const exampleAbs = resolveTarget(repoRoot, ".env.example");
  const readmeAbs = resolveTarget(repoRoot, "README.md");
  const exampleText = fs.existsSync(exampleAbs) ? fs.readFileSync(exampleAbs, "utf8") : "";
  const readmeText = fs.existsSync(readmeAbs) ? fs.readFileSync(readmeAbs, "utf8") : "";
  const existingKeys = readExampleKeys(exampleText);

  // A. Missing vars -> append `NAME=` (empty value, never a secret).
  const envAdditions = missing
    .filter((v) => !existingKeys.has(v))
    .map((v) => `${v}=`);

  // B. README coverage -> table rows for vars not yet mentioned.
  const readmeAdditions = [];
  const varsToDocument = [
    ...missing,
    ...readmeIssues.map((d) => d.variable),
  ].filter((v, i, a) => v && a.indexOf(v) === i && !readmeText.includes(v));
  for (const v of varsToDocument) {
    readmeAdditions.push(`| ${v} | ${describeVariable(v)} |`);
  }

  // C. Unused vars -> review only, never auto-delete.
  const reviewItems = unused.map((v) => ({
    variable: v,
    message: `${v} is listed in .env.example but not referenced in code. Review before removal — NOT auto-deleted.`,
  }));

  const proposedChanges = [];
  if (envAdditions.length > 0) {
    proposedChanges.push({ file: ".env.example", additions: envAdditions });
  }
  if (readmeAdditions.length > 0) {
    proposedChanges.push({ file: "README.md", additions: readmeAdditions });
  }

  return {
    repository: scan.repository ?? "unknown",
    proposedChanges,
    reviewItems,
    warnings: reviewItems.map(
      (r) => `${r.variable} was not automatically removed.`
    ),
    timestamp: new Date().toISOString(),
  };
}

function applyEnvAdditions(original, additions) {
  const lines = original.endsWith("\n") ? original : original + "\n";
  return (
    lines +
    "\n# Added by EnvGuard fix workflow (empty placeholders - fill in real values locally)\n" +
    additions.join("\n") +
    "\n"
  );
}

function applyReadmeAdditions(original, additions) {
  const lines = original.split("\n");
  // Insert after the last markdown table row (skipping the `| ---` separator).
  let insertAt = -1;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("|") && !t.includes("---")) insertAt = i;
  });
  if (insertAt === -1) {
    return (
      (original.endsWith("\n") ? original : original + "\n") +
      `\n## Configuration (added by EnvGuard)\n\n| Variable | Description |\n| --- | --- |\n${additions.join("\n")}\n`
    );
  }
  lines.splice(insertAt + 1, 0, ...additions);
  return lines.join("\n");
}

// Applies a plan created by planFixes(). Rolls back on partial failure.
export function applyPlan(plan, repoRoot) {
  const originals = new Map();
  const changedFiles = [];
  const changes = [];
  try {
    for (const change of plan.proposedChanges ?? []) {
      const abs = resolveTarget(repoRoot, change.file);
      if (!fs.existsSync(abs)) {
        throw new Error(`Target file not found: ${change.file}`);
      }
      const original = fs.readFileSync(abs, "utf8");
      originals.set(abs, original);
      const next =
        change.file === ".env.example"
          ? applyEnvAdditions(original, change.additions)
          : applyReadmeAdditions(original, change.additions);
      fs.writeFileSync(abs, next, "utf8");
      changedFiles.push(change.file);
      changes.push({ file: change.file, addedLines: change.additions.length });
    }
  } catch (err) {
    for (const [abs, original] of originals) {
      try {
        fs.writeFileSync(abs, original, "utf8");
      } catch {
        // best-effort rollback
      }
    }
    throw new Error(`Fixes not applied (rolled back): ${err.message}`);
  }
  return {
    changedFiles,
    changes,
    skipped: (plan.reviewItems ?? []).map((r) => r.variable),
    warnings: plan.warnings ?? [],
    timestamp: new Date().toISOString(),
  };
}

import fs from "node:fs";
import path from "node:path";

// Directories never scanned (deps, build output, VCS).
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "out",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
]);

// Source files inspected for process.env / import.meta.env usage.
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

// Config files inspected (relative-path matching, case-sensitive).
const CONFIG_BASENAMES = new Set([
  ".env",
  ".env.example",
  "docker-compose.yml",
  "docker-compose.yaml",
  "README.md",
]);

// --- usage patterns (JS/TS only, MVP scope) ---
const DOT_ACCESS = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const BRACKET_ACCESS = /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g;
const META_ENV_ACCESS = /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
const DESTRUCTURED = /\{\s*([^}]*?)\s*\}\s*=\s*process\.env\b/g;

// .env key lines — value is intentionally discarded, never returned.
const ENV_KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

// docker-compose ${VAR} / $VAR references + `- KEY=` list entries.
const COMPOSE_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-+?][^}]*)?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
const COMPOSE_LIST_ENTRY = /^\s*-\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function recordUsage(map, name, relFile, line) {
  if (!name || name.startsWith("_")) return;
  if (!map.has(name)) map.set(name, []);
  const locs = map.get(name);
  if (locs.length < 5 && !locs.some((l) => l.file === relFile && l.line === line)) {
    locs.push({ file: relFile, line });
  }
}

function detectInSource(text, relFile, usage) {
  const lines = text.split("\n");
  lines.forEach((lineText, idx) => {
    const line = idx + 1;
    for (const m of lineText.matchAll(DOT_ACCESS)) recordUsage(usage, m[1], relFile, line);
    for (const m of lineText.matchAll(BRACKET_ACCESS)) recordUsage(usage, m[1], relFile, line);
    for (const m of lineText.matchAll(META_ENV_ACCESS)) recordUsage(usage, m[1], relFile, line);
    for (const m of lineText.matchAll(DESTRUCTURED)) {
      for (const part of m[1].split(",")) {
        const name = part.split(":")[0].split("=")[0].trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) recordUsage(usage, name, relFile, line);
      }
    }
  });
}

// SECURITY: only the key (left of `=`) is kept. Values are dropped.
function parseEnvKeys(text) {
  const keys = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(ENV_KEY_LINE);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function parseComposeVars(text) {
  const vars = new Set();
  for (const m of text.matchAll(COMPOSE_REF)) vars.add(m[1] ?? m[2]);
  for (const line of text.split("\n")) {
    const m = line.match(COMPOSE_LIST_ENTRY);
    if (m) vars.add(m[1]);
  }
  return vars;
}

// Simple transparent consistency score (NOT a security standard).
// Start at 100: -15 per missing, -5 per unused, -3 per doc issue.
export function computeHealthScore({ missingCount, unusedCount, docIssueCount }) {
  return Math.max(
    0,
    100 - missingCount * 15 - unusedCount * 5 - docIssueCount * 3
  );
}

export function scanRepository(repoPath, repositoryName = "demo-project") {
  const absRoot = path.resolve(repoPath);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`Repository not found: ${repositoryName}`);
  }

  const allFiles = walk(absRoot);
  const usage = new Map(); // var -> [{file, line}]
  const exampleKeys = new Set();
  const composeVars = new Set();
  let readmeText = "";
  let hasReadme = false;
  const configurationFiles = [];
  let filesScanned = 0;

  for (const abs of allFiles) {
    const rel = path.relative(absRoot, abs).replace(/\\/g, "/");
    const base = path.basename(abs);
    const ext = path.extname(base);

    if (SOURCE_EXTENSIONS.has(ext)) {
      filesScanned += 1;
      detectInSource(fs.readFileSync(abs, "utf8"), rel, usage);
    } else if (base === ".env.example") {
      filesScanned += 1;
      configurationFiles.push(rel);
      for (const k of parseEnvKeys(fs.readFileSync(abs, "utf8"))) exampleKeys.add(k);
    } else if (base === ".env") {
      // Counted as detected config, but values are NEVER read into results.
      if (!configurationFiles.includes(rel)) configurationFiles.push(rel);
    } else if (base === "docker-compose.yml" || base === "docker-compose.yaml") {
      filesScanned += 1;
      configurationFiles.push(rel);
      for (const v of parseComposeVars(fs.readFileSync(abs, "utf8"))) composeVars.add(v);
    } else if (base === "README.md") {
      filesScanned += 1;
      configurationFiles.push(rel);
      readmeText = fs.readFileSync(abs, "utf8");
      hasReadme = true;
    }
  }

  const detected = [...usage.keys()].sort();
  const documented = [...exampleKeys].sort();
  const documentedSet = new Set(documented);
  const missing = detected.filter((v) => !documentedSet.has(v));
  const detectedSet = new Set(detected);
  const unused = documented.filter((v) => !detectedSet.has(v));
  const consistent = detected.filter((v) => documentedSet.has(v));

  // Documentation issues: code vars absent from README + compose vars
  // absent from .env.example. Simple string-inclusion check.
  const documentationIssues = [];
  if (hasReadme) {
    for (const v of detected) {
      if (!readmeText.includes(v)) {
        documentationIssues.push({
          variable: v,
          message: `${v} is used in code but not mentioned in README.md`,
        });
      }
    }
  }
  for (const v of [...composeVars].sort()) {
    if (!documentedSet.has(v)) {
      documentationIssues.push({
        variable: v,
        message: `${v} is referenced in docker-compose but missing from .env.example`,
      });
    }
  }

  const healthScore = computeHealthScore({
    missingCount: missing.length,
    unusedCount: unused.length,
    docIssueCount: documentationIssues.length,
  });

  // Issue list shaped for the existing dashboard UI.
  const issues = [];
  for (const v of missing) {
    const loc = usage.get(v)?.[0];
    issues.push({
      severity: "CRITICAL",
      variable: v,
      description: "Used in code but missing from .env.example",
      file: ".env.example",
      reference: loc ? `${loc.file}:${loc.line}` : "source",
      status: "Open",
    });
  }
  for (const v of unused) {
    issues.push({
      severity: "WARNING",
      variable: v,
      description: "Listed in .env.example but not referenced in code",
      file: ".env.example",
      reference: "—",
      status: "Open",
    });
  }
  for (const d of documentationIssues) {
    if (!missing.includes(d.variable) && !unused.includes(d.variable)) {
      issues.push({
        severity: "WARNING",
        variable: d.variable,
        description: d.message,
        file: "README.md",
        reference: "—",
        status: "Open",
      });
    }
  }
  for (const v of consistent) {
    const loc = usage.get(v)?.[0];
    issues.push({
      severity: "OK",
      variable: v,
      description: "Used in code and documented in .env.example",
      file: ".env.example",
      reference: loc ? `${loc.file}:${loc.line}` : "source",
      status: "Resolved",
    });
  }

  return {
    repository: repositoryName,
    filesScanned,
    variables: { detected, documented, missing, unused, consistent },
    configurationFiles: configurationFiles.sort(),
    documentationIssues,
    healthScore,
    issues,
    timestamp: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// EnvGuard demo mock data.
// Clearly separated so it can be replaced with real
// backend responses later (GET /api/scan, etc.).
// Scanner + AI logic are NOT implemented yet.
// ─────────────────────────────────────────────

export const mockRepo = {
  name: "acme / checkout-service",
  branch: "main",
  provider: "demo",
};

export const mockHealth = {
  score: 82,
  summary: {
    missing: 2,
    unused: 1,
    docs: 1,
    valid: 14,
  },
};

export const mockIssues = [
  {
    id: 1,
    severity: "CRITICAL",
    variable: "DATABASE_URL",
    description: "Missing from .env.example",
    file: ".env.example",
    reference: "src/db.js:12",
    status: "Open",
  },
  {
    id: 2,
    severity: "CRITICAL",
    variable: "GOOGLE_CLIENT_ID",
    description: "Used in code but not documented",
    file: "src/auth.js:34",
    reference: ".env.example",
    status: "Open",
  },
  {
    id: 3,
    severity: "WARNING",
    variable: "OLD_API_KEY",
    description: "Defined but not referenced",
    file: ".env",
    reference: "—",
    status: "Open",
  },
  {
    id: 4,
    severity: "OK",
    variable: "PORT",
    description: "Consistent across project",
    file: ".env / .env.example",
    reference: "server.js:8",
    status: "Resolved",
  },
];

export const mockInsights = {
  filesScanned: 48,
  varsDetected: 18,
  configFiles: [".env", ".env.example", "docker-compose.yml"],
  lastScan: "Sep 27, 2026 · 2:14 PM",
};

export const mockBobAnalysis = `Bob found 2 critical gaps: DATABASE_URL is required at runtime (src/db.js) but absent from .env.example, and GOOGLE_CLIENT_ID is referenced in src/auth.js without documentation. OLD_API_KEY looks stale and safe to remove. Recommended next step: patch .env.example, then re-scan.`;

export const mockBobFix = `Proposed patch (preview only — no files changed):\n\n1. Add DATABASE_URL=postgres://user:pass@localhost:5432/app to .env.example\n2. Add GOOGLE_CLIENT_ID=<your-oauth-client-id> to .env.example with a comment\n3. Remove OLD_API_KEY from .env after confirming no references\n\nConnect the scanner backend to apply fixes automatically.`;

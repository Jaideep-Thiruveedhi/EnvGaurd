import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./scanner.js";
import { analyzeConfiguration } from "./services/aiAnalyzer.js";
import { applyPlan, planFixes } from "./services/fixPlanner.js";
import fs from "node:fs";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_REPO_PATH = path.join(__dirname, "demo-repo");
const DEMO_PRISTINE_PATH = path.join(__dirname, "demo-pristine");

// Shared repo resolution. Only the demo fixture is writable;
// arbitrary paths are scan-only.
function resolveRepo(repository) {
  const name = repository || "demo-project";
  if (name === "demo" || name === "demo-project") {
    return { name, repoPath: DEMO_REPO_PATH, writable: true };
  }
  return { name, repoPath: path.resolve(name), writable: false };
}

function scanOrUseBody(body) {
  if (body?.scan?.variables) {
    const { name, repoPath, writable } = resolveRepo(body.scan.repository);
    return { scan: body.scan, name, repoPath, writable };
  }
  const { name, repoPath, writable } = resolveRepo(body?.repository);
  return { scan: scanRepository(repoPath, name), name, repoPath, writable };
}

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

// Health check — used by the frontend status indicator.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "envguard-backend", timestamp: new Date().toISOString() });
});

// Placeholder for future scanning routes (NOT implemented in foundation step).
// app.use("/api/scan", ...);

// Scan a local repository for env/config usage. No secret VALUES are
// ever read into the response — only variable names.
// Body: { "repository": "demo-project" } (defaults to the demo fixture).
app.post("/api/scan", (req, res) => {
  try {
    const repository = req.body?.repository || "demo-project";
    const repoPath =
      repository === "demo" || repository === "demo-project"
        ? DEMO_REPO_PATH
        : path.resolve(repository);
    const result = scanRepository(repoPath, repository);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || "Scan failed" });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "EnvGuard backend is running. See GET /api/health" });
});

// AI analysis of deterministic scan findings. Accepts either a previously
// returned scan object ({ scan }) or a repository to scan first
// ({ repository }). The backend builds the analysis input — the frontend
// never constructs prompts. Only variable NAMES are processed.
app.post("/api/analyze", async (req, res) => {
  try {
    let scan = req.body?.scan;
    if (!scan) {
      const repository = req.body?.repository || "demo-project";
      const repoPath =
        repository === "demo" || repository === "demo-project"
          ? DEMO_REPO_PATH
          : path.resolve(repository);
      scan = scanRepository(repoPath, repository);
    }
    const analysis = await analyzeConfiguration(scan);
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ error: err.message || "Analysis failed" });
  }
});

app.listen(PORT, () => {
  console.log(`EnvGuard backend listening on http://localhost:${PORT}`);
});

// Preview only — plans safe fixes, writes NOTHING.
// Body: { scan } or { repository }.
app.post("/api/fix", (req, res) => {
  try {
    const { scan, repoPath } = scanOrUseBody(req.body);
    res.json(planFixes(scan, repoPath));
  } catch (err) {
    res.status(400).json({ error: err.message || "Fix planning failed" });
  }
});

// Apply planned fixes (demo fixture only), then automatically re-scan.
// Body: { scan } or { repository }.
app.post("/api/fix/apply", (req, res) => {
  try {
    const { scan, name, repoPath, writable } = scanOrUseBody(req.body);
    if (!writable) {
      return res.status(403).json({ error: "Automatic fixes are only enabled for the demo repository" });
    }
    const before = {
      healthScore: scan.healthScore,
      missing: scan.variables.missing.length,
      unused: scan.variables.unused.length,
      docs: scan.documentationIssues.length,
    };
    const plan = planFixes(scan, repoPath);
    const applied = applyPlan(plan, repoPath);
    const after = scanRepository(repoPath, name);
    res.json({ applied, before, after, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(400).json({ error: err.message || "Fix apply failed" });
  }
});

// Restore the intentionally broken demo fixture (hackathon demo repeat).
app.post("/api/demo/reset", (req, res) => {
  try {
    const restored = [];
    for (const file of [".env.example", "README.md"]) {
      const src = path.join(DEMO_PRISTINE_PATH, file);
      const dest = path.join(DEMO_REPO_PATH, file);
      if (!fs.existsSync(src)) throw new Error(`Pristine copy missing: ${file}`);
      fs.copyFileSync(src, dest);
      restored.push(file);
    }
    res.json({ reset: true, repository: "demo-project", restored, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message || "Demo reset failed" });
  }
});

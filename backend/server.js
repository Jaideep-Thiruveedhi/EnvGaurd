import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepository } from "./scanner.js";
import { analyzeConfiguration } from "./services/aiAnalyzer.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_REPO_PATH = path.join(__dirname, "demo-repo");

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

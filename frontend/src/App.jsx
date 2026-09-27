import { useEffect, useState } from "react";
import {
  mockHealth,
  mockInsights,
  mockIssues,
  mockRepo,
} from "./mockData.js";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";
const FILTERS = ["All", "Critical", "Warning", "OK"];

const severityStyle = {
  CRITICAL: "border-red-500/30 bg-red-500/10 text-red-300",
  WARNING: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  OK: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
};

function scoreColor(score) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-red-400";
}

function scoreBar(score) {
  if (score >= 80) return "bg-emerald-400";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-400";
}

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Intentional loading indicator: cycles through real operation stages
// while an async action is in flight. No fake delays — it only renders
// while the underlying request is pending.
function LoadingLine({ steps }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (steps.length < 2) return;
    const timer = setInterval(() => setIndex((v) => (v + 1) % steps.length), 1400);
    return () => clearInterval(timer);
  }, [steps.join("|")]);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-300">
      <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
      {steps[index]}
    </span>
  );
}

export default function App() {
  const [backend, setBackend] = useState("checking");
  const [repo, setRepo] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [filter, setFilter] = useState("All");
  const [bobState, setBobState] = useState("idle"); // idle | loading | done
  const [fixState, setFixState] = useState("idle");
  // Real scan results (replaces mock data after a successful scan).
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState("");
  const [offlineDemo, setOfflineDemo] = useState(false);
  // AI analysis of the scan findings (via POST /api/analyze).
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  // Fix workflow (via POST /api/fix + /api/fix/apply).
  const [fixPreview, setFixPreview] = useState(null);
  const [fixResult, setFixResult] = useState(null);
  const [fixError, setFixError] = useState("");
  const [resetting, setResetting] = useState(false);
  // Activity log for the demo flow.
  const [activity, setActivity] = useState([]);
  // Expandable issue-card details, keyed by issue id.
  const [expanded, setExpanded] = useState({});

  const logActivity = (message) =>
    setActivity((prev) => [
      ...prev,
      { time: new Date().toLocaleTimeString(), message },
    ]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(() => !cancelled && setBackend("connected"))
      .catch(() => !cancelled && setBackend("disconnected"));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = () => {
    setRepo({ name: "demo-project", branch: "local", provider: "local" });
    setScanned(false);
    setScanResult(null);
    setScanError("");
    setOfflineDemo(false);
    setBobState("idle");
    setFixState("idle");
    setAnalysis(null);
    setAnalysisError("");
    setFixPreview(null);
    setFixResult(null);
    setFixError("");
  };

  const runScan = async (target) => {
    if (!repo) setRepo({ name: target, branch: "local", provider: "local" });
    setScanning(true);
    setScanError("");
    setOfflineDemo(false);
    setBobState("idle");
    setFixState("idle");
    setAnalysis(null);
    setAnalysisError("");
    setFixPreview(null);
    setFixResult(null);
    setFixError("");
    setExpanded({});
    try {
      const res = await fetch(`${API_BASE}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository: target === mockRepo.name ? "demo-project" : target }),
      });
      if (!res.ok) throw new Error(`Scan failed (HTTP ${res.status})`);
      const data = await res.json();
      setScanResult(data);
      setRepo({ name: data.repository, branch: "local", provider: "local" });
      setScanned(true);
      logActivity(`Repository scanned — health ${data.healthScore} / 100`);
    } catch (err) {
      setScanError(`${err.message || "Could not reach the backend."} Check that the repository path is accessible and the backend is running.`);
      setScanned(false);
    } finally {
      setScanning(false);
    }
  };

  const handleScan = () => runScan(repo?.name || "demo-project");

  // One-click demo: loads the broken fixture and scans it. No credentials.
  const handleLaunchDemo = () => {
    setRepo({ name: "demo-project", branch: "local", provider: "local" });
    logActivity("Demo launched");
    return runScan("demo-project");
  };

  const handleOfflineDemo = () => {
    setOfflineDemo(true);
    setRepo(mockRepo);
    setScanned(true);
    setScanError("");
  };

  const handleAnalyze = async () => {
    setBobState("loading");
    setAnalysisError("");
    try {
      // Backend builds the analysis input from the scan — the frontend
      // never constructs prompts. Prefer the existing scan result so the
      // backend does not need to re-scan; fall back to a repository name.
      const body =
        scanResult && !offlineDemo
          ? { scan: scanResult }
          : { repository: repo?.name === mockRepo.name ? "demo-project" : repo?.name || "demo-project" };
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Analysis failed (HTTP ${res.status})`);
      setAnalysis(await res.json());
      setBobState("done");
      logActivity("Issues analyzed");
    } catch (err) {
      setAnalysisError(err.message || "Could not reach the analysis service.");
      setBobState("idle");
    }
  };

  const handleFix = async () => {
    if (!scanResult || offlineDemo) return;
    setFixState("preview-loading");
    setFixError("");
    setFixResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan: scanResult }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Fix planning failed (HTTP ${res.status})`);
      }
      setFixPreview(await res.json());
      setFixState("preview");
      logActivity("Fixes proposed — awaiting review");
    } catch (err) {
      setFixError(err.message || "Could not plan fixes.");
      setFixState("idle");
    }
  };

  const handleCancelFix = () => {
    setFixPreview(null);
    setFixError("");
    setFixState("idle");
  };

  const handleApplyFixes = async () => {
    if (!scanResult || offlineDemo) return;
    setFixState("applying");
    setFixError("");
    try {
      const res = await fetch(`${API_BASE}/api/fix/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan: scanResult }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Apply failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setFixResult(data);
      setScanResult(data.after); // dashboard refreshes with the re-scan
      setFixPreview(null);
      setFixState("applied");
      logActivity(
        `Fixes applied (${data.applied.changedFiles.join(", ") || "no files"}) — health ${data.before.healthScore}% → ${data.after.healthScore}%`
      );
      logActivity("Repository re-scanned");
    } catch (err) {
      setFixError(err.message || "Could not apply fixes.");
      setFixState("preview");
    }
  };

  const handleResetDemo = async () => {
    if (scanning) return;
    setFixError("");
    setResetting(true);
    try {
      const res = await fetch(`${API_BASE}/api/demo/reset`, { method: "POST" });
      if (!res.ok) throw new Error(`Reset failed (HTTP ${res.status})`);
      logActivity("Demo reset to original broken state");
      await handleScan();
    } catch (err) {
      setFixError(err.message || "Could not reset the demo.");
    } finally {
      setResetting(false);
    }
  };

  // ── Derive dashboard data: real scan wins, offline mock is the fallback ──
  const live = scanResult && !offlineDemo;
  const healthScore = live ? scanResult.healthScore : mockHealth.score;
  const summary = live
    ? {
        missing: scanResult.variables.missing.length,
        unused: scanResult.variables.unused.length,
        docs: scanResult.documentationIssues.length,
        valid: scanResult.variables.consistent.length,
      }
    : mockHealth.summary;
  const issues = live
    ? scanResult.issues.map((issue, i) => ({ id: i + 1, ...issue }))
    : mockIssues;
  const insights = live
    ? {
        filesScanned: scanResult.filesScanned,
        varsDetected: scanResult.variables.detected.length,
        configFiles: scanResult.configurationFiles,
        lastScan: formatTimestamp(scanResult.timestamp),
      }
    : mockInsights;
  const warningCount = issues.filter((i) => i.severity === "WARNING").length;

  const visibleIssues = issues.filter((i) =>
    filter === "All" ? true : i.severity === filter.toUpperCase()
  );

  const showResults = repo && scanned && !scanning;
  const backendDot =
    backend === "connected"
      ? "bg-emerald-500"
      : backend === "disconnected"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 sticky top-0 z-10 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-bold text-emerald-400">
              E
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">EnvGuard</h1>
                <span className="text-[11px] font-medium rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-300 px-2 py-0.5">
                  IBM Bob 2.0
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Know exactly what your project needs to run.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs rounded-full border border-slate-800 px-3 py-1.5">
            <span className={`h-2 w-2 rounded-full ${backendDot}`} />
            <span className="text-slate-300">
              {backend === "connected"
                ? "Backend connected"
                : backend === "disconnected"
                  ? "Backend offline (demo mode)"
                  : "Checking backend…"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-6">
        {/* Repository section */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex flex-col lg:flex-row lg:items-center gap-5 justify-between">
            <div className="flex-1">
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                Repository
              </h2>
              {repo ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold">{repo.name}</span>
                  <span className="text-xs rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-slate-300">
                    {repo.branch}
                  </span>
                  <span className="text-xs rounded-md border border-slate-700 px-2 py-0.5 text-slate-400">
                    {live ? "live scan" : "demo data"}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-slate-400 text-sm max-w-lg">
                  Select a repository to check its configuration health. No
                  repository selected — scanning defaults to the demo project.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleSelect}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-5 py-2.5 text-sm font-medium hover:bg-slate-800 transition"
              >
                Select Repository
              </button>
              <button
                onClick={handleScan}
                disabled={scanning || resetting}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition disabled:opacity-60"
              >
                {scanning ? "Scanning…" : "Scan Repository"}
              </button>
              <button
                onClick={handleResetDemo}
                disabled={scanning || resetting}
                title="Restore the intentionally broken demo repository"
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition disabled:opacity-60"
              >
                {resetting ? "Resetting…" : "Reset Demo"}
              </button>
            </div>
          </div>
          {scanning && (
            <div className="mt-5 space-y-3">
              <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full w-1/2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <LoadingLine steps={["Scanning repository…", "Tracing configuration usage…"]} />
            </div>
          )}
          {scanError && !scanning && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200 flex flex-wrap items-center gap-3 justify-between">
              <span>{scanError} The backend may be offline.</span>
              <button
                onClick={handleOfflineDemo}
                className="rounded-md border border-red-400/40 px-3 py-1 text-xs font-semibold hover:bg-red-500/20 transition"
              >
                Load offline demo data
              </button>
            </div>
          )}
        </section>

        {!showResults ? (
          /* Landing — value proposition first, demo one click away */
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-10 sm:p-14 text-center">
            <span className="inline-block text-[11px] font-medium rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-300 px-3 py-1">
              Built with IBM Bob 2.0
            </span>
            <h2 className="mt-4 text-4xl font-bold tracking-tight">EnvGuard</h2>
            <p className="mt-2 text-lg text-slate-200">
              Know exactly what your project needs to run.
            </p>
            <p className="mt-3 text-sm text-slate-400 max-w-xl mx-auto">
              Detect configuration inconsistencies, understand why they matter,
              and fix them before they waste developer time.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={handleLaunchDemo}
                disabled={scanning}
                className="rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition disabled:opacity-60"
              >
                {scanning ? "Scanning…" : "Launch Demo"}
              </button>
              <button
                onClick={handleSelect}
                className="rounded-lg border border-slate-700 bg-slate-800/60 px-6 py-2.5 text-sm font-medium hover:bg-slate-800 transition"
              >
                Select Repository
              </button>
            </div>
            {scanning && (
              <div className="mt-6 flex justify-center">
                <LoadingLine steps={["Scanning repository…", "Tracing configuration usage…"]} />
              </div>
            )}
            <p className="mt-6 text-[11px] text-slate-500">
              No credentials needed — the demo runs fully offline.
            </p>
          </section>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left: health + issues */}
            <div className="lg:col-span-2 space-y-6">
              {/* Health score */}
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
                      Configuration Health
                    </h2>
                    <p className="mt-1 flex items-baseline gap-1.5">
                      <span className={`text-5xl font-bold tabular-nums ${scoreColor(healthScore)}`}>
                        {healthScore}
                      </span>
                      <span className="text-xl text-slate-500">/ 100</span>
                    </p>
                  </div>
                  <div className="text-right text-xs leading-relaxed text-slate-400">
                    <p>
                      <span className="font-semibold text-red-300">{summary.missing}</span> critical issues ·{" "}
                      <span className="font-semibold text-amber-300">{warningCount}</span> warnings ·{" "}
                      <span className="font-semibold text-emerald-300">{summary.valid}</span> healthy
                    </p>
                  </div>
                </div>
                <div className="mt-4 h-2.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ease-out ${scoreBar(healthScore)}`}
                    style={{ width: `${healthScore}%` }}
                  />
                </div>
                <p className="mt-3 text-[11px] text-slate-500">
                  Configuration consistency score — not a security certification.
                </p>
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    ["Missing Variables", summary.missing, "text-red-300"],
                    ["Unused Variables", summary.unused, "text-amber-300"],
                    ["Documentation Issues", summary.docs, "text-amber-300"],
                    ["Valid Variables", summary.valid, "text-emerald-300"],
                  ].map(([label, value, color]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                    >
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      <p className="mt-1 text-xs text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Issues */}
              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold">Issues</h2>
                  <div className="flex gap-2">
                    {FILTERS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                          filter === f
                            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                            : "border-slate-700 text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <ul className="mt-4 space-y-3">
                  {visibleIssues.map((issue) => {
                    const hasRef = issue.reference && issue.reference !== "—";
                    const finding = analysis?.issues?.find((a) => a.variable === issue.variable);
                    const isOpen = Boolean(expanded[issue.id]);
                    return (
                      <li
                        key={issue.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-slate-700 transition"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-[11px] font-bold rounded border px-2 py-0.5 ${severityStyle[issue.severity]}`}
                          >
                            {issue.severity}
                          </span>
                          <code className="text-sm font-mono font-semibold text-slate-100">
                            {issue.variable}
                          </code>
                          <span className="ml-auto text-[11px] rounded-full border border-slate-700 px-2 py-0.5 text-slate-400">
                            {issue.status}
                          </span>
                        </div>
                        <div className="mt-3 space-y-1.5 text-sm">
                          <p>
                            <span className="text-slate-500">{hasRef ? "Used by: " : "Declared in: "}</span>
                            <code className="font-mono text-xs text-slate-300">
                              {hasRef ? issue.reference : issue.file}
                            </code>
                          </p>
                          <p>
                            <span className="text-slate-500">Problem: </span>
                            <span className="text-slate-300">{issue.description}</span>
                          </p>
                          {finding?.recommendation && (
                            <p>
                              <span className="text-slate-500">Recommendation: </span>
                              <span className="text-slate-300">{finding.recommendation}</span>
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [issue.id]: !prev[issue.id] }))}
                          className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition"
                        >
                          {isOpen ? "Hide details ▲" : "Details ▼"}
                        </button>
                        {isOpen && (
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs space-y-1.5">
                            <p className="text-slate-400">
                              <span className="text-slate-500">Status: </span>{issue.status}
                              <span className="mx-2 text-slate-700">|</span>
                              <span className="text-slate-500">Seen in: </span>
                              <code className="font-mono">{issue.file}</code>
                              {hasRef && (
                                <code className="font-mono"> · {issue.reference}</code>
                              )}
                            </p>
                            {finding?.whyItMatters && (
                              <p className="text-slate-400">
                                <span className="text-slate-500">Why this matters: </span>
                                {finding.whyItMatters}
                              </p>
                            )}
                            {finding?.action && (
                              <p className="text-slate-400">
                                <span className="text-slate-500">Suggested action: </span>
                                {finding.action}
                              </p>
                            )}
                            {finding?.filesToCheck?.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {finding.filesToCheck.map((f) => (
                                  <code
                                    key={f}
                                    className="font-mono rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-slate-400"
                                  >
                                    {f}
                                  </code>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {visibleIssues.length === 0 && (
                    <li className="text-sm text-slate-500 text-center py-6">
                      No issues in this category.
                    </li>
                  )}
                </ul>
              </section>
            </div>

            {/* Right: Bob actions + insights */}
            <div className="space-y-6">
              <section className="rounded-2xl border border-violet-500/25 bg-gradient-to-b from-violet-500/10 to-slate-900/60 p-6">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">AI Analysis</h2>
                  {analysis && (
                    <span className="text-[11px] font-medium rounded-full border border-violet-500/40 bg-violet-500/10 text-violet-300 px-2 py-0.5">
                      {analysis.provider === "demo" ? "Demo analysis" : `AI · ${analysis.provider}`}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Plain-language explanation of the scan findings. Only variable
                  names are analyzed — never secret values.
                </p>
                <button
                  onClick={handleAnalyze}
                  disabled={bobState === "loading"}
                  className="mt-4 w-full rounded-lg bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 transition disabled:opacity-60"
                >
                  {bobState === "loading" ? (
                    <LoadingLine steps={["Analyzing inconsistencies…"]} />
                  ) : (
                    "Analyze Configuration"
                  )}
                </button>
                <button
                  onClick={handleFix}
                  disabled={fixState === "preview-loading" || fixState === "applying" || !live}
                  title={!live ? "Run a live scan first" : ""}
                  className="mt-2 w-full rounded-lg border border-violet-500/40 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-500/10 transition disabled:opacity-60"
                >
                  {fixState === "preview-loading" || fixState === "applying" ? (
                    <LoadingLine
                      steps={
                        fixState === "applying"
                          ? ["Applying fixes…", "Re-scanning repository…"]
                          : ["Preparing proposed fixes…"]
                      }
                    />
                  ) : (
                    "Fix Issues with Bob"
                  )}
                </button>
                {fixError && (
                  <p className="mt-4 text-xs leading-relaxed rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-200">
                    {fixError}
                  </p>
                )}
                {fixState === "preview" && fixPreview && (
                  <div className="mt-4 rounded-lg border border-emerald-500/30 bg-slate-950/60 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                      Proposed fixes
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Before: {healthScore} / 100 · {summary.missing} missing ·{" "}
                      {summary.docs} documentation issues · {summary.unused} unused.
                      Review before anything changes — .env and source code are never touched.
                    </p>
                    {fixPreview.proposedChanges.length === 0 && (
                      <p className="mt-2 text-xs text-slate-300">
                        Nothing to fix automatically — configuration is consistent.
                      </p>
                    )}
                    {fixPreview.proposedChanges.map((change) => (
                      <div key={change.file} className="mt-2">
                        <code className="text-xs font-mono font-semibold text-slate-200">
                          {change.file}
                        </code>
                        <ul className="mt-1 space-y-0.5">
                          {change.additions.map((line) => (
                            <li
                              key={line}
                              className="text-[11px] font-mono text-emerald-300 break-all"
                            >
                              + {line}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {fixPreview.reviewItems?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {fixPreview.reviewItems.map((item) => (
                          <p key={item.variable} className="text-[11px] leading-relaxed text-amber-300">
                            ⚠ {item.variable} — review before removal (never auto-deleted)
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={handleApplyFixes}
                        className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition"
                      >
                        Apply Fixes
                      </button>
                      <button
                        onClick={handleCancelFix}
                        className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {fixState === "applied" && fixResult && (
                  <div className="mt-4 rounded-lg border border-emerald-500/30 bg-slate-950/60 p-3">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-300">
                      After — fixes applied ✓
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Before: {fixResult.before.healthScore} / 100 · {fixResult.before.missing} missing ·{" "}
                      {fixResult.before.docs} documentation issues · {fixResult.before.unused} unused
                    </p>
                    <p className="mt-2 text-2xl font-bold tabular-nums">
                      {fixResult.before.healthScore}
                      <span className="text-slate-500"> / 100 → </span>
                      <span className="text-emerald-400">{fixResult.after.healthScore} / 100</span>
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {fixResult.after.variables.missing.length} missing ·{" "}
                      {fixResult.after.documentationIssues.length} documentation issues ·{" "}
                      {fixResult.after.variables.unused.length} unused (requires review)
                    </p>
                    {fixResult.applied.warnings?.length > 0 && (
                      <p className="mt-2 text-[11px] text-amber-300">
                        ⚠ {fixResult.applied.warnings.join(" ")}
                      </p>
                    )}
                  </div>
                )}
                {analysisError && (
                  <p className="mt-4 text-xs leading-relaxed rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-200">
                    {analysisError} Your scan results above are unaffected — you can retry analysis anytime.
                  </p>
                )}
                {analysis && (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-lg border border-violet-500/25 bg-slate-950/60 p-3">
                      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                        Overall assessment
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-200">
                        {analysis.summary}
                      </p>
                    </div>
                    {analysis.issues.map((item) => (
                      <div
                        key={item.variable}
                        className="rounded-lg border border-slate-700 bg-slate-950/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`text-[11px] font-bold rounded border px-2 py-0.5 ${severityStyle[item.severity?.toUpperCase()] || severityStyle.WARNING}`}
                          >
                            {item.severity?.toUpperCase()}
                          </span>
                          <code className="text-xs font-mono font-semibold">
                            {item.variable}
                          </code>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-slate-300">
                          {item.explanation}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-slate-400">
                          <span className="font-semibold text-slate-300">Why this matters: </span>
                          {item.whyItMatters}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-400">
                          <span className="font-semibold text-emerald-300">Recommended fix: </span>
                          {item.recommendation}
                        </p>
                        {item.filesToCheck?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.filesToCheck.map((f) => (
                              <code
                                key={f}
                                className="text-[11px] font-mono rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-slate-400"
                              >
                                {f}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
                <h2 className="font-semibold">Repository Insights</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">Files scanned</dt>
                    <dd className="font-semibold">{insights.filesScanned}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">Env variables detected</dt>
                    <dd className="font-semibold">{insights.varsDetected}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-400">Last scan</dt>
                    <dd className="font-semibold text-right text-xs self-center">
                      {insights.lastScan}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Configuration files</dt>
                    <dd className="mt-1.5 flex flex-wrap gap-1.5">
                      {insights.configFiles.map((f) => (
                        <code
                          key={f}
                          className="text-xs font-mono rounded border border-slate-700 bg-slate-950 px-2 py-0.5"
                        >
                          {f}
                        </code>
                      ))}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        )}
        {showResults && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="font-semibold">Secrets are never exposed.</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-slate-400">
              <li className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                Actual <code className="font-mono">.env</code> values never leave the backend — only variable names reach the frontend.
              </li>
              <li className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                Analysis works on names and metadata, never on secret values.
              </li>
              <li className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                Automatic fixes never modify <code className="font-mono">.env</code> or source code — only <code className="font-mono">.env.example</code> and <code className="font-mono">README.md</code>.
              </li>
              <li className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                Generated example entries are empty placeholders (<code className="font-mono">NAME=</code>) for developers to fill in locally.
              </li>
            </ul>
          </section>
        )}
        {activity.length > 0 && (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
            <h2 className="font-semibold">Activity timeline</h2>
            <ul className="mt-3 space-y-2.5">
              {activity.map((entry, i) => (
                <li key={i} className="flex items-start gap-3 text-xs">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-bold text-emerald-400">
                    ✓
                  </span>
                  <div>
                    <p className="text-slate-200">{entry.message}</p>
                    <p className="font-mono text-[11px] text-slate-500">{entry.time}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

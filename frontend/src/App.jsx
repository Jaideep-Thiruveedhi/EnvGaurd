import { useEffect, useState } from "react";
import {
  mockBobFix,
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

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
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
  };

  const handleScan = async () => {
    const target = repo?.name || "demo-project";
    if (!repo) setRepo({ name: target, branch: "local", provider: "local" });
    setScanning(true);
    setScanError("");
    setOfflineDemo(false);
    setBobState("idle");
    setFixState("idle");
    setAnalysis(null);
    setAnalysisError("");
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
    } catch (err) {
      setScanError(err.message || "Could not reach the backend.");
      setScanned(false);
    } finally {
      setScanning(false);
    }
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
    } catch (err) {
      setAnalysisError(err.message || "Could not reach the analysis service.");
      setBobState("idle");
    }
  };

  const handleFix = () => {
    setFixState("loading");
    setTimeout(() => setFixState("done"), 1600);
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
                disabled={scanning}
                className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition disabled:opacity-60"
              >
                {scanning ? "Scanning…" : "Scan Repository"}
              </button>
            </div>
          </div>
          {scanning && (
            <div className="mt-5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-emerald-400 animate-pulse" />
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
          /* Empty state — communicates what EnvGuard does */
          <section className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/30 p-10 text-center">
            <h3 className="text-lg font-semibold">
              Find missing, unused, and undocumented env variables
            </h3>
            <p className="mt-2 text-sm text-slate-400 max-w-xl mx-auto">
              EnvGuard scans your repo for configuration problems, scores its
              health, and shows exactly what to fix — with IBM Bob ready to
              explain and patch issues.
            </p>
            <button
              onClick={handleScan}
              className="mt-6 rounded-lg bg-emerald-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 transition"
            >
              Load demo repository
            </button>
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
                    <p className={`mt-1 text-5xl font-bold ${scoreColor(healthScore)}`}>
                      {healthScore}
                      <span className="text-xl text-slate-500">%</span>
                    </p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {summary.missing} critical · {warningCount} warning need attention
                  </p>
                </div>
                <div className="mt-4 h-2.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-400"
                    style={{ width: `${healthScore}%` }}
                  />
                </div>
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
                  {visibleIssues.map((issue) => (
                    <li
                      key={issue.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
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
                      <p className="mt-1.5 text-sm text-slate-300">
                        {issue.description}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 font-mono">
                        {issue.file} · {issue.reference}
                      </p>
                    </li>
                  ))}
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
                  {bobState === "loading" ? "Analyzing repository configuration…" : "Analyze Configuration"}
                </button>
                <button
                  onClick={handleFix}
                  disabled={fixState === "loading"}
                  className="mt-2 w-full rounded-lg border border-violet-500/40 px-4 py-2.5 text-sm font-semibold text-violet-200 hover:bg-violet-500/10 transition disabled:opacity-60"
                >
                  {fixState === "loading" ? "Generating fixes…" : "Fix Issues with Bob"}
                </button>
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
                {fixState === "done" && (
                  <p className="mt-3 text-xs leading-relaxed rounded-lg border border-slate-700 bg-slate-950/60 p-3 text-slate-300 whitespace-pre-wrap font-mono">
                    {mockBobFix}
                  </p>
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
      </main>
    </div>
  );
}

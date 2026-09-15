import React, { useEffect, useState } from "react";
import { ArrowLeft, History, CheckCircle2, XCircle, Loader2, Clock, RefreshCw } from "lucide-react";
import { harnessClient } from "../harness/client";
import type { ExecutionRow } from "../harness/sharedTypes";
import { buildReportFromExecutionDetail } from "../utils/verificationEngine";
import type { VerificationReport } from "../types";

interface Props {
  onBack: () => void;
  /** Opens the same VerificationReportModal the live-run flow uses, in App.tsx. */
  onOpenReport: (report: VerificationReport) => void;
}

// executeToolAsync() gives a verifier tool's async-tool executions this fixed intent string
// when no execution_id is passed in (see server/api/tools_router.py's execute_async) — it's how
// this page tells "a TestData Verification run" apart from every other scenario's executions
// without needing a dedicated column or a backend change. Covers both the Selenium-based tool
// and the API-direct one, since either can produce a report this page should be able to reopen.
const VERIFICATION_INTENTS = new Set(["async_tool:testdata_verifier", "async_tool:testdata_verifier_api"]);

const STATUS_META: Record<ExecutionRow["status"], { icon: React.ReactNode; cls: string; label: string }> = {
  SUCCESS: { icon: <CheckCircle2 className="w-3.5 h-3.5" />, cls: "text-emerald-400 bg-emerald-950/30 border-emerald-800/40", label: "Success" },
  FAILED: { icon: <XCircle className="w-3.5 h-3.5" />, cls: "text-rose-400 bg-rose-950/30 border-rose-800/40", label: "Failed" },
  RUNNING: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, cls: "text-cyan-400 bg-cyan-950/30 border-cyan-800/40", label: "Running" },
  PENDING: { icon: <Clock className="w-3.5 h-3.5" />, cls: "text-slate-400 bg-slate-800/40 border-slate-700", label: "Pending" },
};

export const HistoryPage: React.FC<Props> = ({ onBack, onOpenReport }) => {
  const [rows, setRows] = useState<ExecutionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    harnessClient
      .listExecutions(1, 50)
      .then((res) => setRows(res.items.filter((r) => VERIFICATION_INTENTS.has(r.intent))))
      .catch((e) => setError(e?.message ?? String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleOpen = async (row: ExecutionRow) => {
    setOpeningId(row.id);
    setError(null);
    try {
      const detail = await harnessClient.getExecution(row.id);
      const report = buildReportFromExecutionDetail(detail);
      onOpenReport(report);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-slate-900/90 border-b border-slate-800 px-5 py-3 flex items-center justify-between shadow-lg flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30">
              <History className="w-4 h-4 text-slate-950" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white">Verification History</h1>
              <p className="text-[10px] text-slate-500 font-mono">Reopen a past TestData Verification report</p>
            </div>
          </div>
        </div>
        <button
          onClick={load}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-2">
          {error && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-300 mb-2">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-xs gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading history...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 text-xs gap-2">
              <History className="w-8 h-8 text-slate-700" />
              No TestData Verification runs yet.
            </div>
          ) : (
            rows.map((row) => {
              const meta = STATUS_META[row.status];
              const isOpening = openingId === row.id;
              return (
                <button
                  key={row.id}
                  onClick={() => handleOpen(row)}
                  disabled={openingId !== null}
                  className="w-full text-left bg-slate-900/60 border border-slate-800 hover:border-slate-600 rounded-xl px-4 py-3 flex items-center gap-3 transition disabled:opacity-60"
                >
                  <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold flex-shrink-0 ${meta.cls}`}>
                    {meta.icon} {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-slate-300 truncate">{row.id}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(row.started_at).toLocaleString()}
                      {row.total_ms ? ` · ${(row.total_ms / 1000).toFixed(1)}s` : ""}
                    </div>
                  </div>
                  {isOpening && <Loader2 className="w-4 h-4 animate-spin text-cyan-400 flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
};

import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, ExternalLink, FolderOpen, Copy, Sparkles, FileText } from 'lucide-react';

export interface EasyHelpResult {
  outputFolder: string;
  reportHtmlPath: string;
  filesCount: number;
  changedCount: number;
  missingKeywords: string[];
  ai?: {
    model: string;
    htmlPath: string;
    summary: string;
    qualityIssues: string[];
  };
}

/** Desktop app (pywebview) exposes open_path; a plain browser cannot open local files. */
const openLocal = (path: string): boolean => {
  const api = (window as any).pywebview?.api as { open_path?: (p: string) => Promise<boolean> } | undefined;
  if (!api?.open_path) return false;
  void api.open_path(path);
  return true;
};

const PathRow: React.FC<{ label: string; path: string; icon: React.ReactNode }> = ({ label, path, icon }) => {
  const [copied, setCopied] = useState(false);
  const onOpen = () => {
    if (openLocal(path)) return;
    // Browser fallback: hand the path over so it can be pasted into Explorer / the address bar
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      onClick={onOpen}
      title={path}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-cyan-500/50 text-left transition"
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-slate-200">{label}</span>
        <span className="block text-[10px] font-mono text-slate-500 truncate">{path}</span>
      </span>
      {copied
        ? <span className="text-[10px] text-emerald-400">copied</span>
        : (window as any).pywebview?.api?.open_path
          ? <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
          : <Copy className="w-3.5 h-3.5 text-slate-500" />}
    </button>
  );
};

export const EasyHelpReviewPanel: React.FC<{ result: EasyHelpResult }> = ({ result }) => {
  const gaps = result.missingKeywords.length;
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
      <div className="pb-3 border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> REPORT READY
          </span>
          <h2 className="text-base font-bold text-white">Helpfile Comparison</h2>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-950/60 border border-slate-800 py-2">
          <div className="font-mono text-lg font-bold text-cyan-400">{result.filesCount}</div>
          <div className="text-[10px] text-slate-500">files</div>
        </div>
        <div className="rounded-xl bg-slate-950/60 border border-slate-800 py-2">
          <div className={`font-mono text-lg font-bold ${result.changedCount ? 'text-amber-400' : 'text-emerald-400'}`}>{result.changedCount}</div>
          <div className="text-[10px] text-slate-500">differ from baseline</div>
        </div>
        <div className="rounded-xl bg-slate-950/60 border border-slate-800 py-2">
          <div className={`font-mono text-lg font-bold ${gaps ? 'text-rose-400' : 'text-emerald-400'}`}>{gaps}</div>
          <div className="text-[10px] text-slate-500">keyword gaps</div>
        </div>
      </div>

      {gaps > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>Not present in every file: {result.missingKeywords.join(', ')}</span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <PathRow label="Comparison report" path={result.reportHtmlPath} icon={<FileText className="w-4 h-4 text-cyan-400" />} />
        {result.ai && (
          <PathRow label={`AI analysis (${result.ai.model})`} path={result.ai.htmlPath} icon={<Sparkles className="w-4 h-4 text-purple-400" />} />
        )}
        <PathRow label="Output folder" path={result.outputFolder} icon={<FolderOpen className="w-4 h-4 text-amber-400" />} />
      </div>

      {result.ai ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold text-purple-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> AI summary
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">{result.ai.summary}</p>
          {result.ai.qualityIssues.length > 0 && (
            <ul className="flex flex-col gap-1 max-h-[220px] overflow-y-auto">
              {result.ai.qualityIssues.map((q, i) => (
                <li key={i} className="text-[11px] text-amber-300 bg-amber-500/5 rounded-lg px-2 py-1">⚠ {q}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500 italic">AI analysis was skipped — the comparison report is complete without it.</p>
      )}
    </div>
  );
};

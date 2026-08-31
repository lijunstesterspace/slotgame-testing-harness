import React, { useState } from 'react';
import { 
  X, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  Globe, 
  RefreshCw,
  Search,
  FileSearch,
  Sparkles,
  ShieldAlert,
  Camera,
  Brain,
  Lightbulb,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { VerificationReport } from '../types';
import { diagnoseVerificationResult } from '../utils/logVisionDiagnoser';

interface VerificationReportModalProps {
  report: VerificationReport;
  onClose: () => void;
  onReRun: () => void;
}

export const VerificationReportModal: React.FC<VerificationReportModalProps> = ({
  report,
  onClose,
  onReRun
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PASSED' | 'FAILED'>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aiExpanded, setAiExpanded] = useState(true);

  const filteredResults = report.results.filter((res) => {
    const matchesSearch = 
      res.caseName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      res.recordId.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (filterStatus === 'PASSED') return matchesSearch && res.status === 'PASSED';
    if (filterStatus === 'FAILED') return matchesSearch && res.status !== 'PASSED';
    return matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-950 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl border ${
              report.failedCount === 0 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
            }`}>
              {report.failedCount === 0 ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Real Game Environment Verification & Log/Vision Diagnostic Report
              </h3>
              <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-mono text-cyan-300 truncate max-w-md">{report.targetUrl}</span>
                <span>• Executed at {report.executedAt}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex flex-col gap-6">
          
          {/* Top KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Pass Rate</span>
              <span className={`text-2xl font-black mt-1 ${
                report.passRate === 100 ? 'text-emerald-400' : report.passRate >= 80 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {report.passRate}%
              </span>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Verified Cases</span>
              <span className="text-2xl font-black text-white mt-1">
                {report.passedCount} <span className="text-xs font-normal text-slate-400">/ {report.totalCases}</span>
              </span>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Discrepancies / Errors</span>
              <span className={`text-2xl font-black mt-1 ${report.failedCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                {report.failedCount}
              </span>
            </div>

            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 flex flex-col">
              <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Total Duration</span>
              <span className="text-2xl font-black text-cyan-400 mt-1 flex items-center gap-1">
                <Clock className="w-4 h-4 text-cyan-400" />
                {(report.totalTimeMs / 1000).toFixed(2)}s
              </span>
            </div>
          </div>

          {/* AI Diagnosis Summary Section */}
          {report.aiDiagnosis && report.failedCount > 0 && (
            <div className="bg-gradient-to-br from-violet-950/40 to-slate-900 border border-violet-500/30 rounded-xl overflow-hidden">
              <button
                onClick={() => setAiExpanded(!aiExpanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-violet-950/30 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-violet-500/20 border border-violet-500/40">
                    <Brain className="w-4 h-4 text-violet-300" />
                  </div>
                  <div className="text-left">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      AI 智能诊断分析
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/30 border border-violet-500/50 text-violet-200">
                        {report.aiDiagnosis.failedDiagnoses.length} 条诊断
                      </span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">
                      {report.aiDiagnosis.summary}
                    </p>
                  </div>
                </div>
                {aiExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>

              {aiExpanded && (
                <div className="px-4 pb-4 flex flex-col gap-3">
                  {/* AI Summary */}
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800">
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {report.aiDiagnosis.summary}
                    </p>
                  </div>

                  {/* AI Diagnoses for Failed Cases */}
                  {report.aiDiagnosis.failedDiagnoses.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                        失败案例根因分析
                      </span>
                      {report.aiDiagnosis.failedDiagnoses.map((diag, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-bold ${
                              diag.severity === 'HIGH' ? 'text-rose-300' :
                              diag.severity === 'MEDIUM' ? 'text-amber-300' : 'text-slate-300'
                            }`}>
                              {diag.title}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 border border-slate-700 text-slate-400">
                              {diag.diagnosisType}
                            </span>
                          </div>
                          {diag.aiAnalysis && (
                            <p className="text-[11px] text-slate-300 leading-relaxed">
                              {diag.aiAnalysis}
                            </p>
                          )}
                          {diag.evidenceLogs.length > 0 && (
                            <div className="flex flex-col gap-1">
                              {diag.evidenceLogs.map((log, i) => (
                                <span key={i} className="text-[10px] text-cyan-300 font-mono bg-slate-900/60 px-2 py-1 rounded">
                                  {log}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                            <Lightbulb className="w-3 h-3" />
                            <span>{diag.recommendation}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recommendations */}
                  {report.aiDiagnosis.recommendations.length > 0 && (
                    <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/30">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
                        建议操作
                      </span>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {report.aiDiagnosis.recommendations.map((rec, idx) => (
                          <li key={idx} className="text-xs text-slate-200 flex items-start gap-1.5">
                            <span className="text-emerald-400 mt-0.5">•</span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search case name or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/80"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setFilterStatus('ALL')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterStatus === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All ({report.results.length})
              </button>
              <button
                onClick={() => setFilterStatus('PASSED')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterStatus === 'PASSED' ? 'bg-emerald-950/80 text-emerald-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Passed ({report.passedCount})
              </button>
              <button
                onClick={() => setFilterStatus('FAILED')}
                className={`px-2.5 py-1 rounded-lg font-medium transition ${
                  filterStatus === 'FAILED' ? 'bg-rose-950/80 text-rose-300' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Failed ({report.failedCount})
              </button>
            </div>
          </div>

          {/* Results Table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[340px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10">
                  <th className="py-2.5 px-3">Case ID</th>
                  <th className="py-2.5 px-3">Scenario Name</th>
                  <th className="py-2.5 px-3">Verified Seed (Batch, Index)</th>
                  <th className="py-2.5 px-3 text-center">HTTP Status</th>
                  <th className="py-2.5 px-3 text-right">Latency</th>
                  <th className="py-2.5 px-3 text-center">Status & Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {filteredResults.map((res) => {
                  const proof = diagnoseVerificationResult(res);
                  const isExpanded = expandedId === res.recordId;

                  return (
                    <React.Fragment key={res.recordId}>
                      <tr 
                        onClick={() => setExpandedId(isExpanded ? null : res.recordId)}
                        className="hover:bg-slate-800/50 cursor-pointer transition"
                      >
                        <td className="py-2.5 px-3 text-slate-400 font-bold">{res.recordId}</td>
                        <td className="py-2.5 px-3 font-sans font-semibold text-slate-200">{res.caseName}</td>
                        <td className="py-2.5 px-3 text-cyan-300">{res.batchIndexString}</td>
                        <td className="py-2.5 px-3 text-center font-bold">
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            res.httpStatus === 200 ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/50' : 'bg-rose-950/80 text-rose-300 border border-rose-800/50'
                          }`}>
                            {res.httpStatus === 0 ? 'ERR' : res.httpStatus}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-400">{res.responseTimeMs}ms</td>
                        <td className="py-2.5 px-3 text-center font-bold">
                          {res.status === 'PASSED' ? (
                            <span className="text-emerald-400 flex items-center justify-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> PASSED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-rose-950/80 border border-rose-700 text-rose-300 text-[10px] flex items-center justify-center gap-1">
                              <FileSearch className="w-3.5 h-3.5" /> Inspect Proof
                            </span>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-950/90">
                          <td colSpan={6} className="p-4 text-[11px] text-slate-300 border-b border-slate-800 font-sans">
                            <div className="flex flex-col gap-3">
                              
                              {/* Diagnostic Title Header */}
                              <div className={`p-3 rounded-xl border flex items-center justify-between ${
                                proof.diagnosisType === 'ORIGINAL_SHEET_DATA_ERROR'
                                  ? 'bg-rose-950/60 border-rose-800/60 text-rose-300'
                                  : proof.diagnosisType === 'VERIFIED_CORRECT'
                                  ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                                  : 'bg-amber-950/60 border-amber-800/60 text-amber-300'
                              }`}>
                                <div className="flex items-center gap-2">
                                  <ShieldAlert className="w-4 h-4" />
                                  <span className="font-bold text-xs">{proof.title}</span>
                                </div>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 border border-slate-700">
                                  Severity: {proof.severity}
                                </span>
                              </div>

                              {/* Evidence Proof Chain Grid */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-1">
                                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Google Sheet Expectation</span>
                                  <p className="text-slate-200 font-medium">{proof.sheetExpectation}</p>
                                </div>

                                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-1">
                                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Real Game Server & Canvas Outcome</span>
                                  <p className="text-cyan-300 font-medium">{proof.realServerOutcome}</p>
                                </div>
                              </div>

                              {/* Logs & Recommendation */}
                              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-2 font-mono text-[11px]">
                                <span className="text-slate-400 font-bold flex items-center gap-1.5 font-sans">
                                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                  AI Diagnostic Evidence Trail:
                                </span>
                                {proof.evidenceLogs.map((log, idx) => (
                                  <div key={idx} className="text-slate-300 bg-slate-950/80 p-2 rounded border border-slate-800/80">
                                    {log}
                                  </div>
                                ))}

                                <div className="mt-1 pt-2 border-t border-slate-800 font-sans text-xs flex items-center gap-2 text-emerald-300 font-semibold">
                                  <span>💡 Recommended Fix:</span>
                                  <span>{proof.recommendation}</span>
                                </div>
                              </div>

                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>

        {/* Footer Toolbar */}
        <div className="bg-slate-950 px-6 py-3 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={onReRun}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            Re-run Verification & Diagnosis
          </button>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-bold text-xs shadow-lg transition"
          >
            Close Diagnostic Report
          </button>
        </div>

      </div>
    </div>
  );
};

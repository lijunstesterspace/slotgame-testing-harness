import React, { useState, useMemo } from 'react';
import {
  Code, Download, CheckCircle2, Edit3, UserCheck, Eye, FileJson
} from 'lucide-react';
import { TestRecord } from '../types';
import { XmlViewer } from './XmlViewer';
import { generateOutcomeZip } from '../utils/zipGenerator';

interface TestDataPreviewProps {
  records: TestRecord[];
  loginName?: string;
  onRegenerate: () => void;
}

export const TestDataPreview: React.FC<TestDataPreviewProps> = ({
  records,
  loginName = '',
  onRegenerate
}) => {
  const [activeView, setActiveView] = useState<'JSON' | 'XML'>('JSON');
  const [isZipping, setIsZipping] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  const jsonData = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    loginName,
    totalCases: records.length,
    testCases: records.map((r) => ({
      id: r.id,
      caseName: r.caseName,
      formatType: r.formatType,
      moduleID: r.moduleID,
      stage: r.stage,
      base: { batch: r.baseBatch, index: r.baseIndex },
      bonus: r.bonusBatch != null ? { batch: r.bonusBatch, index: r.bonusIndex } : null,
      fileName: r.fileName || 'P5P_Base game_Spins.testdata',
      xmlSnippet: r.xmlSnippet,
    })),
  }), [records, loginName]);

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      await generateOutcomeZip(records, loginName);
    } catch (e) {
      console.error(e);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
      
      {/* Header & Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> TESTDATA GENERATED
            </span>
            <h2 className="text-base font-bold text-white">TestData Specification</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
            <span className="font-mono text-emerald-300">{records.length} test cases</span> •
            <span className="text-cyan-300 flex items-center gap-1 font-mono">
              <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
              loginName: <strong>{loginName}</strong>
            </span>
          </p>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveView('JSON')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
              activeView === 'JSON' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileJson className="w-3.5 h-3.5 text-cyan-400" /> JSON View
          </button>
          <button
            onClick={() => setActiveView('XML')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
              activeView === 'XML' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-emerald-400" /> XML Spec
          </button>
        </div>
      </div>

      {/* JSON Structured View */}
      {activeView === 'JSON' && (
        <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto">
          {/* Summary card */}
          <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-emerald-400 font-bold">{jsonData.totalCases}</span> cases
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-cyan-400 font-bold">
                {jsonData.testCases.filter((c) => c.formatType === 'DOUBLE_PREGEN').length}
              </span> double-pregen
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="font-mono text-purple-400 font-bold">
                {jsonData.testCases.filter((c) => c.stage === 'Bonus').length}
              </span> bonus
            </div>
          </div>

          {/* JSON tree */}
          <div className="flex flex-col gap-1.5">
            {jsonData.testCases.map((tc, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <div key={tc.id} className="rounded-xl border border-slate-800 overflow-hidden">
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-950/40 hover:bg-slate-950/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-mono ${isExpanded ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                      <span className="text-xs font-mono text-slate-500">{tc.id}</span>
                      <span className="text-xs font-semibold text-slate-200">{tc.caseName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        tc.formatType === 'DOUBLE_PREGEN'
                          ? 'bg-purple-950/60 text-purple-300 border border-purple-800/50'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}>
                        {tc.formatType}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">({tc.base.batch},{tc.base.index})</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 bg-slate-950/20">
                      <pre className="text-[10px] text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap bg-slate-950/60 p-3 rounded-lg border border-slate-800/60 leading-relaxed">
{`{
  "id": "${tc.id}",
  "caseName": "${tc.caseName}",
  "formatType": "${tc.formatType}",
  "moduleID": "${tc.moduleID}",
  "stage": "${tc.stage}",
  "base": { "batch": ${tc.base.batch}, "index": ${tc.base.index} },
  "bonus": ${tc.bonus ? `{ "batch": ${tc.bonus.batch}, "index": ${tc.bonus.index} }` : null},
  "fileName": "${tc.fileName}"
}`}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeView === 'XML' && <XmlViewer records={records} loginName={loginName} />}

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <button
          onClick={onRegenerate}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition flex items-center gap-1.5"
        >
          <Edit3 className="w-3.5 h-3.5 text-amber-400" />
          Edit / Regenerate
        </button>

        <button
          onClick={handleDownloadZip}
          disabled={isZipping}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-bold text-xs shadow-lg flex items-center gap-2 transition transform active:scale-95"
        >
          <Download className="w-4 h-4" />
          <span>{isZipping ? 'Packaging outcome.zip...' : `Download outcome.zip (${loginName})`}</span>
        </button>
      </div>
    </div>
  );
};
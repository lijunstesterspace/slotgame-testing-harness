import React, { useState } from 'react';
import { 
  Table, 
  Code, 
  Download, 
  CheckCircle2, 
  Edit3,
  UserCheck
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
  const [activeView, setActiveView] = useState<'TABLE' | 'XML'>('TABLE');
  const [isZipping, setIsZipping] = useState(false);

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
      
      {/* 1. Header & Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> TESTDATA GENERATED
            </span>
            <h2 className="text-base font-bold text-white">Generated TestData Specification Preview</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
            <span>{records.length} Test Cases generated</span> • 
            <span className="text-cyan-300 flex items-center gap-1 font-mono">
              <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
              loginName / username: <strong>{loginName}</strong>
            </span>
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveView('TABLE')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
              activeView === 'TABLE' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Table className="w-3.5 h-3.5 text-cyan-400" /> Data Table
          </button>

          <button
            onClick={() => setActiveView('XML')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 ${
              activeView === 'XML' ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5 text-emerald-400" /> XML Spec (.testdata)
          </button>
        </div>
      </div>

      {/* 2. Main Content View */}
      {activeView === 'TABLE' && (
        <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[380px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-semibold uppercase text-[10px] tracking-wider sticky top-0 z-10">
                <th className="py-3 px-3">Case ID</th>
                <th className="py-3 px-3">Test Scenario Name</th>
                <th className="py-3 px-3">Target .testdata File</th>
                <th className="py-3 px-3">Format & Type</th>
                <th className="py-3 px-3">Base (Batch, Index)</th>
                <th className="py-3 px-3">Bonus (Batch, Index)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {records.map((rec) => (
                <tr
                  key={rec.id}
                  className="hover:bg-slate-800/50 transition"
                >
                  <td className="py-2.5 px-3 text-slate-400 font-bold">{rec.id}</td>
                  <td className="py-2.5 px-3 font-sans font-semibold text-slate-100">{rec.caseName}</td>
                  <td className="py-2.5 px-3 text-emerald-400 font-bold truncate max-w-[200px]" title={rec.fileName}>
                    {rec.fileName || 'P5P_Base game_Spins.testdata'}
                  </td>
                  <td className="py-2.5 px-3">
                    {rec.formatType === 'DOUBLE_PREGEN' ? (
                      <span className="px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/50 text-[10px] font-bold">
                        Double PreGen (Bonus)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">
                        Single Spin
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-cyan-300 font-bold">({rec.baseBatch}, {rec.baseIndex})</td>
                  <td className="py-2.5 px-3 text-purple-300">
                    {rec.bonusBatch !== undefined ? `(${rec.bonusBatch}, ${rec.bonusIndex})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeView === 'XML' && <XmlViewer records={records} loginName={loginName} />}

      {/* 3. Primary Action Toolbar */}
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
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 font-bold text-xs shadow-lg glow-emerald flex items-center gap-2 transition transform active:scale-95"
        >
          <Download className="w-4 h-4" />
          <span>{isZipping ? 'Packaging outcome.zip...' : `📥 Download outcome.zip (${loginName})`}</span>
        </button>
      </div>

    </div>
  );
};

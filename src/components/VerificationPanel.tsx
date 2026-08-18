import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  FlaskConical, 
  RefreshCw, 
  Sliders, 
  UserCheck,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { VerificationConfig } from '../types';
import { parseGameUrlParams } from '../utils/urlParser';

interface VerificationPanelProps {
  onStartVerification: (config: VerificationConfig) => void;
  isVerifying: boolean;
  loginName: string;
  setLoginName: (name: string) => void;
}

const DEFAULT_REAL_URL = `https://mobile-app1-gtp537.installprogram.eu/htmlGames/4.54.0/launch/mgs/phoenix5Prosperity?displayName=Phoenix+5+Prosperity&moduleId=105359&clientId=40300&gamePath=&clientTypeId=40&gameId=phoenix5Prosperity&languageCode=EN&productId=5007&market=dotcom&brand=islandparadise&loginType=InterimUPE&returnUrl=https://mobile-app1-gtp537.installprogram.eu/lobby/EN/IslandParadise/games/&routerEndPoints=&currencyFormat=&isPracticePlay=False&username=&password=test1234$&formFactor=mobile`;

export const VerificationPanel: React.FC<VerificationPanelProps> = ({
  onStartVerification,
  isVerifying,
  loginName,
  setLoginName
}) => {
  const [targetUrl, setTargetUrl] = useState<string>(DEFAULT_REAL_URL);
  const [spinDelayMs, setSpinDelayMs] = useState<number>(300);
  const [timeoutMs, setTimeoutMs] = useState<number>(5000);
  const [authToken, setAuthToken] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [autoExtractedUsername, setAutoExtractedUsername] = useState<string | null>(null);

  // Auto-extract username from URL input
  useEffect(() => {
    if (!targetUrl) return;
    const parsed = parseGameUrlParams(targetUrl);
    if (parsed.username) {
      setAutoExtractedUsername(parsed.username);
      setLoginName(parsed.username);
    }
  }, [targetUrl, setLoginName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUrl.trim()) return;

    onStartVerification({
      targetUrl: targetUrl.trim(),
      spinDelayMs,
      timeoutMs,
      autoRetryServerError: true,
      authToken: authToken.trim() || undefined
    });
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4 relative overflow-hidden">
      {/* Glow Effect */}
      <div className="absolute top-0 right-0 -mt-12 -mr-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

      {/* Panel Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Stage 2: Real Game Environment Verification</h2>
            <p className="text-xs text-slate-400">Input target game URL to verify seed acceptance & loginName mapping</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Endpoint Input Field */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-cyan-400" />
              Target Real Game URL
            </span>
            {autoExtractedUsername && (
              <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Auto-Extracted username: <strong className="font-mono text-emerald-300">{autoExtractedUsername}</strong>
              </span>
            )}
          </label>

          <div className="relative">
            <input
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://mobile-app1-gtp537.installprogram.eu/...&username=lijunt..."
              className="w-full pl-3 pr-24 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/30 font-mono transition"
            />
            <button
              type="button"
              onClick={() => setTargetUrl(DEFAULT_REAL_URL)}
              className="absolute right-1.5 top-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 transition"
            >
              Reset URL
            </button>
          </div>
        </div>

        {/* Sync loginName Parameter Field */}
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-400" />
              Synced loginName / username for .testdata XML Key tag
            </span>
            <span className="text-[10px] text-slate-400">Maps URL username to XML loginName</span>
          </label>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="e.g. tester01"
              className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
            />
            <div className="px-2.5 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-[11px] text-emerald-300 font-mono">
              &lt;Key loginName="{loginName}" /&gt;
            </div>
          </div>
        </div>

        {/* Advanced Connection Config Toggle */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>Connection & Latency Settings</span>
          </button>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 font-medium">Spin Delay Interval (ms)</label>
                <input
                  type="number"
                  value={spinDelayMs}
                  onChange={(e) => setSpinDelayMs(Number(e.target.value))}
                  min={50}
                  max={2000}
                  className="w-full mt-1 p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 font-medium">Timeout Threshold (ms)</label>
                <input
                  type="number"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  min={1000}
                  max={30000}
                  className="w-full mt-1 p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono text-[11px]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-[11px] text-slate-400 font-medium">Auth Bearer Token (Optional)</label>
                <input
                  type="text"
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="Bearer eyJhbGciOiJIUzI1Ni..."
                  className="w-full mt-1 p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 font-mono text-[11px]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Start Verification CTA Button */}
        <button
          type="submit"
          disabled={isVerifying || !targetUrl.trim()}
          className={`w-full py-3.5 px-6 rounded-xl font-bold text-sm text-slate-950 flex items-center justify-center gap-2 shadow-lg transition transform active:scale-[0.99] ${
            isVerifying
              ? 'bg-cyan-400 cursor-not-allowed opacity-90'
              : 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 glow-cyan'
          }`}
        >
          {isVerifying ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Verifying TestData Against Game Engine...</span>
            </>
          ) : (
            <>
              <FlaskConical className="w-4 h-4 text-slate-950" />
              <span>▶ Start Real Game Environment Verification</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};

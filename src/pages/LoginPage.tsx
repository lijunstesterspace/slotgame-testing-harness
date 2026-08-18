import React, { useState } from "react";
import { harnessClient } from "../harness/client";
import { Bot, Lock, LogIn, ShieldCheck, AlertTriangle } from "lucide-react";

export const LoginPage: React.FC<{ onLoggedIn: () => void }> = ({ onLoggedIn }) => {
  const [u, setU] = useState("qa-tester-1");
  const [p, setP] = useState("test1234");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await harnessClient.login(u, p);
      onLoggedIn();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-slate-100 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 backdrop-blur"
      >
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Slot AI HARNESS</h1>
            <p className="text-xs text-slate-400">登录以进入 Agent 工作台</p>
          </div>
        </div>

        <div className="rounded-xl bg-emerald-950/20 border border-emerald-800/40 p-3 flex gap-2 text-[11px] text-emerald-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <span>
            默认已内置 3 个测试账号 <b>qa-tester-1/2/3</b> + 1 个管理员 <b>admin</b>，密码见部署者 <code>.env</code>。LLM 默认通过您本机 <b>Ollama :11434</b> 处理，原始数据不会离开您的电脑。
          </span>
        </div>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-slate-300">Username</span>
          <input
            value={u}
            onChange={(e) => setU(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-slate-950/80 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30"
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-semibold text-slate-300 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Password</span>
          <input
            type="password"
            value={p}
            onChange={(e) => setP(e.target.value)}
            className="px-3 py-2.5 rounded-lg bg-slate-950/80 border border-slate-700 text-sm focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30"
          />
        </label>

        {err && (
          <div className="rounded-lg bg-rose-950/30 border border-rose-800/50 p-3 text-[11px] text-rose-200 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !u || !p}
          className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 text-slate-950 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <LogIn className="w-4 h-4" /> {loading ? "登录中..." : "进入 HARNESS 工作台"}
        </button>

        <p className="text-[10px] text-slate-500 text-center">
          © Internal QA Tool · LLM 默认本地 Ollama，外部 Provider 需勾选合规确认
        </p>
      </form>
    </div>
  );
};

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Terminal, Copy, Check, Sparkles, User, Bot,
  ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown,
  Trash2, Loader2, MessageSquare, Wrench
} from 'lucide-react';
import { ToolCallLog } from '../types';

// ── Props ──────────────────────────────────────────────────────
interface ExecutionConsoleProps {
  logs: ToolCallLog[];
  onClearLogs?: () => void;
}

// ── Internal Types ─────────────────────────────────────────────
interface ChatRound {
  id: string;
  roundIndex: number;
  userLog: ToolCallLog;
  aiLog?: ToolCallLog;
  intermediateLogs: ToolCallLog[];
  isComplete: boolean;
  timestamp: string;
}

type DisplayBlock =
  | { kind: 'round'; round: ChatRound }
  | { kind: 'log'; log: ToolCallLog };

// ── Component ──────────────────────────────────────────────────
export const ExecutionConsole: React.FC<ExecutionConsoleProps> = ({ logs, onClearLogs }) => {
  const [activeTab, setActiveTab] = useState<'COT' | 'RAW_TOOLS'>('COT');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [historyFolded, setHistoryFolded] = useState(true);
  const [isConsoleMinimized, setIsConsoleMinimized] = useState(false);
  const [expandedRounds, setExpandedRounds] = useState<Record<string, boolean>>({});

  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Parse logs into structured DisplayBlocks (detecting dialogue rounds)
  const { displayBlocks, totalRounds } = useMemo(() => {
    const blocks: DisplayBlock[] = [];
    let currentRound: ChatRound | null = null;
    let roundIndex = 0;

    for (const log of logs) {
      const isUser = log.type === 'HARNESS_EVENT' && log.content.startsWith('You: ');
      const isAi =
        log.type === 'HARNESS_EVENT' &&
        (log.content.startsWith('AI: ') || log.content.startsWith('AI chat unavailable:'));

      if (isUser) {
        if (currentRound) {
          blocks.push({ kind: 'round', round: currentRound });
        }
        roundIndex += 1;
        currentRound = {
          id: log.id,
          roundIndex,
          userLog: log,
          aiLog: undefined,
          intermediateLogs: [],
          isComplete: false,
          timestamp: log.timestamp,
        };
      } else if (currentRound && isAi && !currentRound.aiLog) {
        currentRound.aiLog = log;
        currentRound.isComplete = true;
        blocks.push({ kind: 'round', round: currentRound });
        currentRound = null;
      } else if (currentRound) {
        currentRound.intermediateLogs.push(log);
      } else {
        blocks.push({ kind: 'log', log });
      }
    }

    if (currentRound) {
      blocks.push({ kind: 'round', round: currentRound });
    }

    const roundCount = blocks.filter((b) => b.kind === 'round').length;
    return { displayBlocks: blocks, totalRounds: roundCount };
  }, [logs]);

  // Auto-scroll inside terminal container
  useEffect(() => {
    if (autoScroll && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, historyFolded, expandedRounds, isConsoleMinimized, activeTab]);

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => `[${l.timestamp}] [${l.type}] ${l.toolName ? `[${l.toolName}] ` : ''}${l.content}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleAllHistory = () => {
    setHistoryFolded((prev) => !prev);
  };

  const toggleRound = (roundId: string, currentlyExpanded: boolean) => {
    setExpandedRounds((prev) => ({
      ...prev,
      [roundId]: !currentlyExpanded,
    }));
  };

  const isRoundExpanded = (round: ChatRound, isLatest: boolean) => {
    // Latest active round is always expanded
    if (isLatest) return true;
    if (expandedRounds[round.id] !== undefined) {
      return expandedRounds[round.id];
    }
    return !historyFolded;
  };

  // Filter logs for RAW_TOOLS tab
  const rawToolLogs = useMemo(() => {
    return logs.filter((l) => l.type === 'TOOL_CALL' || l.type === 'TOOL_RES');
  }, [logs]);

  return (
    <div
      className={`flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl min-h-0 transition-all duration-200 ${
        isConsoleMinimized ? 'flex-shrink-0 h-[46px]' : 'flex-1 overflow-hidden'
      }`}
    >
      {/* ── Terminal Header ── */}
      <div className="bg-slate-900/95 px-4 py-2 border-b border-slate-800 flex items-center justify-between flex-shrink-0 gap-2">
        {/* Title + Status Badge */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 flex-shrink-0">
            <Terminal className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-slate-200 truncate">Execution Console</span>
            {totalRounds > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 hidden sm:inline-flex items-center gap-1">
                <MessageSquare className="w-2.5 h-2.5" />
                {totalRounds} {totalRounds === 1 ? 'round' : 'rounds'}
              </span>
            )}
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Tabs */}
          {!isConsoleMinimized && (
            <div className="flex items-center gap-1 mr-1">
              <button
                onClick={() => setActiveTab('COT')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition ${
                  activeTab === 'COT'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                COT Logs
              </button>
              <button
                onClick={() => setActiveTab('RAW_TOOLS')}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition flex items-center gap-1 ${
                  activeTab === 'RAW_TOOLS'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wrench className="w-3 h-3" />
                Tool Payloads
                {rawToolLogs.length > 0 && (
                  <span className="ml-0.5 text-[9px] px-1 py-0.2 rounded bg-cyan-900/60 text-cyan-300">
                    {rawToolLogs.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Fold/Unfold Dialogue History Button (when multi-round chat exists) */}
          {!isConsoleMinimized && activeTab === 'COT' && totalRounds > 1 && (
            <button
              onClick={toggleAllHistory}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition border ${
                historyFolded
                  ? 'bg-amber-950/40 text-amber-300 border-amber-800/50 hover:bg-amber-900/40'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-700'
              }`}
              title={historyFolded ? 'Expand all conversation history' : 'Fold all conversation history'}
            >
              <ChevronsUpDown className="w-3 h-3 text-amber-400" />
              <span>{historyFolded ? `Fold History (${totalRounds - 1})` : 'Expand History'}</span>
            </button>
          )}

          {/* Auto-scroll */}
          {!isConsoleMinimized && (
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`p-1.5 rounded text-[10px] transition ${
                autoScroll ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-500 hover:text-slate-300'
              }`}
              title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
            >
              <span className="font-mono">{autoScroll ? 'A⇣' : 'A⇢'}</span>
            </button>
          )}

          {/* Copy logs */}
          <button
            onClick={handleCopyLogs}
            className="p-1.5 rounded text-[10px] text-slate-400 hover:text-slate-200 transition"
            title="Copy logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Clear logs */}
          {onClearLogs && logs.length > 0 && (
            <button
              onClick={onClearLogs}
              className="p-1.5 rounded text-[10px] text-slate-400 hover:text-red-400 transition"
              title="Clear conversation & execution logs"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Minimize / Expand Console */}
          <button
            onClick={() => setIsConsoleMinimized(!isConsoleMinimized)}
            className="p-1.5 rounded text-[10px] text-slate-400 hover:text-cyan-400 transition ml-1"
            title={isConsoleMinimized ? 'Expand console' : 'Minimize console'}
          >
            {isConsoleMinimized ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Terminal Content ── */}
      {!isConsoleMinimized && (
        <div
          ref={terminalContainerRef}
          className="flex-1 min-h-0 p-4 overflow-y-auto flex flex-col gap-3 font-mono text-[11px] leading-relaxed bg-slate-950 select-text"
        >
          {logs.length === 0 ? (
            <div className="text-slate-600 italic p-6 text-center flex flex-col items-center justify-center h-full gap-2">
              <Terminal className="w-6 h-6 text-slate-700" />
              <span>Execution console idle. Type a message or start a task to begin...</span>
            </div>
          ) : activeTab === 'RAW_TOOLS' ? (
            /* ── RAW_TOOLS View ── */
            rawToolLogs.length === 0 ? (
              <div className="text-slate-600 italic p-4 text-center">
                No tool payloads dispatched yet.
              </div>
            ) : (
              rawToolLogs.map((log) => {
                if (log.type === 'TOOL_CALL') {
                  return (
                    <div
                      key={log.id}
                      className="text-cyan-300 flex items-start gap-2 bg-cyan-950/20 p-2.5 rounded-lg border border-cyan-900/30"
                    >
                      <span className="text-slate-600 flex-shrink-0 text-[10px]">[{log.timestamp}]</span>
                      <span className="text-cyan-400 font-bold flex-shrink-0 text-[10px]">[TOOL CALL]</span>
                      <span className="font-bold text-white">{log.toolName}</span>
                      <span className="text-cyan-200/90 break-words">{log.content}</span>
                    </div>
                  );
                }
                return (
                  <div key={log.id} className="text-slate-400 pl-4 border-l-2 border-slate-700 my-0.5">
                    <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {log.content}
                    </pre>
                  </div>
                );
              })
            )
          ) : (
            /* ── COT View (Dialogue Rounds + Events) ── */
            <>
              {/* Folded history summary banner at the top if there are multiple rounds */}
              {totalRounds > 1 && (
                <div
                  onClick={toggleAllHistory}
                  className="flex items-center justify-between px-3.5 py-2 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-xl cursor-pointer transition text-xs font-mono group"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-amber-950/60 border border-amber-800/40 text-amber-400 group-hover:scale-105 transition">
                      <ChevronsUpDown className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-slate-300 font-medium">
                      {historyFolded ? (
                        <>
                          Folded previous <span className="text-amber-400 font-bold">{totalRounds - 1}</span> {totalRounds - 1 === 1 ? 'round' : 'rounds'} of history
                        </>
                      ) : (
                        <>All conversation history expanded ({totalRounds - 1} {totalRounds - 1 === 1 ? 'round' : 'rounds'})</>
                      )}
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-amber-400 group-hover:text-amber-300 flex items-center gap-1">
                    {historyFolded ? (
                      <>
                        Expand History <ChevronDown className="w-3.5 h-3.5" />
                      </>
                    ) : (
                      <>
                        Fold History <ChevronUp className="w-3.5 h-3.5" />
                      </>
                    )}
                  </span>
                </div>
              )}

              {/* Render display blocks */}
              {displayBlocks.map((block, idx) => {
                if (block.kind === 'log') {
                  const log = block.log;
                  if (log.type === 'THOUGHT') {
                    return (
                      <div key={log.id} className="text-slate-300 flex items-start gap-2 px-1">
                        <span className="text-slate-600 flex-shrink-0 text-[10px]">[{log.timestamp}]</span>
                        <span className="text-emerald-400 font-bold flex-shrink-0 text-[10px]">[THOUGHT]</span>
                        <span className="text-slate-200">{log.content}</span>
                      </div>
                    );
                  }

                  if (log.type === 'TOOL_CALL') {
                    return (
                      <div
                        key={log.id}
                        className="text-cyan-300 flex items-start gap-2 bg-cyan-950/20 p-2 rounded-lg border border-cyan-900/30"
                      >
                        <span className="text-slate-600 flex-shrink-0 text-[10px]">[{log.timestamp}]</span>
                        <span className="text-cyan-400 font-bold flex-shrink-0 text-[10px]">[TOOL CALL]</span>
                        <span className="font-bold text-white">{log.toolName}</span>
                        <span className="text-cyan-200/90">{log.content}</span>
                      </div>
                    );
                  }

                  if (log.type === 'TOOL_RES') {
                    return (
                      <div key={log.id} className="text-slate-400 pl-4 border-l-2 border-slate-700 my-0.5">
                        <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap">
                          {log.content}
                        </pre>
                      </div>
                    );
                  }

                  if (log.type === 'SELF_HEAL') {
                    return (
                      <div
                        key={log.id}
                        className="text-amber-300 bg-amber-950/30 p-2 rounded-lg border border-amber-700/50 flex items-start gap-2"
                      >
                        <span className="text-amber-400 font-bold text-[10px]">[SELF-HEAL]</span>
                        <span className="text-slate-200">{log.content}</span>
                      </div>
                    );
                  }

                  if (log.type === 'HARNESS_EVENT') {
                    return (
                      <div
                        key={log.id}
                        className="text-slate-300 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                          <span className="text-slate-200">{log.content}</span>
                        </div>
                        <span className="text-slate-600 text-[10px] flex-shrink-0 ml-2">[{log.timestamp}]</span>
                      </div>
                    );
                  }

                  return null;
                }

                // Block is a ChatRound
                const round = block.round;
                const isLatest = round.roundIndex === totalRounds;
                const expanded = isRoundExpanded(round, isLatest);
                const userText = round.userLog.content.replace(/^You:\s*/i, '');
                const aiText = round.aiLog ? round.aiLog.content.replace(/^AI:\s*/i, '') : '';

                if (!expanded) {
                  // Collapsed Round: Compact 1-line summary card
                  return (
                    <div
                      key={round.id}
                      onClick={() => toggleRound(round.id, false)}
                      className="flex items-center justify-between gap-3 px-3 py-2 bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 rounded-xl cursor-pointer transition text-xs font-mono group"
                      title="Click to expand this round"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="p-1 rounded bg-slate-800 text-slate-400 group-hover:text-cyan-400 transition flex-shrink-0">
                          <ChevronRight className="w-3 h-3" />
                        </div>
                        <span className="text-[10px] font-bold text-cyan-400 flex-shrink-0 bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.5 rounded">
                          Round #{round.roundIndex}
                        </span>
                        <span className="text-slate-300 font-semibold truncate flex-shrink-0 max-w-[130px]">
                          You: {userText}
                        </span>
                        <span className="text-slate-500 flex-shrink-0">➔</span>
                        <span className="text-slate-400 truncate flex-1">
                          {aiText ? `AI: ${aiText}` : 'AI: (Thinking...)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-slate-500">[{round.timestamp}]</span>
                        <span className="text-[10px] text-cyan-400 group-hover:underline">Expand ▾</span>
                      </div>
                    </div>
                  );
                }

                // Expanded Round: Full card with User & AI messages
                return (
                  <div
                    key={round.id}
                    className={`flex flex-col gap-2 rounded-2xl p-3 border transition ${
                      isLatest
                        ? 'bg-slate-900/80 border-emerald-900/40 shadow-lg'
                        : 'bg-slate-900/50 border-slate-800'
                    }`}
                  >
                    {/* Round Header Bar */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded-full">
                          Round #{round.roundIndex} {isLatest && '· Current'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">[{round.timestamp}]</span>
                      </div>

                      {!isLatest && (
                        <button
                          onClick={() => toggleRound(round.id, true)}
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-400 font-mono"
                          title="Collapse this round"
                        >
                          Collapse <ChevronUp className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* User Message Bubble */}
                    <div className="flex items-start gap-2.5 bg-slate-950/60 border border-indigo-900/30 rounded-xl p-3 shadow-sm">
                      <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                        <User className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-indigo-300">You</span>
                        </div>
                        <div className="text-xs text-slate-100 font-mono whitespace-pre-wrap break-words leading-relaxed">
                          {userText}
                        </div>
                      </div>
                    </div>

                    {/* Intermediate logs if any */}
                    {round.intermediateLogs.length > 0 && (
                      <div className="space-y-1.5 pl-3 border-l-2 border-slate-800 my-1">
                        {round.intermediateLogs.map((iLog) => (
                          <div key={iLog.id} className="text-slate-400 text-[10px] flex items-center gap-1.5">
                            <span className="text-cyan-400">●</span>
                            <span>{iLog.content}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* AI Message Bubble */}
                    {round.aiLog ? (
                      <div className="flex items-start gap-2.5 bg-slate-950/70 border border-emerald-900/40 rounded-xl p-3 shadow-sm">
                        <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center flex-shrink-0 text-[10px] font-bold mt-0.5">
                          <Bot className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                              AI Assistant
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">[{round.aiLog.timestamp}]</span>
                          </div>
                          <div className="text-xs text-slate-200 font-mono whitespace-pre-wrap break-words leading-relaxed">
                            {aiText}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-3 text-xs text-cyan-400 font-mono bg-cyan-950/20 border border-cyan-900/30 rounded-xl">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                        <span>AI is thinking & responding...</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};

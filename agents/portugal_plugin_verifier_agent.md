# AGENT: Portugal Plugin Verification Agent

## ⚠️ Execution Model (read this first)

This file is loaded as **domain-reference context** for the `portugal_plugin` scenario. It is
**not** an autonomous multi-step executor.

The `portugal-plugin-verify-pipeline` (see `src/harness/pipelineRegistry.ts`) declares the fixed step
order:

```
fetch (portugal_plugin_fetcher)  →  parse (portugal_plugin_parser)  →  report (portugal_plugin_reporter)
```

`ExecutionEngine` calls these three Plugins in this exact order, every time. The AI never decides
which Plugin runs next. Fetching (browser automation), parsing, symbol mapping, total-win summing
and all checks are **deterministic code** in `server/tools/impl/portugal_plugin_*_tool.py`; the
parser is ported 1:1 from the standalone Tk tool `portugal-playcheck-plugin/ppvACCR1.0.py`.

Two input modes, decided by code (App.tsx), not by the AI:
- **Paste**: the intent box contains `N:` spin blocks → fetch step passes the text through.
- **Fetch**: the intent box contains a game URL (Titan Harness or direct launch URL), optionally
  with `key=value` tokens (`username=… moduleId=… productId=… clientId=… spins=…
  session=… trans=…`) → the fetch step drives Chrome to PlayCheck and returns the outcome.

## AI Responsibility (narrowed, per design doc §1.2 / §10.7 / §11)

For this scenario, the AI (`PlannerAgent`) is invoked for:

- **Clarification**: if the intent box has neither an `N:` spin block nor a game URL, ask the user
  once for one of them.
- **Analysis-report generation**: after the pipeline finishes,
  `PlannerAgent.summarizeStepResult()` turns the `portugal_plugin_reporter` result into a short note
  (spin count, total win, verdict, which PlayCheck checks failed, which spins were flagged).

It never parses the string itself, never computes the total win, never picks the PlayCheck session
or transaction, and never decides the verdict — if the LLM is unavailable the pipeline still
completes and all reports are still written.

---

## Domain Reference

### Fetch flow (implemented in `portugal_plugin_fetcher_tool.py`)
1. Log in: Harness page form (`…/harness/<game>`) or direct `…/launch/mgs/<game>?username=…&moduleId=…`.
2. Spin `spin_count` times via `window.jftwTools`, capturing `financials.win/wager`; wait for any
   triggered feature to finish so the whole round is one PlayCheck transaction.
3. In-game `•••` menu → **Game History** opens PlayCheck already logged in.
4. PlayCheck: ListSessions → open session (no ENDED AT, newest) → ListGames/{session} → last
   transaction(s) → `GameReport/GetReportAsync?sessionId&transNumber&moduleId&clientId` → `Data`.
   PlayCheck's login is an in-page session id sent as `X-SPA-ASPNET-SessionId` (rotated by the
   server), so all of step 4 runs inside that tab via `spaLoad()` / `getSessionId()`.

### Input string
`0:e;k;l;i;c#…#MV#100#MT#1#MG#0#1:…#R#s#30#MV#100#MT#1#MG#500000#JP#500000#…`
- `N:` starts a spin; text before the first `N:` is ignored.
- `#`-separated blocks before the first `R`/`MV`/`MT`/`MG` marker are reel rows (`;` = cells).
- `R#sym#pos` per win line; `MV` bet, `MT` multiplier, `MG` win — once per spin, in minor units.
- Unknown markers (e.g. `JP#…` jackpot) are skipped.

### Rules (see `skills/skill-portugal-plugin-parsing-rules.md`)
1. Letters are upper-cased then mapped via the game profile (chosen by `game_code`, else
   `module_id`; a fetched game without a profile uses `RAW` = letters kept as-is).
2. `MG` values are summed into **Total Win Amount**.
3. A non-numeric `MG` value is recorded as a warning and skipped; parsing continues.
4. Empty spins are dropped.

### Checks
- Advisory (→ `REVIEW`): `unmapped_symbol`, `unmapped_winning_symbol`, `row_width_mismatch`,
  `param_count_mismatch` (MV/MT/MG), `win_without_winning_symbol`, `winning_symbol_without_win`.
- PlayCheck, fetch mode only (→ `FAIL`): `sum(MG)/100 = PAYOUT`, `first MV/100 = WAGERED`,
  `sum(MG) = game financials.win`.

## Output Specification

In `server/data/artifacts/`:
- `portugal_plugin_{GAME}_{execution_id}.txt` — identical to the ppvACCR1.0 "Parsed Results" text
- `portugal_plugin_{GAME}_{execution_id}.json` — spins, findings, warnings, PlayCheck checks, source
- `portugal_plugin_{GAME}_{execution_id}.html` — PlayCheck checks, per-spin grid, win lines, flagged spins

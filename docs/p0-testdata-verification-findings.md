# P0 Findings — TestData Verification Refactor

Investigated 2026-10-21 against the local game client (game095-client, Mega Eagle 2 Ultra Link Win,
`@jftw/slot-core` 52.2.16) served at `http://localhost:5241`, backend gtp603, test account `lijunt`.

## 1. Environment

- Only the **client** runs locally (`jft s --gtp=dev`, browser-sync). Every spin goes to
  `https://api5-rhel1-gtp603.installprogram.eu/casino/play/public/v1/games/module/<moduleId>/client/<clientId>/play`.
  `jft.manifest.json` → `"axiomGTP": 603`, main moduleId 104938 (+ RTP variants 104939/104940/104941).
- **browser-sync reloads the page** when the client is rebuilt. A reload during a run kills the session;
  the harness must detect it (performance.now reset / jftwTools re-attach) and fail the round explicitly.
- **A hidden / occluded page does not render**, and the game's state machine does not advance
  (observed: stuck at `PostInit` until the pane was shown, then it progressed immediately).
  Playwright should run headless, or Chrome must be started with
  `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`.
- Page-level `fetch`/`XMLHttpRequest` hooks installed after load **did not see** `/casino/play`.
  Capture must happen at the network layer (Playwright `page.on("response")`).

## 2. Protocol

**On the wire** (Playwright network capture): a JSON envelope around an XML packet —
`{ context: { financials, balances }, packet: { payload: "<Pkt version=\"5\"><Id verb=\"Spin\"/><Response>…</Response></Pkt>" } }`.
The request is the same envelope with `<Request verb="Spin" chipSize numChips/>`. Inside the XML,
`<Logic><…><Pregen checksum=…/>` is the opaque feature checksum, not a seed; the testdata seed is under `<TestData>`.
Parsed by `server/game_session/protocol.py`; real bodies are in `tests/fixtures/mega_eagle2/`.

**In the page** (`jftwTools.response.getLatestGameResponse()`) the client's own JSON conversion:
`{ id: { verb }, version: 5, gameResponse: { game, player, bet, slot, testData?, financials } }`

| verb | when | carries `testData`? |
|---|---|---|
| `Refresh` | page load (restores an unfinished round) | no |
| `Spin` | player spin (BaseGame) | **yes**: `testData.spin = { preGen: {batch, index}, stage, comment }` |
| `Bonus` | every bonus step, auto-played | **no** — only `slot.stages[i].logic.pregen.checksum` (opaque) |
| `Freespin`, `Respin`, `BonusPick`, `Jackpot` | per slot-core `GameServerVerb` | not yet observed |

- `gameResponse.slot = { stages[], stage, index, nextStage, nextIndex }`; each stage has
  `name` (`BaseGame`, `LinkAndWin`, …), `state`, `financials`, `logic.pregen.checksum`.
- `player.transNumber` stays the same for the whole round (Spin + all Bonus steps) → one PlayCheck transaction.
- Round end: the last Bonus response has `nextStage: "BaseGame"` and the final win
  (`financials.win`, `totalWin`, `player.balance`).

**Feature seeds:** the feature responses' `logic.pregen.checksum` cannot be mapped back to a PreGen
(confirmed with the backend, 2026-10-21). But the triggering **Spin response's `<TestData>` echoes the whole
consumed .testdata `<Spin>` record verbatim** — confirmed live with `test.testdata` uploaded to gtp603:

    <TestData><Spin stage="BaseGame"><Meter state="0" token="0" /><PreGen batch="140" index="16" />
      <Feature><PreGen batch="8" index="2587"></PreGen></Feature></Spin></TestData>

So every seed of a record (base + nested `<Feature>` PreGens) and its controls (`Meter`/`Token`/`Random`) are
verified by comparing the uploaded record with this echo. Feature *behaviour* (expected stage triggered via
`slot.nextStage`, play completed back to BaseGame, financials consistent) is checked on top of that.

Live run, same file (headless, 1280×720, timeScale 400): play 1 = Spin(140,16) → 8 `Bonus` steps → back to
BaseGame in 33 s, intro START found on the second touch point, outro dismissed; play 2 = Spin(5,0) big win.
State path: `SpinStart > SpinStop > COLLECT_POTS > InitialWinRun > BONUS_TRANSITION > BonusIntro > BonusIntroOut >
BONUS_ONBOARDING > TRIGGER_FEATURE_SYMBOLS > BONUS_SPIN > BONUS_STOPPED > UNLOCK_ROW > BONUS_COLLECT_ALL_COINS >
BONUS_BIG_WIN > BonusOutro > Idle`.

**.testdata shapes seen so far** (all must be supported by the planner):
- features nested in the base record: `<Spin stage="BaseGame"><PreGen/><Feature><PreGen/></Feature></Spin>` (Mega Eagle 2);
- features as separate records: `<Spin stage="BaseGame">…</Spin><Spin stage="FreeSpin"><PreGen/></Spin>` (Legendary Lawman 2);
- controls inside a record: `<Meter state token>`, `<Token spinCount bronze silver gold>`, `<Random fsDraw …Upgrade>`;
- `<Key loginName="">` — empty login name (5 of 20 Legendary Lawman 2 files).

## 3. State machine

- jftwTools (`dist/js/uiCanvas/jftwTools/api/`) provides `gameState.onGameStateEnter/Leave`,
  `isSpinButtonReady/onSpinButtonReady`, `isGamePlayActive/onGamePlayComplete`,
  `isGameRoundActive/onGameRoundComplete`, `getCurrentServerState/getNextServerState`,
  `getIsRefreshRestore`, `response.getLatestGameResponse/getRefreshResponse`.
- **`onGameRoundComplete` fires before the feature starts** (BaseGame round → `GameRoundComplete` → `Bonus`).
  The unit of verification must be the **game play**: `isGamePlayActive()` false + spin button ready.
- Games add their own states that are not in `getSlotState()` (here: `BonusIntroOut`, `TRIGGER_FEATURE_SYMBOLS`,
  `BONUS_SPIN`, `UNLOCK_ROW`, `BONUS_STOPPED`, `BONUS_COLLECT_ALL_COINS`, `BONUS_BIG_WIN`).
  State tracing must poll `getActiveGameState()` rather than subscribe to the core list only.
- Observed full play: `GamePlay → GameRoundStart → Spin… → WinPresentation → GameRoundComplete → Bonus →
  BonusStart → BonusIntro → BonusIntroOut → (BONUS_SPIN/UNLOCK_ROW/BONUS_STOPPED)* → BONUS_COLLECT_ALL_COINS →
  BONUS_BIG_WIN → BonusOutro → BonusComplete → WinCycleContainer → PreGamePlayComplete → GamePlayComplete → Idle`.

## 4. The outro problem

- slot-core's own test driver (`slotCore/plugins/testDriverPlugin/api/watchers/FreeSpinWatch.js`) waits 1–2 s
  after `FreespinIntro`/`FreespinOutro` enter, then touches `#jftw-continueButton`.
- This game's outro has **no continue button**: "PRESS ANYWHERE TO CONTINUE", backed by the full-screen
  `#jftw-skipArea`. `jftwTools.common.touch({x, y})` at screen centre dismisses it.
- **Where to touch depends on layout.** In the portrait browser pane a centre touch passed `BonusIntro`;
  headless at 1280×720 (landscape) the same intro only reacts to its **START button at bottom centre (~0.5, 0.9)**,
  and 41 centre touches over 90 s did nothing. START is a scene object, not a jftwTools UI component
  (`common.getBoundingBox` lists no such id), so it cannot be touched by id. `GameSession` rotates through
  centre / bottom-centre / lower-middle during a play and remembers the point that advanced the game.
- `jftwTools.gameEngine.timeScale(speed)` takes a **percentage** (100 = normal); `timeScale(5)` slows the game to 5 %.
- **The outro ignores input for a long time**: a touch 1.5 s after entering `BonusOutro` was ignored;
  a touch ~23 s after entering worked (count-up / coin animation must finish first).
  One-shot touches are not enough — touch repeatedly until the state leaves, with a generous timeout.
- Old tool (`testdata_verifier_harness_tool.py`) failure chain:
  1. `_has_pregen` only searches `gameResponse.testData` → feature responses never match (no testData);
  2. `_await_feature_response` then returns `new[0]` — an unrelated response — as the record's result
     → false `SEED_MISMATCH` although the game played correctly;
  3. if the window is not rendering or the outro has not accepted input yet, the next BaseGame record waits
     60 s on the outro, Spin no-ops → `TIMEOUT`; 3 in a row abort the run.

## 5. Session start

- The account can start **mid-feature** (`getIsRefreshRestore() === true`, next server state `BONUS`):
  an unfinished round from an earlier run is restored on load. The harness must finish (and log) any restored
  round before consuming the first .testdata record, or the seed queue and the record list are misaligned.
- The account already had queued testdata (`batch 312, index 0`, comment `TestMode`) before this session —
  leftover seeds from earlier uploads are real; seed-queue drift detection is needed.

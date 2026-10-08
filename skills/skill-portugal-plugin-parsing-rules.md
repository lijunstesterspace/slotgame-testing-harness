# SKILL: Portugal Plugin Output Parsing and Validation Rules

## 1. Core Purpose
Skill for parsing Portugal Plugin output strings, symbol mapping, total win calculation and consistency checks; provides constraints for the Portugal Plugin Verification Agent.
Rules derive from the standalone tool `portugal-playcheck-plugin/ppvACCR1.0.py` (Amazing Catch Cold Rush Portugal Plugin Verification Tool v1.0);
Harness output must be **identical character for character** to that tool.

## 2. Input Format

```
1:A;B;C#D;E;F#G;H;I#R#A#0,1,2#MV#10#MT#2#MG#5.0 2:Q;M;N#O;P;L#MG#1.25
```

| Fragment | Meaning |
|------|------|
| `N:` | SPIN number, starts a new SPIN |
| `X;Y;Z` | One reel row (each `#`-separated block is one row, `;` separates cells) |
| `R#<sym>#<pos>` | Winning symbol + winning positions |
| `MV#<v>` | Bet amount (Bet) |
| `MT#<v>` | Multiplier (Multiplier) |
| `MG#<v>` | Win amount (Win Amount), added to total win |

## 3. Parsing Rules

### Rule 1: SPIN Splitting
- Regex: `(\d+):(.*?)(?=\s*\d+:|$)` (DOTALL)
- Any text before the first `N:` is ignored (allows explanatory text before it in the input box)
- A SPIN whose content is empty after removing newlines and stripping is **skipped** and not counted

### Rule 2: Row Data
- Split content by `#`, drop empty fragments
- All fragments before the first parameter marker (`R` / `MV` / `MT` / `MG`, must match exactly) are row data
- A fragment containing `;` is split by `;` into columns; otherwise it is a single-column row
- Cells are **not stripped** (`A ` in `A ; B` is not mapped and is kept as is)

### Rule 3: Symbol Mapping
- Uppercase the letter before lookup: `a` → `A` → `SYM1`
- Values not in the mapping table are kept as is (e.g. `SYM1`, `Z`, `R2`)
- The winning symbol after `R` is mapped too
- The mapping table is determined by the game Profile; the `symbol_map` parameter can add/override entries
- Profile selection: explicit `game_code` > `module_id` match > in fetch mode with no match use `RAW` (keep original letters, do not apply another game's table) > paste mode defaults to `ACCR`

ACCR mapping table:

| Letter | Symbol | Letter | Symbol | Letter | Symbol |
|---|---|---|---|---|---|
| A | SYM1 | G | SYM7 | M | SYM20 |
| B | SYM2 | H | SYM8 | N | SYM21 |
| C | SYM3 | I | SYM9 | O | SYM22 |
| D | SYM4 | J | SYM10 | P | SYM23 |
| E | SYM5 | K | SYM11 | Q | SYM30 |
| F | SYM6 | L | SYM12 | | |

### Rule 4: Parameter Parsing
- `R`: requires at least 2 following fragments (`i+2 < len`), reads symbol + positions, skips 3 fragments
- `MV` / `MT`: require at least 1 following fragment, read and stored as **string** as is
- `MG`: read and convert to float, add to total win
- When an `MG` value cannot be converted to a number: record one warning, advance only 1 fragment (the value is skipped as an unknown fragment), **do not abort parsing**
- Unrecognized fragments are skipped directly (e.g. `JP#500000` Jackpot marker)

### Rule 5: Total Win
- Sum of `MG` across all SPINs, displayed with 2 decimals: `Total Win Amount: 7.50`

## 4. Text Report Format (must match the original tool)

```
Total Win Amount: 5.00
==================================================
SPIN 1
Row 1: SYM1 | SYM2 | SYM3
--------------------------------------------------
Winning Symbols: SYM1
Positions: 0,1,2
Bets: 10
Multipliers: 2
Amounts: $5.00
--------------------------------------------------
```
- When a parameter list is empty, omit the whole line

## 5. Consistency Checks (advisory, do not affect parse results)
The original tool has none of these checks, so they **only produce findings and never fail the step**:

| check | Trigger condition |
|-------|----------|
| `unmapped_symbol` | Row cell is not among the SYM values of the mapping table |
| `unmapped_winning_symbol` | Winning symbol of `R` is not among the SYM values of the mapping table |
| `row_width_mismatch` | Rows within the same SPIN have different column counts |
| `param_count_mismatch` | Counts of MV / MT / MG differ within the same SPIN (each appears once per SPIN; `MG#0` when no win) |
| `win_without_winning_symbol` | SPIN's MG total > 0 but no `R` |
| `winning_symbol_without_win` | Has `R` but MG total is 0 |

- `R` appears only on a win (once per winning line), so it is not compared with MV/MT/MG counts
- No symbol mapping checks under the `RAW` Profile

## 6. PlayCheck Reconciliation (hard, fetch mode only)
MG / MV are recorded in minimum currency units (`money_divisor`, default 100). Verified with a real transaction: `sum(MG) = 525740` → $5,257.40.

| check | Pass condition |
|-------|----------|
| `payout_matches_playcheck` | `sum(MG) / 100` = PlayCheck PAYOUT of that transaction |
| `wager_matches_playcheck` | First `MV / 100` = PlayCheck WAGERED of that transaction |
| `payout_matches_game` | `sum(MG)` or `sum(MG)/100` = game response `financials.win` |

- A full round of Bonus / Free Spins is **one transaction**; all its SPINs (e.g. 0–29) are in the same string

## 7. Verdict
- `verdict = FAIL`: any PlayCheck reconciliation failed
- `verdict = REVIEW`: any finding or warning exists; needs QA manual confirmation
- `verdict = CLEAN`: none of the above

## 8. Output Constraints
- All reports are written to `server/data/artifacts/`
- Naming: `portugal_plugin_{GAME_CODE}_{execution_id}.txt / .json / .html`
- Download URL: `/api/records/artifacts/{file_name}`

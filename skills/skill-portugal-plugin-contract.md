# SKILL: Portugal Plugin Interface Contract Specification

## 1. Core Purpose
Defines the interface contract between the Portugal Plugin mapping/fetch/parse/report Plugin tool layer and the Agent layer, ensuring consistent parameter formats.

## 2. portugal_plugin_fetcher Interface Contract

**Function:** Automatically fetch the outcome string from the game environment: log in to the game → (optional) Spin → `•••` → Game History →
PlayCheck login session → transaction → `Data` of `GameReport/GetReportAsync`.
When `raw_text` is non-empty, skip the browser and pass it through directly (paste mode).

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `raw_text` | string | No | Existing outcome string; non-empty means paste mode |
| `game_url` | string | Required in fetch mode | Titan Harness page (`…/harness/<game>`) or direct launch URL (`…/launch/mgs/<game>?…`) |
| `login_name` | string | No | Defaults to `username` from game_url |
| `harness_password` | string | No | Defaults to `password` from game_url, otherwise the shared QA password |
| `module_id` / `client_id` / `product_id` / `brand` | string | No | Default to `moduleId` / `clientId` / `productId` / `brand` from game_url |
| `spin_count` | number | No | Number of Spins before fetching, default 1; 0 = fetch existing transactions |
| `session_id` | string | No | PlayCheck login session; located automatically by default |
| `trans_number` | number | No | Transaction number; defaults to the last `spin_count` transactions |
| `load_timeout_sec` | number | No | Wait limit per stage, default 60 |

**Locating rules:**
- Session: empty `ENDED AT` (not ended) first, then higher session number first; take the first session with transaction count ≥ `spin_count`
- Transaction: sort by transaction number and take the last `spin_count` (or the specified `trans_number`)
- All PlayCheck requests run inside the tab opened by Game History: navigate with `spaLoad()`, report requests carry
  `X-SPA-ASPNET-SessionId: getSessionId()`, and write back the rotated session ID from the response header (PlayCheck login is not a cookie)

**Output structure:**
```json
{
  "success": true,
  "content": {
    "source": "playcheck",
    "raw_text": "0:e;k;l;i;c#...#MG#25740#",
    "module_id": "105233", "client_id": "50300", "login_name": "lijunt",
    "session_id": "68046", "trans_number": 4,
    "expected_wager": 1.0, "expected_payout": 5257.4, "game_win": 525740,
    "outcomes": [{"trans_number": 4, "time": "9/30/2026 9:12:26 AM", "wagered": 1.0, "payout": 5257.4,
                  "session_id": "68046", "report_url": "…/GetReportAsync?…", "data": "…"}],
    "diagnostics": {"launch": "harness_form", "menu_attempts": ["dom_menu"], "jftw_ids": ["…"], "sessions": ["…"]}
  }
}
```

**Error codes (on failure, `content.diagnostics` carries diagnostic info and a screenshot is saved in the run directory):**
| error | Scenario |
|-------|------|
| `missing_input` | Neither raw_text nor game_url |
| `missing_module_or_client_id` / `missing_harness_fields` | Both URL and parameters lack required fields |
| `harness_form_field_not_found:<field>` / `game_window_not_found_after_launch` | Harness login failed |
| `game_history_not_opened` | `•••` / Game History could not be opened (see `menu_attempts` / `jftw_ids`) |
| `playcheck_session_not_ready` | PlayCheck page did not complete session exchange |
| `no_session_with_<n>_transactions` / `trans_number_not_found` | Failed to locate session or transaction |
| `get_report_failed` / `report_has_no_outcome_data` | GetReportAsync failed or has no Data |

## 3. portugal_plugin_parser Interface Contract

**Function:** Parse Portugal Plugin output string → structured SPIN data + total win + original-tool-format text

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `raw_text` | string | Yes | Portugal Plugin output string, containing one or more `N:...` SPIN blocks |
| `game_code` | string | No | Game Profile (`ACCR` / `RAW`…), determines letter→SYM mapping |
| `module_id` | string | No | When game_code is not given, select Profile by module_id; no match → `RAW` (keep original letters) |
| `symbol_map` | object | No | Mapping to add/override, e.g. `{"A": "WILD"}` |

Profile selection: `game_code` > `module_id` match > `RAW` if module_id present > `ACCR` if neither (original tool behavior).

**Output structure:**
```json
{
  "success": true,
  "content": {
    "game_code": "ACCR",
    "game_title": "Amazing Catch Cold Rush",
    "symbol_map": {"A": "SYM1", "B": "SYM2"},
    "spins": [
      {
        "SPIN": "1",
        "ROWS": [["SYM1", "SYM2", "SYM3"]],
        "WINNING_SYM": ["SYM1"],
        "WINNING_POS": ["0,1,2"],
        "BETS": ["10"],
        "MULTIPLIERS": ["2"],
        "WIN_AMOUNTS": [5.0]
      }
    ],
    "spin_count": 1,
    "total_win": 5.0,
    "warnings": [],
    "formatted_text": "Total Win Amount: 5.00\n=====..."
  }
}
```

**Error codes:**
| error | Scenario |
|-------|------|
| `empty_input` | raw_text is empty |
| `unknown_game_code:<code>` | game_code does not exist and no symbol_map provided |
| `symbol_map_must_be_object` | symbol_map is not an object |
| `no_spins_found` | No non-empty `N:` SPIN block found |

## 4. portugal_plugin_reporter Interface Contract

**Function:** Consistency checks (advisory) + PlayCheck reconciliation (hard) + output TXT / JSON / HTML reports

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `spins` | array | Yes | `content.spins` from portugal_plugin_parser |
| `total_win` | number | Yes | `content.total_win` from portugal_plugin_parser |
| `symbol_map` | object | Yes | `content.symbol_map` from portugal_plugin_parser |
| `game_code` | string | No | Used in report file name, default `ACCR` |
| `game_title` | string | No | HTML report title |
| `warnings` | array | No | `content.warnings` from portugal_plugin_parser |
| `expected_payout` | number | No | PlayCheck PAYOUT (fetch mode) |
| `expected_wager` | number | No | PlayCheck WAGERED (fetch mode) |
| `game_win` | number | No | Game response financials.win (fetch mode) |
| `money_divisor` | number | No | Minimum units per currency unit for MG/MV, default 100 |
| `source` | object | No | Source (module / session / transaction), shown in the report |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "game_code": "RAW",
    "spin_count": 30,
    "total_win": 525740.0,
    "findings": [],
    "finding_count": 0,
    "warning_count": 0,
    "playcheck_checks": [
      {"check": "payout_matches_playcheck", "passed": true, "message": "sum(MG)/100 = 5257.40 vs PlayCheck PAYOUT 5257.40"},
      {"check": "wager_matches_playcheck", "passed": true, "message": "first MV/100 = 1.00 vs PlayCheck WAGERED 1.00"}
    ],
    "verdict": "CLEAN",
    "txt_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.txt",
    "json_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.json",
    "html_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.html"
  }
}
```
`verdict`: any PlayCheck reconciliation fails → `FAIL`; otherwise any finding / warning → `REVIEW`; otherwise `CLEAN`.

## 5. Tool Call Order Constraint

The Agent must call tools in the following order:
0. `portugal_plugin_symbol_map` → determine mapping (import the attached Output Guide or load the stored mapping by moduleId; stop if missing), see `skill-portugal-plugin-symbol-map.md`
1. `portugal_plugin_fetcher` → fetch outcome string (paste mode passes through directly)
2. `portugal_plugin_parser` → parse the string with `game_code` + `symbol_map` from step 0
3. `portugal_plugin_reporter` → run checks and write reports using outputs of steps 1 and 2

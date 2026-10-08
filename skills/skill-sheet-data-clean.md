# SKILL: SLOT Test Sheet Data Cleaning Rules

## 1. Core Purpose
Dedicated cleaning, filtering and normalization skill for SLOT test sheets; provides constraints for the data generation Agent.

## 2. Data Cleaning Rules

### Rule 1: Module ID Extraction
- Read sheet cell A1
- Match with regex `Module\s*ID\s*#?:?\s*(\d+)`
- Extract the integer module ID (e.g. `105359`)

### Rule 2: Batch & Index Cleanup
- Format requirement: `^\d+,\d+$`
- Remove all trailing text and comments (e.g. `with max meter`)
- Keep only the pure `batch,index` format

### Rule 3: File Classification Naming Rules
- **Game prefix**: defaults to `P5P_` (customizable per game)
- **Regular Wins file**: merge `micro win`, `Small win`, `Medium win`, `Large win` → `{GamePrefix}_Base game_Regular Wins.testdata`
- **Big Wins file**: merge `Big win`, `Mega win`, `Epic Win`, `Super Win` → `{GamePrefix}_Base game_Big Wins.testdata`
- **BetLines file**: merge all 20 lines (`0` to `19`) → `{GamePrefix}_Base game_Betlines.testdata`
- **Feature trigger files**: one separate file per specific scenario, e.g. `{GamePrefix}_Bonus Feature_MINI Prize.testdata`

## 3. Output Constraints
- Must output standard structured JSON
- Each record must contain: `case_name`, `format_type` (SINGLE/DOUBLE_PREGEN), `module_id`, `base_batch`, `base_index`, `bonus_batch` (nullable), `bonus_index` (nullable), `file_name`

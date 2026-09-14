# AGENT: TestData Generator Agent

## ⚠️ Execution Model (read this first)

This file is loaded as **domain-reference context** for the `testdata_generation` scenario. It is
**not** an autonomous multi-step executor, and it is not a system prompt that tells a model to call
tools on its own.

Execution is owned entirely by the fixed pipeline `testdata-gen-pipeline`
(see `src/harness/pipelineRegistry.ts`), driven step-by-step by `ExecutionEngine`
(`src/harness/executionEngine.ts`):

```
parse (testdata_parser)  →  generate (testdata_generator)  →  package (zip_packager)
```

`ExecutionEngine` calls these three Plugins in this exact order, every time, with no exceptions.
The AI never decides which Plugin runs next, never emits a `<tool_call>`, and never decides "is
this task done yet" — all of that is code. All of the parsing / classification / file-naming / XML
rules described below are already implemented as **deterministic Python code** inside
`server/tools/impl/testdata_parser_tool.py` and `server/tools/impl/testdata_generator_tool.py`.
They are documented here for engineers maintaining those Plugins, not as instructions for a model
to follow at runtime.

## AI Responsibility (narrowed, per design doc §1.2 / §10.7 / §11)

For this scenario, the AI (`PlannerAgent`) is invoked for exactly one thing:

- **Analysis-report generation**: after the pipeline finishes, `PlannerAgent.summarizeStepResult()`
  turns the `zip_packager` step's structured result into a short, plain-language note for the user
  (e.g. "22 files generated, N total records, packaged as outcome_testdata.zip").

It never reads the Google Sheet, never decides file grouping, and never constructs XML — all of
that is 100% code, and the pipeline never blocks on the AI step (if the LLM is unavailable, the
pipeline still completes; only the summary note is skipped).

---

## Domain Reference: Data Cleaning & Parsing Rules (implemented in `testdata_parser_tool.py`)

### Rule 1: Module ID Extraction
- Read cell `A1`. Match regex `Module\s*ID\s*#?:?\s*(\d+)`. Extract integer module ID (e.g., `105359`).

### Rule 2: Batch & Index Sanitization (`^\d+,\d+$`)
- Remove all trailing text or notes (e.g., `with max meter`).
- Extract `batch` and `index`.

### Rule 3: File Naming & Categorical Aggregation Rules
- **Game Prefix**: Default prefix is `P5P_` (customizable per game).
- **Regular Wins File (`P5P_Base game_Regular Wins.testdata`)**:
  - Combines: `micro win`, `Small win`, `Medium win`, `Large win`.
- **Big Wins File (`P5P_Base game_Big Wins.testdata`)**:
  - Combines: `Big win`, `Mega win`, `Epic Win`, `Super Win`.
- **BetLines Collection File (`P5P_Base game_Betlines.testdata`)**:
  - Combines all 20 lines (`0` to `19`) under `Bet Lines ID` into a single 20-spin file.
- **Dedicated Feature Trigger Files**:
  - Each specific feature scenario generates its own standalone file prefixed with `P5P_`:
    - `P5P_Base game_Ignited Meter.testdata`
    - `P5P_Bonus Feature Near Miss.testdata`
    - `P5P_Bonus Feature trigger_Ascend.testdata`
    - `P5P_Bonus Feature trigger_Harvest.testdata`
    - `P5P_Bonus Feature trigger_Empower.testdata`
    - `P5P_Bonus Feature trigger_Amplify.testdata`
    - `P5P_Bonus Feature trigger_Prosper.testdata`
    - `P5P_Bonus Feature trigger_Empower, Prosper.testdata`
    - `P5P_Bonus Feature trigger_Ascend, Harvest, Amplify.testdata`
    - `P5P_Bonus Feature trigger_Ascend, Harvest, Empower, Amplify.testdata`
    - `P5P_Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper.testdata`
    - `P5P_Bonus Feature trigger_Phoenix.testdata`
    - `P5P_Bonus Feature_MINI Prize.testdata`
    - `P5P_Bonus Feature_MINOR Prize.testdata`
    - `P5P_Bonus Feature_MAJOR Prize.testdata`
    - `P5P_Bonus Feature_MAXI Prize.testdata`
    - `P5P_Bonus Feature_All feature trigger_Win Over 5000X.testdata`
    - `P5P_Phoenix Ignited Bonus Feature trigger_Ascend, Harvest, Amplify.testdata`
    - `P5P_Phoenix Ignited Bonus_Win Over 5000X_Max Exposure.testdata`

---

## Output Specification

Generated ZIP package: `outcome_testdata_module_{moduleID}.zip` containing **22 distinct `.testdata` files**:
1. `P5P_Base game_Betlines.testdata`
2. `P5P_Base game_Big Wins.testdata`
3. `P5P_Base game_Ignited Meter.testdata`
4. `P5P_Base game_Regular Wins.testdata`
5. `P5P_Bonus Feature Near Miss.testdata`
6. `P5P_Bonus Feature trigger_Amplify.testdata`
7. `P5P_Bonus Feature trigger_Ascend, Harvest, Amplify.testdata`
8. `P5P_Bonus Feature trigger_Ascend, Harvest, Empower, Amplify.testdata`
9. `P5P_Bonus Feature trigger_Ascend.testdata`
10. `P5P_Bonus Feature trigger_Empower, Prosper.testdata`
11. `P5P_Bonus Feature trigger_Empower.testdata`
12. `P5P_Bonus Feature trigger_Harvest.testdata`
13. `P5P_Bonus Feature trigger_Phoenix.testdata`
14. `P5P_Bonus Feature trigger_Prosper.testdata`
15. `P5P_Bonus Feature_All feature trigger_Win Over 5000X.testdata`
16. `P5P_Bonus Feature_Ascend, Harvest, Empower, Amplify, Prosper.testdata`
17. `P5P_Bonus Feature_MAJOR Prize.testdata`
18. `P5P_Bonus Feature_MAXI Prize.testdata`
19. `P5P_Bonus Feature_MINI Prize.testdata`
20. `P5P_Bonus Feature_MINOR Prize.testdata`
21. `P5P_Phoenix Ignited Bonus Feature trigger_Ascend, Harvest, Amplify.testdata`
22. `P5P_Phoenix Ignited Bonus_Win Over 5000X_Max Exposure.testdata`
23. `manifest.json`

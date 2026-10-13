import type { PipelineDef } from "./sharedTypes";

// ── Pipeline Registry ─────────────────────────────────────────────
// Each pipeline defines an ordered set of stages; steps within a stage can run in parallel.
// Add a new pipeline by appending an entry to the PIPELINES array.

export const PIPELINES: PipelineDef[] = [
  // ─── TestData Generation Pipeline ───
  {
    id: "testdata-gen-pipeline",
    name: "TestData Generation",
    description: "Parse Paytable → Generate XML → Package ZIP",
    stages: [
      // Stage 0: Parse
      [
        {
          id: "parse",
          plugin: "testdata_parser",
          label: "Parse Paytable",
          description: "Parse structured records from raw text / Sheet URL",
          dependsOn: [],
          retryOnFail: true,
          maxRetries: 2,
          buildParams: ({ extraParams }) => ({
            raw_text: extraParams.rawText ?? "",
            game_prefix: extraParams.gamePrefix ?? "P5P",
            default_module_id: extraParams.moduleId ?? "105359",
          }),
        },
      ],
      // Stage 1: Generate
      [
        {
          id: "generate",
          plugin: "testdata_generator",
          label: "Generate .testdata",
          description: "Write structured records into .testdata XML files",
          dependsOn: ["parse"],
          retryOnFail: true,
          maxRetries: 2,
          buildParams: ({ extraParams, stepResults }) => ({
            records: (stepResults.parse as { records?: unknown[] } | undefined)?.records ?? [],
            login_name: extraParams.loginName ?? "",
          }),
        },
      ],
      // Stage 2: Package
      [
        {
          id: "package",
          plugin: "zip_packager",
          label: "Package ZIP",
          description: "Package all .testdata files into outcome_testdata.zip",
          dependsOn: ["generate"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams, stepResults }) => ({
            source_files: (stepResults.generate as { files?: unknown[] } | undefined)?.files ?? [],
            login_name: extraParams.loginName ?? "",
            module_id:
              (stepResults.generate as { module_id?: unknown } | undefined)?.module_id ??
              extraParams.moduleId ??
              "105359",
          }),
        },
      ],
    ],
  },

  // ─── Game Verification Pipeline ───
  {
    id: "game-verify-pipeline",
    name: "TestData Verification",
    description: "Send testdata to real game → Verify payout consistency",
    stages: [
      // Stage 0: Verify
      [
        {
          id: "verify",
          plugin: "testdata_verifier",
          label: "Run Verification",
          description: "Connect to real game environment via Selenium and run verification",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams }) => ({
            testdata_files: extraParams.testdataFilePaths ?? [],
            target_url: extraParams.targetUrl ?? "",
            spin_delay_sec: extraParams.spinDelaySec ?? 3,
          }),
        },
      ],
      // Stage 1: Diagnose (only for failed cases)
      [
        {
          id: "diagnose",
          plugin: "log_diagnoser",
          label: "Root Cause Diagnosis",
          description: "Analyze logs and screenshots of failed cases, attribute root cause",
          dependsOn: ["verify"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ stepResults }) => ({
            results: (stepResults.verify as { cases?: unknown[] } | undefined)?.cases ?? [],
          }),
        },
      ],
    ],
  },

  // ─── Helpfile Conversion & Analysis Pipeline ───
  // Referenced by intentRouter.ts's "easyhelp_checking" scenario (pipelineId: "helpfile-conversion-pipeline"),
  // but was missing from this registry until now — getPipeline() would have returned undefined for this scenario.
  {
    id: "helpfile-conversion-pipeline",
    name: "Helpfile Conversion & Analysis",
    description: "Convert HTML help files to text → diff-compare against baseline → HTML report → optional local-AI analysis",
    stages: [
      // Stage 0: Convert
      [
        {
          id: "convert",
          plugin: "html_to_text_converter",
          label: "Convert HTML to Text",
          description: "Batch-convert HTML help files under source_folder to plain text",
          dependsOn: [],
          retryOnFail: true,
          maxRetries: 1,
          buildParams: ({ extraParams }) => ({
            source_folder: extraParams.sourceFolder ?? "",
            output_folder: extraParams.outputFolder ?? "",
          }),
        },
      ],
      // Stage 1: Compare
      [
        {
          id: "compare",
          plugin: "diff_comparator",
          label: "Diff Comparison",
          description: "Compare converted TXT files against the baseline, highlight keyword differences",
          dependsOn: ["convert"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams, stepResults }) => ({
            txt_files: (
              (stepResults.convert as { converted_files?: Array<{ subdir_name: string; txt_path: string }> } | undefined)
                ?.converted_files ?? []
            ).map((f) => ({ subdir_name: f.subdir_name, txt_path: f.txt_path })),
            keywords: extraParams.keywords ?? [],
            output_folder: extraParams.outputFolder ?? "",
            baseline_file: (stepResults.convert as { baseline_file?: string } | undefined)?.baseline_file ?? "",
          }),
        },
      ],
      // Stage 2: Report — deterministic HTML/JSON report, no AI. Always produced.
      [
        {
          id: "report",
          plugin: "helpfile_report",
          label: "Generate HTML Report",
          description: "Write helpfile_report.html: file inventory, keyword coverage per file, differences vs baseline",
          dependsOn: ["compare"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams, stepResults }) => ({
            txt_files: (
              (stepResults.convert as { converted_files?: Array<{ subdir_name: string; txt_path: string }> } | undefined)
                ?.converted_files ?? []
            ).map((f) => ({ subdir_name: f.subdir_name, txt_path: f.txt_path })),
            keywords: extraParams.keywords ?? [],
            output_folder: extraParams.outputFolder ?? "",
            comparison_results: (stepResults.compare as { comparisons?: unknown[] } | undefined)?.comparisons ?? [],
            baseline_file: (stepResults.convert as { baseline_file?: string } | undefined)?.baseline_file ?? "",
            excel_report: (stepResults.compare as { excel_report?: string } | undefined)?.excel_report ?? "",
          }),
        },
      ],
      // Stage 3: AI Analysis — optional. The local model reads the report from stage 2; if Ollama is
      // down or too slow the pipeline still completes and the user keeps the stage-2 report.
      [
        {
          id: "analyze",
          plugin: "helpfile_analyzer",
          label: "AI Analysis of Report",
          description: "Ask the local model to summarize the report and flag quality issues",
          dependsOn: ["report"],
          retryOnFail: false,
          maxRetries: 0,
          optional: true,
          buildParams: ({ extraParams, stepResults }) => ({
            report_json_path: (stepResults.report as { report_json_path?: string } | undefined)?.report_json_path ?? "",
            output_folder: extraParams.outputFolder ?? "",
            // Omitted when unset so the plugin's own defaults apply
            ...(extraParams.ollamaModel ? { ollama_model: extraParams.ollamaModel } : {}),
            ...(extraParams.ollamaBaseUrl ? { ollama_base_url: extraParams.ollamaBaseUrl } : {}),
          }),
        },
      ],
    ],
  },

  // ─── Portugal Plugin Verification Pipeline ───
  // Port of portugal-playcheck-plugin/ppvACCR1.0.py: parse the plugin output string, then write
  // the same text report plus JSON/HTML with advisory consistency checks.
  {
    id: "portugal-plugin-verify-pipeline",
    name: "Portugal Plugin Verification",
    description: "Resolve symbol mapping → fetch outcome from PlayCheck (or use pasted text) → parse → checks → TXT/JSON/HTML report",
    stages: [
      // Stage 0: Symbol mapping — precondition, runs before any slow browser work. Imports the
      // attached Output Guide (.md) or uses the stored profile for the module; fails otherwise.
      [
        {
          id: "resolve_symbol_map",
          plugin: "portugal_plugin_symbol_map",
          label: "Resolve Symbol Mapping",
          description: "Import the attached Output Guide or load the stored letter → SYM map for this module",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams }) => ({
            markdown: extraParams.guideMarkdown ?? "",
            file_name: extraParams.guideFileName ?? "",
            module_id: extraParams.moduleId ?? "",
            game_code: extraParams.mappingGameCode ?? "",
            save: extraParams.saveMapping ?? true,
          }),
        },
      ],
      // Stage 1: Fetch — pass-through when the outcome string was pasted
      [
        {
          id: "fetch_portugal_plugin",
          plugin: "portugal_plugin_fetcher",
          label: "Fetch Outcome from PlayCheck",
          description: "Log into the game, spin, open ••• → Game History and read GetReportAsync Data",
          dependsOn: ["resolve_symbol_map"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams }) => ({
            raw_text: extraParams.rawText ?? "",
            ...((extraParams.fetchParams as Record<string, unknown> | undefined) ?? {}),
          }),
        },
      ],
      // Stage 2: Parse
      [
        {
          id: "parse_portugal_plugin",
          plugin: "portugal_plugin_parser",
          label: "Parse Portugal Plugin Output",
          description: "Split spins, map letters to SYM names, collect R/MV/MT/MG and total the win amount",
          dependsOn: ["fetch_portugal_plugin"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ extraParams, stepResults }) => {
            const fetched = (stepResults.fetch_portugal_plugin ?? {}) as Record<string, unknown>;
            const mapping = (stepResults.resolve_symbol_map ?? {}) as Record<string, unknown>;
            return {
              raw_text: fetched.raw_text ?? extraParams.rawText ?? "",
              // exactly the map stage 0 resolved (also works for an imported-but-unsaved guide)
              game_code: mapping.game_code,
              symbol_map: mapping.symbol_map,
            };
          },
        },
      ],
      // Stage 3: Report
      [
        {
          id: "report_portugal_plugin",
          plugin: "portugal_plugin_reporter",
          label: "Consistency Check & Report",
          description: "Flag unmapped symbols / row or parameter count mismatches and write TXT/JSON/HTML reports",
          dependsOn: ["parse_portugal_plugin"],
          retryOnFail: false,
          maxRetries: 0,
          buildParams: ({ stepResults }) => {
            const parsed = (stepResults.parse_portugal_plugin ?? {}) as Record<string, unknown>;
            const fetched = (stepResults.fetch_portugal_plugin ?? {}) as Record<string, unknown>;
            const fromPlaycheck = fetched.source === "playcheck";
            return {
              ...(fromPlaycheck
                ? {
                    expected_payout: fetched.expected_payout,
                    expected_wager: fetched.expected_wager,
                    game_win: fetched.game_win,
                    source: {
                      module: fetched.module_id,
                      session: fetched.session_id,
                      transaction: fetched.trans_number,
                    },
                  }
                : {}),
              spins: parsed.spins ?? [],
              total_win: parsed.total_win ?? 0,
              symbol_map: parsed.symbol_map ?? {},
              game_code: parsed.game_code ?? "ACCR",
              game_title: parsed.game_title ?? "",
              warnings: parsed.warnings ?? [],
            };
          },
        },
      ],
    ],
  },
];

// ── Query Utility Functions ─────────────────────────────────────────────

/** Get pipeline definition by ID; returns undefined if not found */
export function getPipeline(pipelineId: string): PipelineDef | undefined {
  return PIPELINES.find((p) => p.id === pipelineId);
}

/** Get summary of all pipelines (for UI display) */
export function listPipelines(): Array<{ id: string; name: string; stageCount: number }> {
  return PIPELINES.map((p) => ({
    id: p.id,
    name: p.name,
    stageCount: p.stages.length,
  }));
}

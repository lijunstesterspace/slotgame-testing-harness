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
    description: "Convert HTML help files to text → diff-compare against baseline → generate AI analysis report",
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
      // Stage 2: AI Analysis (analysis-report generation only — the actual model call
      // happens server-side inside the helpfile_analyzer Plugin, not in this frontend layer)
      [
        {
          id: "analyze",
          plugin: "helpfile_analyzer",
          label: "AI Analysis Report",
          description: "Generate an AI-assisted analysis report from the conversion + diff results",
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
          }),
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

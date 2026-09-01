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
        },
      ],
    ],
  },

  // ─── Game Verification Pipeline ───
  {
    id: "game-verify-pipeline",
    name: "Game Environment Verification",
    description: "Send testdata to real game → Verify payout consistency",
    stages: [
      // Stage 0: Verify
      [
        {
          id: "verify",
          plugin: "game_verifier",
          label: "Run Verification",
          description: "Connect to real game environment via Selenium and run verification",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
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
        },
      ],
    ],
  },

  // ── Log Diagnosis Pipeline ───
  {
    id: "log-diagnose-pipeline",
    name: "Log Diagnosis",
    description: "Analyze verification failure logs, generate root cause attribution report",
    stages: [
      [
        {
          id: "diagnose",
          plugin: "log_diagnoser",
          label: "Log Analysis",
          description: "Analyze failure logs and screenshots, output root cause report",
          dependsOn: [],
          retryOnFail: false,
          maxRetries: 0,
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

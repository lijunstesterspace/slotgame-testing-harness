# WORKFLOWS Pipeline Configuration Directory

This directory is reserved per the SLOT AI Harness design document.

## Current Status

P0-P1 phase: pipelines are hard-coded in `src/harness/plannerAgent.ts` and split into:
- **Stage 1**: Test data generation (parse → generate → package)
- **Stage 2**: Test data verification (verify → diagnose)

## Future Extensions

Planned for the P2 phase:
- YAML pipeline definitions
- DAG visual orchestration
- Multiple coexisting, switchable pipelines
- Variable interpolation and conditional branching

Example structure:
```yaml
# workflows/slot-test-pipeline.yaml
name: slot-test-full-pipeline
steps:
  - id: parse
    tool: testdata_parser
    params:
      raw_text: "{{input.raw_text}}"
  - id: generate
    tool: testdata_generator
    depends_on: [parse]
    params:
      records: "{{parse.output.records}}"
  - id: package
    tool: zip_packager
    depends_on: [generate]
    params:
      files: "{{generate.output.files}}"
```

Per extension principle 9.5 of the design document: the front-end canvas can support switching between multiple pipelines, running them independently, and keeping each one's logs isolated.

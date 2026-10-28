# Project instructions

## Keep the design doc in sync with the code

`Slot Game Testing Harness Design Doc.md` is the authoritative design doc, and the code is its source of truth.

- **Any commit that adds or changes a feature** (a new Plugin, scenario, pipeline, verification method, API route, UI panel, param, or directory) must update the design doc in the same PR. Typical places: Layer 4 Plugin table (2.2), UI layout (4.1), directory structure (6), scenario/pipeline tables and the Module Three addendum (10.2), API overview and cancellation (12.2 / 12.3), and Chapter 13 known discrepancies.
- After updating, bump the **"Synced with code at"** line at the top of the doc to the commit the doc now describes, and add a short dated revision note listing what changed.
- Doc-only catch-up work (re-aligning the doc after features landed without doc changes) goes on the long-lived **`docs/design-doc-sync`** branch: rebase it on `main`, run `git log <synced-commit>..main` to find what is missing, update the doc, and open a PR into `main`.
- Write the doc in English only. Mark anything not yet implemented as "planned / not implemented" instead of describing it as done.

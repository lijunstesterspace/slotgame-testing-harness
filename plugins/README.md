# PLUGINS Directory

This directory is reserved per the SLOT AI Harness design document.

## Plugin Architecture

The current production plugin implementations live in `server/tools/impl/` and follow the `ToolPlugin` abstract interface (MCP-compatible):

- `server/tools/base.py` - Defines the `ToolPlugin` interface and `ToolRegistry`
- `server/tools/impl/` - Built-in plugin implementations:
  - `testdata_parser_tool.py` - Google Sheets parser plugin
  - `testdata_generator_tool.py` - Test data generator plugin
  - `zip_packager_tool.py` - ZIP packaging plugin
  - `game_verifier_tool.py` - Game verification plugin
  - `log_diagnoser_tool.py` - Log diagnosis plugin
  - `html_to_text_converter_tool.py` - HTML help file to text converter plugin
  - `diff_comparator_tool.py` - Diff comparison and keyword highlighting plugin
  - `helpfile_analyzer_tool.py` - AI analysis report plugin (calls local Ollama)
  - `portugal_plugin_parser_tool.py` - Portugal Plugin output parser plugin (ported from ppvACCR1.0.py)
  - `portugal_plugin_reporter_tool.py` - Portugal Plugin consistency check, PlayCheck reconciliation, and TXT/JSON/HTML report plugin
  - `portugal_plugin_fetcher_tool.py` - Automatically retrieves Portugal Plugin outcomes from the game environment via Game History → PlayCheck
  - `portugal_plugin_symbol_map_tool.py` - Portugal Plugin Verification step 0: imports the game's Output Guide (Google Doc → Markdown) or fetches a stored mapping by moduleId (`symbol_profiles/`)

## Adding a New Plugin

Per extension rule 9.2 of the design document:

1. Create a new `.py` file in `server/tools/impl/` that inherits from `ToolPlugin`
2. Register it in `BUILTIN_TOOLS` in `server/tools/impl/__init__.py`
3. The Harness loads it automatically at startup, and the front end can call it right away

This top-level `plugins/` directory is for:
- Sample plugin templates
- Third-party standalone plugins (optional)
- Plugin development documentation

Follow the incremental extension principle: **all extensions are purely additive; existing stable functionality is completely unaffected**.

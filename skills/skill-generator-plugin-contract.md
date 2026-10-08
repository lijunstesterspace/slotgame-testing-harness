# SKILL: Test Generation Plugin Interface Contract Specification

## 1. Core Purpose
Defines the interface contract between the Plugin tool layer and the Agent layer, ensuring consistent parameter formats.

## 2. testdata_parser Interface Contract

**Function:** Parse raw paytable text → structured records

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `raw_text` | string | Yes | Raw text exported from Google Sheets |
| `module_id_hint` | string | No | Hinted module ID, used when parsing fails |
| `game_prefix` | string | No | Game prefix, default `P5P_` |

**Output structure:**
```json
{
  "success": true,
  "content": {
    "records": [
      {
        "case_name": "micro win",
        "format_type": "SINGLE",
        "module_id": "105359",
        "base_batch": 58,
        "base_index": 3,
        "bonus_batch": null,
        "bonus_index": null,
        "file_name": "P5P_Base game_Regular Wins.testdata"
      }
    ],
    "file_map": {
      "P5P_Base game_Regular Wins.testdata": ["record_id1", "record_id2"]
    }
  }
}
```

## 3. testdata_generator Interface Contract

**Function:** Generate .testdata XML files from structured records

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `records` | array | Yes | Structured records output by testdata_parser |
| `module_id` | string | Yes | Module ID |
| `game_prefix` | string | No | Game prefix, default `P5P_` |

**Output:** List of generated files

## 4. zip_packager Interface Contract

**Function:** Package generated files into a ZIP for download

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `files` | array | Yes | List of file paths to package |
| `module_id` | string | Yes | Module ID |
| `manifest` | object | No | Additional metadata |

**Output:** ZIP file download URL

## 5. game_verifier Interface Contract

**Function:** Verify test data in the real environment with Selenium

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `testdata_files` | array | Yes | List of .testdata files to verify |
| `target_url` | string | Yes | Game test environment URL |
| `spin_delay_ms` | number | No | Request interval, default 500ms |
| `auth_token` | string | No | Auth token |

**Output:** List of verification results

## 6. log_diagnoser Interface Contract

**Function:** Diagnose verification results, classify root causes

**Input parameters:**
| Parameter | Type | Required | Description |
|--------|------|------|------|
| `verification_results` | array | Yes | Output results of game_verifier |

**Output:** Diagnostic category statistics

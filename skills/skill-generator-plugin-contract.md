# SKILL: 测试生成插件接口契约规范

## 1. 核心定位
定义 Plugin 工具层与 Agent 层的接口契约，保障参数格式一致。

## 2. testdata_parser 接口契约

**功能：** 解析原始 paytable 文本 → 结构化记录

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `raw_text` | string | 是 | Google Sheets 导出的原始文本 |
| `module_id_hint` | string | 否 | 提示的模块ID，解析失败时使用 |
| `game_prefix` | string | 否 | 游戏前缀，默认 `P5P_` |

**输出结构：**
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

## 3. testdata_generator 接口契约

**功能：** 根据结构化记录生成 .testdata XML 文件

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `records` | array | 是 | testdata_parser 输出的结构化记录 |
| `module_id` | string | 是 | 模块ID |
| `game_prefix` | string | 否 | 游戏前缀，默认 `P5P_` |

**输出：** 生成的文件列表

## 4. zip_packager 接口契约

**功能：** 将生成的文件打包为 ZIP 下载

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `files` | array | 是 | 需要打包的文件路径列表 |
| `module_id` | string | 是 | 模块ID |
| `manifest` | object | 否 | 附加元数据 |

**输出：** ZIP 文件下载 URL

## 5. game_verifier 接口契约

**功能：** Selenium 真实环境验证测试数据

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `testdata_files` | array | 是 | 待验证的 .testdata 文件列表 |
| `target_url` | string | 是 | 游戏测试环境URL |
| `spin_delay_ms` | number | 否 | 请求间隔，默认 500ms |
| `auth_token` | string | 否 | 认证令牌 |

**输出：** 验证结果列表

## 6. log_diagnoser 接口契约

**功能：** 诊断验证结果，分类根因

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `verification_results` | array | 是 | game_verifier 输出结果 |

**输出：** 诊断分类统计

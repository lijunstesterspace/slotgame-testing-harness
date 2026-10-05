# SKILL: Portugal Plugin 符号映射（流程第 0 步）

## 1. 核心定位
Portugal Plugin Verification 的**前置条件**：确定本次运行使用的 letter → SYM 映射。
映射来自后端提供的 **Portugal Plugin Output Guide**（Google Doc），替代在各个
`portugal-playcheck-plugin/ppv*.py` 里手动维护 `LETTER_TO_SYM`。
导入结果保存为 `symbol_profiles/<GAME_CODE>.json`，之后同一 moduleId 的运行自动复用。

## 2. 决策规则（第 0 步，先于任何浏览器操作）
| 情况 | 结果 |
|---|---|
| 附加了 Output Guide（.md） | 导入：解析、校验、自检、与已存版本对比；勾选 **Save Imported Mapping** 时保存 |
| 未附加，moduleId 有已存映射 | 使用已存映射 |
| 未附加，moduleId 没有映射 | **停止**：`no_symbol_mapping_for_module:<id>`，提示附加该游戏的 .md |
| 附加的 .md 的 moduleId ≠ 本次 moduleId | **停止**：`guide_module_mismatch`（拿错了游戏的文档） |
| 完全没有 moduleId（粘贴 outcome、无 .md） | 使用内置 ACCR 映射（原工具行为），控制台给出提示 |

moduleId 来源：输入框中的 `moduleId=…` > 游戏 URL 的 `moduleId` 参数。

## 2.1 输入
- Google Docs → 文件 → 下载 → **Markdown (.md)**，在 Harness 用 `+` 附加（作为独立附件，不进入输入框）
- 可选覆盖：`gameCode=ADPC`、`moduleId=105170`

## 3. 解析规则

### Rule 1: 定位映射表
- 取第一张表头同时包含 `Definition` 与 `…letter`（Corresponding letter）的表格
- 紧跟其后、列数相同且字母列为单个字母的无表头续表会被接上
- 分隔行（`| :---: |`）跳过；`[imageN]: <data:…>` 图片数据行与 `![][imageN]` 图片单元格忽略

### Rule 2: 单元格清洗
- 先按未转义的 `|` 拆分，再去掉 Google 的 Markdown 转义（`\#` → `#`、`\-1` → `-1`、`1\.` → `1.`）
- 去掉 `**粗体**` / `_斜体_` 标记

### Rule 3: 映射生成
| Definition 写法 | 结果 | 示例 |
|---|---|---|
| 整数 | `SYM<n>` | `-1` → `SYM-1`、`15` → `SYM15`（GBOW 文档写法） |
| `SYMn`（大小写不限） | `SYM<n>` | `SYM15` → `SYM15`（ADPC 文档写法） |
| 其他名称 | 原样 | `GRAND` |
- 字母键一律存为**大写**：解析器查表时会把字母转大写（`ppvADPC1.0.py` 用小写键 + 大写查表，导致映射从未生效，此规则避免同类问题）

### Rule 4: 元数据
- 游戏名与 moduleId：正文 `…guide for <Game> <moduleId>`（如 `guide for Apex Dragon Power Combo™ 105170`）
- 找不到时游戏名取文件名 ` - ` 之前部分
- 游戏代码：游戏名的单词首字母，数字保留（Apex Dragon Power Combo → `ADPC`，Mega Eagle 2 Ultra → `ME2U`）

## 4. 校验
| 类型 | 条件 |
|---|---|
| 错误（不保存） | 找不到映射表；字母列不是单个字母；同一字母有两个不同定义；无法确定游戏代码 |
| 警告 | 同一 SYM 分给多个字母；字母范围内有空缺；文档中没有 moduleId |
| 自检 | 用新映射解析文档里的示例字符串（`0:a;p;k;…#MV#…`），报告示例用到但表中没有的字母 |

## 5. 保存
- 与已存版本对比：新增 / 修改 / 删除的字母
- 完全相同则不写入；否则写入 `symbol_profiles/<GAME>.json`，旧版本保存在 `history`（最多 20 份）
- moduleId 与已存的合并，不会丢失
- 测试计划里取消 **Save Imported Mapping** = 只用于本次运行，不保存

## 6. portugal_plugin_symbol_map 接口契约

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `markdown` | string | 否 | 附加的 .md 内容；为空 = 使用已存映射 |
| `file_name` | string | 否 | 原文件名（记录来源 / 游戏名兜底） |
| `module_id` | string | 否 | 本次运行的 moduleId（校验文档、查找已存映射） |
| `game_code` | string | 否 | 覆盖游戏代码 / 指定已存映射 |
| `save` | boolean | 否 | 保存导入的映射，默认 true |

**输出结构：**
```json
{
  "success": true,
  "content": {
    "mode": "imported",
    "game_code": "ADPC", "title": "Apex Dragon Power Combo", "module_ids": ["105170"],
    "symbol_map": {"A": "SYM1", "M": "SYM15", "Y": "SYM99"},
    "profile": {"game_code": "ADPC", "title": "Apex Dragon Power Combo", "module_ids": ["105170"],
                "symbol_map": {"A": "SYM1", "M": "SYM15", "Y": "SYM99"}, "source": {"file": "…md", "imported_at": "…", "sha256": "…"}},
    "rows": 25, "letter_count": 25, "errors": [], "warnings": [],
    "examples": [{"example": "0:i;l;h;h;g#…", "spins": 1, "total_win": 70.0, "unmapped_letters": []}],
    "existing": false, "unchanged": false,
    "diff": {"added": {"a": "SYM1"}, "removed": {}, "changed": {}},
    "saved": true, "saved_path": "…/symbol_profiles/ADPC.json"
  }
}
```

使用已存映射时（`mode` = `stored` / `default`）只返回
`mode`、`game_code`、`title`、`module_ids`、`symbol_map`、`letter_count`、`source`。
下一步 `portugal_plugin_parser` 直接使用这里返回的 `game_code` + `symbol_map`。

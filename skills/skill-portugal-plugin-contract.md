# SKILL: Portugal Plugin 接口契约规范

## 1. 核心定位
定义 Portugal Plugin 取数/解析/报告 Plugin 工具层与 Agent 层的接口契约，保障参数格式一致。

## 2. portugal_plugin_fetcher 接口契约

**功能：** 从游戏环境自动取回 outcome 字符串：登录游戏 →（可选）Spin → `•••` → Game History →
PlayCheck 登录会话 → 交易 → `GameReport/GetReportAsync` 的 `Data`。
`raw_text` 非空时跳过浏览器，直接透传（粘贴模式）。

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `raw_text` | string | 否 | 已有的 outcome 字符串；非空即粘贴模式 |
| `game_url` | string | 取数模式必填 | Titan Harness 页面（`…/harness/<game>`）或直接启动 URL（`…/launch/mgs/<game>?…`） |
| `login_name` | string | 否 | 默认取 game_url 的 `username` |
| `harness_password` | string | 否 | 默认取 game_url 的 `password`，否则共享 QA 密码 |
| `module_id` / `client_id` / `product_id` / `brand` | string | 否 | 默认取 game_url 的 `moduleId` / `clientId` / `productId` / `brand` |
| `spin_count` | number | 否 | 取数前 Spin 次数，默认 1；0 = 取已有交易 |
| `session_id` | string | 否 | PlayCheck 登录会话；默认自动定位 |
| `trans_number` | number | 否 | 交易号；默认最后 `spin_count` 笔 |
| `load_timeout_sec` | number | 否 | 每个阶段等待上限，默认 60 |

**定位规则：**
- 会话：`ENDED AT` 为空（未结束）优先，其次会话号大的优先；取第一个交易数 ≥ `spin_count` 的会话
- 交易：按交易号排序取最后 `spin_count` 笔（或指定 `trans_number`）
- 所有 PlayCheck 请求都在 Game History 打开的标签页内执行：`spaLoad()` 导航，报告请求带
  `X-SPA-ASPNET-SessionId: getSessionId()`，并用响应头回写轮换后的会话号（PlayCheck 登录不是 cookie）

**输出结构：**
```json
{
  "success": true,
  "content": {
    "source": "playcheck",
    "raw_text": "0:e;k;l;i;c#...#MG#25740#",
    "module_id": "105233", "client_id": "50300", "login_name": "lijunt",
    "session_id": "68046", "trans_number": 4,
    "expected_wager": 1.0, "expected_payout": 5257.4, "game_win": 525740,
    "outcomes": [{"trans_number": 4, "time": "9/30/2026 9:12:26 AM", "wagered": 1.0, "payout": 5257.4,
                  "session_id": "68046", "report_url": "…/GetReportAsync?…", "data": "…"}],
    "diagnostics": {"launch": "harness_form", "menu_attempts": ["dom_menu"], "jftw_ids": ["…"], "sessions": ["…"]}
  }
}
```

**错误码（失败时 `content.diagnostics` 附带诊断信息，并在 run 目录保存截图）：**
| error | 场景 |
|-------|------|
| `missing_input` | 既没有 raw_text 也没有 game_url |
| `missing_module_or_client_id` / `missing_harness_fields` | URL 与参数都缺少必需字段 |
| `harness_form_field_not_found:<field>` / `game_window_not_found_after_launch` | Harness 登录失败 |
| `game_history_not_opened` | `•••` / Game History 未能打开（看 `menu_attempts` / `jftw_ids`） |
| `playcheck_session_not_ready` | PlayCheck 页未完成会话兑换 |
| `no_session_with_<n>_transactions` / `trans_number_not_found` | 会话或交易定位失败 |
| `get_report_failed` / `report_has_no_outcome_data` | GetReportAsync 失败或无 Data |

## 3. portugal_plugin_parser 接口契约

**功能：** 解析 Portugal Plugin 输出字符串 → 结构化 SPIN 数据 + 总赢分 + 原工具格式文本

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `raw_text` | string | 是 | Portugal Plugin 输出字符串，包含一个或多个 `N:...` SPIN 块 |
| `game_code` | string | 否 | 游戏 Profile（`ACCR` / `RAW`…），决定字母→SYM 映射 |
| `module_id` | string | 否 | 未给 game_code 时按 module_id 选 Profile；无匹配 → `RAW`（保留原始字母） |
| `symbol_map` | object | 否 | 追加/覆盖的映射，如 `{"A": "WILD"}` |

Profile 选择：`game_code` > `module_id` 匹配 > 有 module_id 用 `RAW` > 都没有用 `ACCR`（原工具行为）。

**输出结构：**
```json
{
  "success": true,
  "content": {
    "game_code": "ACCR",
    "game_title": "Amazing Catch Cold Rush",
    "symbol_map": {"A": "SYM1", "B": "SYM2"},
    "spins": [
      {
        "SPIN": "1",
        "ROWS": [["SYM1", "SYM2", "SYM3"]],
        "WINNING_SYM": ["SYM1"],
        "WINNING_POS": ["0,1,2"],
        "BETS": ["10"],
        "MULTIPLIERS": ["2"],
        "WIN_AMOUNTS": [5.0]
      }
    ],
    "spin_count": 1,
    "total_win": 5.0,
    "warnings": [],
    "formatted_text": "Total Win Amount: 5.00\n=====..."
  }
}
```

**错误码：**
| error | 场景 |
|-------|------|
| `empty_input` | raw_text 为空 |
| `unknown_game_code:<code>` | game_code 不存在且未提供 symbol_map |
| `symbol_map_must_be_object` | symbol_map 不是对象 |
| `no_spins_found` | 未找到任何非空 `N:` SPIN 块 |

## 4. portugal_plugin_reporter 接口契约

**功能：** 一致性检查（建议性）+ PlayCheck 核对（硬性）+ 输出 TXT / JSON / HTML 报告

**输入参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `spins` | array | 是 | portugal_plugin_parser 的 `content.spins` |
| `total_win` | number | 是 | portugal_plugin_parser 的 `content.total_win` |
| `symbol_map` | object | 是 | portugal_plugin_parser 的 `content.symbol_map` |
| `game_code` | string | 否 | 用于报告文件名，默认 `ACCR` |
| `game_title` | string | 否 | HTML 报告标题 |
| `warnings` | array | 否 | portugal_plugin_parser 的 `content.warnings` |
| `expected_payout` | number | 否 | PlayCheck PAYOUT（取数模式） |
| `expected_wager` | number | 否 | PlayCheck WAGERED（取数模式） |
| `game_win` | number | 否 | 游戏响应 financials.win（取数模式） |
| `money_divisor` | number | 否 | MG/MV 每货币单位的最小单位数，默认 100 |
| `source` | object | 否 | 来源（module / session / transaction），显示在报告中 |

**输出结构：**
```json
{
  "success": true,
  "content": {
    "game_code": "RAW",
    "spin_count": 30,
    "total_win": 525740.0,
    "findings": [],
    "finding_count": 0,
    "warning_count": 0,
    "playcheck_checks": [
      {"check": "payout_matches_playcheck", "passed": true, "message": "sum(MG)/100 = 5257.40 vs PlayCheck PAYOUT 5257.40"},
      {"check": "wager_matches_playcheck", "passed": true, "message": "first MV/100 = 1.00 vs PlayCheck WAGERED 1.00"}
    ],
    "verdict": "CLEAN",
    "txt_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.txt",
    "json_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.json",
    "html_url": "/api/records/artifacts/portugal_plugin_RAW_exe_xxx.html"
  }
}
```
`verdict`：任一 PlayCheck 核对失败 → `FAIL`；否则有 finding / warning → `REVIEW`；否则 `CLEAN`。

## 5. 工具调用顺序约束

Agent 必须按以下顺序调用工具：
1. `portugal_plugin_fetcher` → 取回 outcome 字符串（粘贴模式直接透传）
2. `portugal_plugin_parser` → 解析字符串，得到 spins / total_win / symbol_map / warnings
3. `portugal_plugin_reporter` → 使用第 1、2 步的输出做检查并写报告

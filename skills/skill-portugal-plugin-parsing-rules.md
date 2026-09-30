# SKILL: Portugal Plugin 输出解析与校验规则

## 1. 核心定位
Portugal Plugin 输出字符串的解析、符号映射、总赢分计算与一致性检查技能，为 Portugal Plugin Verification Agent 提供约束规范。
规则源自独立工具 `portugal-playcheck-plugin/ppvACCR1.0.py`（Amazing Catch Cold Rush Portugal Plugin Verification Tool v1.0），
Harness 输出必须与该工具**逐字一致**。

## 2. 输入格式

```
1:A;B;C#D;E;F#G;H;I#R#A#0,1,2#MV#10#MT#2#MG#5.0 2:Q;M;N#O;P;L#MG#1.25
```

| 片段 | 含义 |
|------|------|
| `N:` | SPIN 编号，开始一个新的 SPIN |
| `X;Y;Z` | 一行转轴（每个 `#` 分隔的块为一行，`;` 分隔单元格） |
| `R#<sym>#<pos>` | 中奖符号 + 中奖位置 |
| `MV#<v>` | 投注额 (Bet) |
| `MT#<v>` | 倍数 (Multiplier) |
| `MG#<v>` | 赢分 (Win Amount)，累加到总赢分 |

## 3. 解析规则

### Rule 1: SPIN 切分
- 正则：`(\d+):(.*?)(?=\s*\d+:|$)`（DOTALL）
- 第一个 `N:` 之前的任何文字被忽略（允许在输入框前加说明文字）
- 内容去掉换行并 strip 后为空的 SPIN **跳过**，不计入结果

### Rule 2: 行数据
- 内容按 `#` 切分，去掉空片段
- 第一个参数标记（`R` / `MV` / `MT` / `MG`，必须完整匹配）之前的所有片段都是行数据
- 含 `;` 的片段按 `;` 拆分为多列；否则为单列行
- 单元格**不做 strip**（`A ; B` 中的 `A ` 不会被映射，原样保留）

### Rule 3: 符号映射
- 查表前将字母转大写：`a` → `A` → `SYM1`
- 映射表中不存在的值原样保留（如 `SYM1`、`Z`、`R2`）
- `R` 后面的中奖符号同样经过映射
- 映射表由游戏 Profile 决定，可用 `symbol_map` 参数追加/覆盖
- Profile 选择：显式 `game_code` > `module_id` 匹配 > 取数模式下无匹配用 `RAW`（保留原始字母，不套用别的游戏的表）> 粘贴模式默认 `ACCR`

ACCR 映射表：

| 字母 | 符号 | 字母 | 符号 | 字母 | 符号 |
|---|---|---|---|---|---|
| A | SYM1 | G | SYM7 | M | SYM20 |
| B | SYM2 | H | SYM8 | N | SYM21 |
| C | SYM3 | I | SYM9 | O | SYM22 |
| D | SYM4 | J | SYM10 | P | SYM23 |
| E | SYM5 | K | SYM11 | Q | SYM30 |
| F | SYM6 | L | SYM12 | | |

### Rule 4: 参数解析
- `R`：需要后面至少 2 个片段（`i+2 < len`），读取符号 + 位置，跳过 3 个片段
- `MV` / `MT`：需要后面至少 1 个片段，读取为**字符串**原样保存
- `MG`：读取并转换为 float，累加到总赢分
- `MG` 值无法转换为数字时：记录一条 warning，只前进 1 个片段（该值被当作未知片段跳过），**不中断解析**
- 不认识的片段直接跳过（如 `JP#500000` Jackpot 标记）

### Rule 5: 总赢分
- 所有 SPIN 的 `MG` 之和，显示保留 2 位小数：`Total Win Amount: 7.50`

## 4. 文本报告格式（必须与原工具一致）

```
Total Win Amount: 5.00
==================================================
SPIN 1
Row 1: SYM1 | SYM2 | SYM3
--------------------------------------------------
Winning Symbols: SYM1
Positions: 0,1,2
Bets: 10
Multipliers: 2
Amounts: $5.00
--------------------------------------------------
```
- 参数列表为空时整行不输出

## 5. 一致性检查（建议性，不影响解析结果）
原工具没有这些检查，因此它们**只产生 findings，永不导致步骤失败**：

| check | 触发条件 |
|-------|----------|
| `unmapped_symbol` | 行单元格不在映射表的 SYM 值中 |
| `unmapped_winning_symbol` | `R` 的中奖符号不在映射表的 SYM 值中 |
| `row_width_mismatch` | 同一 SPIN 内各行列数不一致 |
| `param_count_mismatch` | 同一 SPIN 内 MV / MT / MG 的数量不一致（三者每个 SPIN 各一次，未中奖时 `MG#0`） |
| `win_without_winning_symbol` | SPIN 的 MG 合计 > 0 但没有 `R` |
| `winning_symbol_without_win` | 有 `R` 但 MG 合计为 0 |

- `R` 只在中奖时出现（每条中奖一次），所以不与 MV/MT/MG 的数量比较
- `RAW` Profile 下不做符号映射检查

## 6. PlayCheck 核对（硬性，仅取数模式）
MG / MV 以最小货币单位记录（`money_divisor`，默认 100）。以真实交易验证：`sum(MG) = 525740` → $5,257.40。

| check | 通过条件 |
|-------|----------|
| `payout_matches_playcheck` | `sum(MG) / 100` = PlayCheck 该交易的 PAYOUT |
| `wager_matches_playcheck` | 第一个 `MV / 100` = PlayCheck 该交易的 WAGERED |
| `payout_matches_game` | `sum(MG)` 或 `sum(MG)/100` = 游戏响应 `financials.win` |

- 一整轮 Bonus / Free Spins 是**一笔交易**，其所有 SPIN（如 0–29）都在同一个字符串里

## 7. 结论
- `verdict = FAIL`：任一 PlayCheck 核对未通过
- `verdict = REVIEW`：存在任意 finding 或 warning，需要 QA 人工确认
- `verdict = CLEAN`：以上都没有

## 8. 输出约束
- 所有报告写入 `server/data/artifacts/`
- 命名：`portugal_plugin_{GAME_CODE}_{execution_id}.txt / .json / .html`
- 下载地址：`/api/records/artifacts/{文件名}`

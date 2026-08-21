# SKILL: SLOT测试表格数据清洗规则

## 1. 核心定位
SLOT测试表格专属清洗、过滤、标准化技能，为数据生成Agent提供约束规范。

## 2. 数据清洗规则

### Rule 1: Module ID 提取
- 读取表格单元格 A1
- 使用正则 `Module\s*ID\s*#?:?\s*(\d+)` 匹配
- 提取整数模块ID（例如 `105359`）

### Rule 2: Batch & Index 清理
- 格式要求：`^\d+,\d+$`
- 移除所有末尾文本和注释（例如 `with max meter`）
- 只保留 `batch,index` 纯格式

### Rule 3: 文件分类命名规则
- **游戏前缀**：默认为 `P5P_`（可根据游戏自定义）
- **Regular Wins 文件**：合并 `micro win`, `Small win`, `Medium win`, `Large win` → `{GamePrefix}_Base game_Regular Wins.testdata`
- **Big Wins 文件**：合并 `Big win`, `Mega win`, `Epic Win`, `Super Win` → `{GamePrefix}_Base game_Big Wins.testdata`
- **BetLines 文件**：合并所有 20 条线（`0` 到 `19`）→ `{GamePrefix}_Base game_Betlines.testdata`
- **特色触发文件**：每个特定场景独立文件，例如 `{GamePrefix}_Bonus Feature_MINI Prize.testdata`

## 3. 输出约束
- 必须输出标准结构化 JSON
- 每条记录必须包含：`case_name`, `format_type` (SINGLE/DOUBLE_PREGEN), `module_id`, `base_batch`, `base_index`, `bonus_batch` (nullable), `bonus_index` (nullable), `file_name`

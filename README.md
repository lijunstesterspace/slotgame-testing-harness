# Testdata Updating Tool

> 老虎机（Slot Machine）`.testdata` 测试数据批量生成与自动化验证工具集。支持单组/嵌套 Bonus 双组两种格式，提供 CLI 命令行、交互式、网页 GUI 三种使用方式，并可通过 Selenium 自动化浏览器验证生成的数据是否与游戏实际输出一致。

## 功能特性

-  **多格式输入解析**：自动识别 `batch,index` 单对与 Bonus 嵌套双对（Base + Bonus）两种数据格式
-  **批量文件生成**：一次输入可同时生成多个 `.testdata` XML 文件，支持文件头分隔或行内命名
-  **三种使用模式**：
   - Python CLI 命令行（参数 + 管道 + 文件输入）
   - Python 交互式向导（含剪贴板自动识别）
   - 纯前端网页 GUI（实时预览 + ZIP 打包下载，无需安装环境）
-  **自动化验证**：通过 Selenium + Chrome 打开游戏页面，监听控制台日志，比对预期与实际 `(batch, index)`，自动截图并生成美观的 HTML 报告
-  **自带 Mock 游戏**：内置模拟游戏页面，可在无真实游戏环境时调试验证流程

## 目录结构

```
testdata updating tool/
├── generate_testdata.py     # .testdata 生成器 (Python CLI / 交互式)
├── verify_testdata.py       # 自动化验证器 (Selenium + HTML 报告)
├── generator_gui.html       # 可视化网页版生成器 (开箱即用)
├── mock_game.html           # 模拟游戏页面 (调试验证器用)
├── report.html              # 示例验证报告
├── screenshots/             # 验证过程截图保存目录
└── README.md                # 本文件
```

## 快速开始

### 方式零：AI 助手前端（React/Vite）

项目内置一个前端界面（`src/`），用于以“AI Agent 工作台”的方式串联：输入意图 → 生成 testdata →（可选）真实环境验证。

```bash
# 1) 安装依赖（推荐用 lockfile 保证一致性）
npm ci

# 2) 启动开发服务器
npm run dev
```

启动后浏览器打开 `http://localhost:3000/`。

#### 双击启动（Windows）

如果你希望不记命令、直接双击启动：运行根目录的 `start-dev.cmd` 即可（会在依赖缺失时自动执行一次 `npm ci`）。

如果同事电脑还没安装 Node.js / npm：
- `npm` 会随 Node.js 一起安装（安装 Node.js LTS 即可）。
- `start-dev.cmd` 会检测 `node` 是否存在：若系统有 `winget`，可选择自动安装 Node.js LTS；否则会自动打开 Node.js 下载页面。

如果双击后窗口一闪就没了（常见于：点错文件、脚本启动前置检查失败、或 `npm run dev` 立刻报错退出）：
- 确认你双击的是 `start-dev.cmd`（不是 `README.md` 或其他 `.md` 文件；Windows 可能隐藏扩展名）
- 双击 `start-dev-debug.cmd`（会输出完整日志，并在失败时停住窗口）
  - 说明：在 Windows 批处理脚本里运行 `npm` 这类 `.cmd` 脚本必须用 `call`，否则会“执行完 npm 就直接退出当前脚本”，表现为闪退或后续步骤不执行。

#### （可选）LLM / Ollama

默认会通过 Vite 代理把 `/ollama` 转发到 `http://localhost:11434`（见 `vite.config.ts`），用于连接本机 Ollama。

- 如果你本机有 Ollama：确保 `11434` 端口可用，页面会显示 `OLLAMA Online`，可在 UI 中选择模型。
- 如果没有 Ollama：页面仍可打开，但会走离线/确定性逻辑（不影响你使用 Python/网页 GUI 生成器）。

#### 生产预览

```bash
npm ci
npm run build
npm run preview
```

`preview` 启动后终端会输出一个本地地址（通常为 `http://localhost:4173/`），浏览器打开即可。

### 方式一：网页版 GUI（推荐，零依赖）

直接用浏览器打开 `generator_gui.html`，粘贴数据 → 实时预览 → 一键下载 ZIP。

### 方式二：Python 生成器

```bash
# 交互式（含剪贴板自动检测）
python generate_testdata.py

# 命令行 + 文件输入
python generate_testdata.py -m 10539 -s BaseGame -c TestMode -f input_data.txt

# 管道输入
echo "Bonus_MINI  58,3  2,67933" | python generate_testdata.py -m 10539
```

### 方式三：自动化验证

```bash
# 手动点击 SPIN 验证
python verify_testdata.py -f generated_wins.testdata -u "https://your-game-url.com"

# 自动按空格触发 SPIN（间隔 5 秒）
python verify_testdata.py -f generated_wins.testdata -u "https://your-game-url.com" --auto-spin --spin-delay 5.0
```

## 安装依赖

生成器 (`generate_testdata.py`) 仅依赖 Python 标准库，**无需额外安装**。

验证器 (`verify_testdata.py`) 需要 Selenium：

```bash
pip install selenium
```

首次运行 `verify_testdata.py` 时若未安装 Selenium，脚本会自动执行 `pip install selenium`。此外还需要：

- 已安装 **Google Chrome** 浏览器
- 与 Chrome 版本匹配的 **ChromeDriver**（Selenium 4.6+ 会自动管理，无需手动下载）

## 输入数据格式

### Format A：块格式（带文件头分隔）

文件头支持 4 种写法：`[文件名]`、`# 文件名`、`== 文件名 ==`、或直接 `xxx.testdata`

```
# File_A_BaseSpins
21,4683
batch and index: 21, 4684

[File_B_Bonus]
58,3  2,67933
58,3  4,145
```

### Format B：单行命名格式（一行一个文件条目）

```
# 单对格式：文件名 + batch,index
Bonus Feature trigger_Ascend    58,3

# 双对格式（嵌套 Bonus）：文件名 + base_batch,base_index  bonus_batch,bonus_index
Bonus Feature_MINI Prize        58,3    2,67933
Bonus Feature_Maxi Prize        58,3    4,145
```

两种格式可以**混合粘贴**，解析器会自动识别并归类到对应文件。

## 生成的 .testdata XML 结构

### 单组 (Single Spin) 模板

```xml
<Test>
  <Key moduleID="10539" loginName="" />
  <Slot>
    <Spin stage="BaseGame" comment="TestMode">
      <PreGen batch="21" index="4683" />
    </Spin>
    <Spin stage="BaseGame" comment="TestMode">
      <PreGen batch="21" index="4684" />
    </Spin>
  </Slot>
</Test>
```

### 嵌套 Bonus (Double PreGen) 模板

```xml
<Test>
  <Key moduleID="10539" loginName="" />
  <Slot>
    <Spin stage="BaseGame">
      <PreGen batch="58" index="3"></PreGen>
      <Feature stage="Bonus">
        <PreGen batch="2" index="67933"></PreGen>
      </Feature>
    </Spin>
  </Slot>
</Test>
```

## generate_testdata.py 详细参数

| 参数 | 简写 | 默认值 | 说明 |
|------|------|--------|------|
| `--module` | `-m` | `10539` | 全局 moduleID |
| `--stage` | `-s` | `BaseGame` | 单组模板的 Spin stage 属性 |
| `--comment` | `-c` | `TestMode` | 单组模板的 Spin comment 属性 |
| `--output` | `-o` | `generated_wins.testdata` | 未命名数据的默认输出文件名 |
| `--file` | `-f` | — | 从指定文件读取输入数据（否则读 stdin/剪贴板） |

**交互式模式下**，脚本会优先尝试读取剪贴板，若检测到有效数据会提示是否直接使用。

## verify_testdata.py 详细参数

| 参数 | 简写 | 默认值 | 说明 |
|------|------|--------|------|
| `--file` | `-f` | **必填** | 待验证的 `.testdata` 文件路径 |
| `--url` | `-u` | **必填** | 游戏页面 URL |
| `--output` | `-o` | `report.html` | 生成的 HTML 报告保存路径 |
| `--auto-spin` | — | 关闭 | 启用后自动按空格键触发 SPIN |
| `--spin-delay` | — | `5.0` | 自动 SPIN 之间的间隔秒数 |

### 验证流程

1. 脚本启动 Chrome 并访问指定 URL
2. 用户在浏览器中完成登录、加载游戏
3. 切回控制台按 `Enter` 开始监听
4. 每次 SPIN 后，游戏页面的控制台必须输出形如 `batch: 58, index: 3` 的日志
5. 脚本自动捕获该日志，与 testdata 中解析的期望序列逐一比对
6. 每次比对都自动截取浏览器屏幕保存至 `screenshots/`
7. 全部 SPIN 完成后，在当前目录生成 HTML 报告（含总体统计、逐条详情、缩略图点击放大）

## 调试 Mock Game

使用自带的 `mock_game.html` 可以在无真实游戏时验证流程：

```bash
# 1. 开一个本地静态服务（任选其一）
python -m http.server 8000

# 2. 运行验证器，URL 指向 mock 页面
python verify_testdata.py ^
  -f P5P_Bonus_Mini.testdata ^
  -u "http://localhost:8000/mock_game.html" ^
  --auto-spin --spin-delay 1.0
```

Mock 页面预置了两条 SPIN 数据：`(58,3)` → `(2,67933)`，按空格或点击按钮都会在控制台输出日志。

## 常见问题

**Q: 验证器收不到 batch/index 日志？**
A: 请确保游戏页面的控制台确实以 `batch: X, index: Y` 格式输出（正则匹配，前后可以有其他文本）。可先打开浏览器 DevTools → Console 手动确认。

**Q: Chrome 启动失败或版本不兼容？**
A: 升级到最新版 Chrome 和 Selenium：`pip install --upgrade selenium`。Selenium 4.6+ 的 Selenium Manager 会自动下载匹配版本的 ChromeDriver。

**Q: 嵌套 Bonus 模式下，为什么 XML 里的 stage 固定是 BaseGame/Bonus 而忽略 CLI 的 --stage？**
A: 双组模板（4 个值）的语义是「Base Game 触发 Bonus」，因此写入时固定使用 `stage="BaseGame"` 外层 + `stage="Bonus"` 内层 Feature，与 --stage 参数无关（后者仅作用于单组模板）。

**Q: 文件名里包含中文或空格可以吗？**
A: 可以。解析器支持中英文文件名，空格分隔名与数字对时需注意文件名本身不要有连续多空格，建议使用 Tab 分隔。
测试测试

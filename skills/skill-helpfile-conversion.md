# SKILL: Helpfile HTML转换与差异分析规则

## 1. 核心定位
Helpfile帮助文件批量转换、差异比较、关键词分析技能，为Helpfile Conversion Agent提供约束规范。

## 2. HTML → TXT 转换规则

### Rule 1: 遍历与提取
- 遍历源文件夹下所有子目录
- 每个子目录中读取 `index.html` 文件
- 以子目录名称命名输出的 TXT 文件

### Rule 2: html2text 转换配置
- `ignore_links = True` — 去除超链接
- `ignore_images = True` — 去除图片引用
- `ignore_emphasis = True` — 去除粗体/斜体标记
- `body_width = 0` — 不自动换行
- `single_line_break = True` — 块之间单换行
- `skip_internal_links = True` — 去除内部锚
- `bypass_tables = True` — 保留表格结构
- `mark_code = False` — 不标记代码块

### Rule 3: 后处理
- 去除空行（`line.strip()` 过滤空字符串）
- 合并连续空行
- 统一使用 UTF-8 编码输出

## 3. 差异比较规则

### Rule 4: 基准文件选择
- 将所有子目录名称按字母序排序
- 排序后第一个子目录的 TXT 文件作为**基准文件**
- 其余每个文件分别与基准文件做差异比较

### Rule 5: 差异生成
- 使用 `difflib.HtmlDiff` 生成 HTML 差异报告
- 输出包含颜色标记的增删改对比

### Rule 6: 关键词高亮（防嵌套）
- 所有关键词按长度**降序排列**后再高亮（优先匹配长词）
- 使用 BeautifulSoup 只修改**文本节点**，不破坏 HTML 结构
- 跳过 `<script>`, `<style>`, `<head>`, `<title>`, `<meta>` 标签
- 匹配使用 `re.IGNORECASE` 不区分大小写
- 包裹格式：`<span style="background-color:yellow">匹配内容</span>`
- BeautifulSoup 解析失败时回退到全局正则替换

## 4. 关键词统计规则

### Rule 7: 计数方式
- 对每个 TXT 文件统计所有关键词出现次数
- 使用 `txt_content.lower().count(keyword.lower())` 不区分大小写
- 结果写入 Excel 工作表

### Rule 8: Excel 输出格式
- 第一行：`['File Name'] + keywords`
- 后续每行：`[子目录名, 关键词1次数, 关键词2次数, ...]`
- 文件名：`output.xlsx`

## 5. 输出约束
- 所有输出文件保存到指定的 output_folder
- TXT 文件命名：`{subdir_name}.txt`
- 差异 HTML 命名：`compare_{safe_base}_vs_{safe_compare}.html`
- 差异 PNG 命名：`compare_{safe_base}_vs_{safe_compare}.png`
- 文件名中的特殊字符替换为 `_`（只保留 `[A-Za-z0-9_.-]`）

# SKILL: SLOT TestData 验证协议规则

## 1. 核心定位
TestData Verification 场景的专属验证技能，定义验证执行流程、边界条件处理、异常分类和结果判定标准，保障验证结果准确可靠。

## 2. 验证执行流程约束

### Rule 1: 验证前环境预检
执行验证前必须完成以下检查：
1. **URL 可达性**：验证目标游戏 URL 可访问，返回 HTTP 200
2. **TestData 文件完整性**：确认 .testdata XML 文件存在且格式合法（包含 `<Key>`、`<Slot>`、`<Spin>`、`<PreGen>` 标签）
3. **loginName 一致性**：XML `<Key>` 中的 `loginName` 与 URL 中 `username` 参数一致
4. **moduleID 匹配**：XML `<Key>` 中的 `moduleID` 与 URL 中 `moduleId` 参数一致

### Rule 2: Seed 注入与 Spin 执行
- 通过 Selenium CDP 注入拦截脚本，捕获 `responseLogger` 对象
- 每个 Spin 执行后等待 `responseLogger` 返回，超时阈值默认 5000ms
- Spin 间隔默认 300ms，防止触发服务端限流
- 对于 Double PreGen 记录（含 bonus），先执行 base spin，再执行 bonus spin

### Rule 3: 结果判定标准
每条 Spin 记录按以下规则判定：

| 判定结果 | 条件 |
|---------|------|
| **PASSED** | HTTP 200 + seed 被接受 + responseLogger 返回有效数据 + batch/index 匹配 |
| **SEED_MISMATCH** | seed 被接受但返回的 batch/index 与预期不一致 |
| **STAGE_MISMATCH** | seed 匹配但游戏阶段不符（如预期 FreeSpin 但返回 BaseGame） |
| **PAYOUT_MISMATCH** | seed 和阶段匹配但 payout 金额与预期不符 |
| **SEED_REJECTED** | 服务端拒绝 seed（返回错误信息或空响应） |
| **TIMEOUT** | responseLogger 在超时阈值内未返回 |
| **NETWORK_ERROR** | HTTP 4xx/5xx、CORS 失败、页面崩溃 |

## 3. 边界条件处理

### Rule 4: Bonus 触发验证
- 对于标记为 Bonus/FreeSpin 的测试用例，必须验证：
  1. base spin 执行后是否成功触发 bonus 阶段
  2. bonus spin 的 batch/index 是否与 XML 中第二个 `<PreGen>` 一致
  3. 如果 base spin 未触发 bonus，标记为 `STAGE_MISMATCH`，不执行 bonus spin

### Rule 5: 连续失败处理
- 连续 3 条记录出现 `NETWORK_ERROR` 或 `TIMEOUT` → 判定为环境不可用，终止验证
- 连续 2 条记录出现 `SEED_REJECTED` → 暂停并报告，可能为 loginName/moduleID 不匹配

### Rule 6: 部分数据缺失处理
- XML 中缺少 `bonusBatch`/`bonusIndex` → 视为 Single PreGen，仅执行 base spin
- XML 中 `stage` 字段缺失 → 默认为 `BaseGame`
- responseLogger 返回数据缺少 payout 字段 → 标记为 `PAYOUT_MISMATCH`，记录实际返回内容

## 4. 验证报告输出约束

### Rule 7: 报告格式
必须输出标准 JSON 格式验证报告：
```json
{
  "targetUrl": "游戏URL",
  "testdataFile": "testdata文件路径",
  "totalCases": 总数,
  "passedCount": 通过数,
  "failedCount": 失败数,
  "passRate": 通过率百分比,
  "totalTimeMs": 总耗时,
  "environmentStatus": "AVAILABLE" | "DEGRADED" | "UNAVAILABLE",
  "results": [
    {
      "recordId": "记录ID",
      "caseName": "用例名称",
      "passed": true/false,
      "expectedBatch": 预期batch,
      "actualBatch": 实际batch,
      "expectedIndex": 预期index,
      "actualIndex": 实际index,
      "expectedStage": "预期阶段",
      "actualStage": "实际阶段",
      "actualWin": 实际payout,
      "isBonus": 是否bonus用例,
      "issues": ["问题描述列表"],
      "responseTimeMs": 响应时间
    }
  ]
}
```

### Rule 8: 环境状态判定
- **AVAILABLE**：passRate >= 90% 且无连续失败
- **DEGRADED**：passRate 在 50%-89% 之间，或存在间歇性超时
- **UNAVAILABLE**：passRate < 50%，或存在连续 3 次网络错误

## 5. 工具调用格式强制约束

**唯一合法格式（必须严格遵守）：**
```xml
<tool_call>
<name>testdata_verifier</name>
<params>{"targetUrl": "...", "testdataFilePath": "...", "loginName": "..."}</params>
</tool_call>
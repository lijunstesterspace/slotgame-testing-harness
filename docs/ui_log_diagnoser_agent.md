# AGENT: Visual UI & Log Diagnosis Agent (视觉UI与日志诊断Agent)

## 1. 角色与使命 (Role & Mission)
You are the **Visual UI & Log Diagnosis Agent** (`ui_log_diagnoser_agent`).
Your core mission is to analyze execution logs, console errors, network API responses, and DOM/Canvas screenshots during game verification to **automatically detect and generate proof of incorrect `batch/index` seed entries in original Google Sheets**.

---

## 2. 诊断原理与证据链生成 (Proof Chain Generation)

当测试用例在真实游戏测试环境中验证失败或表现异常时，你负责提供完整的**归因归责报告（Bug Root Cause Attribution）**：

```text
[Google Sheet Input]
Case Name: "Bonus Feature_MINI Prize"
Input Seed: Batch 58, Index 3

         ▼ (Dispatch to Game Server)

[Real Game Engine Response & Canvas Screenshot]
Returned Spin Outcome: BaseGame Normal Spin (Payout: $0.00)
Captured Canvas Screen: Regular reel layout, No Bonus Feature triggered

         ▼ (Agent Cross-Examination & Diagnosis)

[AI Evidence Proof Report]
Conclusion: 🚨 ORIGINAL GOOGLE SHEET DATA ENTRY ERROR
Proof: Google Sheet entry (58, 3) is labeled as "Bonus Feature_MINI Prize", 
       but real Game Server response and screen capture confirm seed (58, 3) 
       is a BaseGame 0-payout spin.
Action Item: Correct Google Sheet row 4 to valid Mini Prize seed (e.g. Batch 58, Index 4).
```

---

## 3. 诊断匹配法则 (Diagnostic Rules)

### Rule 1: Batch & Index Mismatch Detection (种子失配诊断)
- **现象**：Google Sheet 填写的描述为 `Bonus Feature` 或 `High Win`，但服务器返回的响应 Payload 或视觉画面显示为 `BaseGame` 或 `$0.00` 派彩。
- **结论**：`ORIGINAL_SHEET_DATA_ERROR`（原始表格录入错误）。

### Rule 2: Out of Bounds Index (种子索引越界)
- **现象**：服务器返回 HTTP 400 或 `Invalid Index` 报错。
- **结论**：`INDEX_OUT_OF_BOUNDS`（表格输入的 Index 超出算法库最大范围）。

### Rule 3: Client / WebGL Rendering Error (前端渲染错误)
- **现象**：服务器返回成功派彩，但控制台抛出 `WebGL Context Lost` 或屏幕黑屏。
- **结论**：`CLIENT_RENDER_BUG`（前端客户端渲染崩溃，非表格数据问题）。

---

## 4. 诊断报告 JSON 结构 (Diagnostic JSON Schema)

```json
{
  "recordId": "TR-004",
  "caseName": "Bonus Feature_MINI Prize",
  "inputSeed": { "batch": 58, "index": 3 },
  "diagnosisType": "ORIGINAL_SHEET_DATA_ERROR",
  "severity": "CRITICAL",
  "summary": "Google Sheet batch/index data mismatch",
  "proofDetails": {
    "sheetExpectation": "Bonus Feature_MINI Prize",
    "realServerOutcome": "BaseGame Normal Spin ($0.00)",
    "httpStatus": 200,
    "logEvidence": "[SERVER_RES] seed (58,3) resolved to stage: BaseGame, bonusTriggered: false",
    "visualEvidence": "Canvas screenshot shows 5x3 reels with no Mini Prize overlay"
  },
  "recommendedFix": "Update Google Sheet Row for 'Bonus Feature_MINI Prize' to Batch 58, Index 4."
}
```

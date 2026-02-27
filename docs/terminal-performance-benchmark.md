# Terminal Performance Benchmark

本文档定义 FluxTerm 的终端性能基准流程，用于跨版本回归对比。

## 1. 目标与原则

- 目标：稳定比较不同版本在相同负载下的渲染性能与交互延迟。
- 原则：同一台机器、同一窗口尺寸、同一 profile、同一录制时长。
- 结果：每个版本至少 3 次，取中位数写入 JSON。

## 2. 压测脚本

脚本路径：`scripts/terminal-bench.ps1`

常用命令：

```powershell
# 中负载（30s）
powershell -ExecutionPolicy Bypass -File .\scripts\terminal-bench.ps1 -Profile medium -DurationSeconds 30

# 高负载（45s）
powershell -ExecutionPolicy Bypass -File .\scripts\terminal-bench.ps1 -Profile high -DurationSeconds 45

# 极限负载（60s）
powershell -ExecutionPolicy Bypass -File .\scripts\terminal-bench.ps1 -Profile extreme -DurationSeconds 60
```

可选参数：

- `-LinesPerSecond`：覆盖 profile 默认行速率。
- `-LineLength`：覆盖 profile 默认单行长度。
- `-Seed`：固定随机内容，保证复现性。
- `-Tag`：写入日志前缀，便于录制时定位。

## 3. DevTools 采样流程

1. 启动同一构建版本的 FluxTerm。
2. 将窗口固定为同一尺寸（建议 1440x900）。
3. 打开 DevTools Performance 面板。
4. 点击录制（Record）。
5. 在终端执行同一条压测命令（例如 `high 45s`）。
6. 压测结束后停止录制。
7. 记录以下指标：
   - `fpsMedian`
   - `longTaskTotalMs`
   - `inputLatencyP95Ms`
   - `mainThreadBusyPct`
8. 同一版本重复 3 次，写入中位数。

## 4. 结果文件格式

每个版本保存一个 JSON，建议目录：`bench-results/`。

示例：

```json
{
  "version": "0.1.0-alpha.2",
  "date": "2026-02-27",
  "profile": "high-45s",
  "notes": "webgl + gutter raf/incremental",
  "metrics": {
    "fpsMedian": 57.2,
    "longTaskTotalMs": 412.0,
    "inputLatencyP95Ms": 34.0,
    "mainThreadBusyPct": 71.5
  }
}
```

## 4.1 从模板创建版本结果

先复制模板，再填写本次版本数据：

```powershell
Copy-Item .\bench-results\template.json .\bench-results\0.1.0-alpha.2.json
```

建议仅修改以下字段：

- `version` / `date` / `profile` / `notes`
- `environment.renderer`（`canvas` 或 `webgl`）
- `metrics` 下四个指标（填写 3 次结果的中位数）

## 5. 版本对比

脚本路径：`scripts/compare-bench.ps1`

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\compare-bench.ps1 `
  -Baseline .\bench-results\0.1.0-alpha.1.json `
  -Current .\bench-results\0.1.0-alpha.2.json `
  -RegressionThresholdPct 10
```

输出包含：

- 一行 JSON 摘要：是否存在回归、阈值、版本信息。
- 表格：各指标的基线值、当前值、变化率与回归标记。

说明：

- `fpsMedian` 越高越好。
- `longTaskTotalMs` / `inputLatencyP95Ms` / `mainThreadBusyPct` 越低越好。
- 默认回归阈值为 10%。

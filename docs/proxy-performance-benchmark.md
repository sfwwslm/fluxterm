# Proxy 性能压测基线

本文档定义 FluxTerm 代理子应用的本地压测流程与结果格式，覆盖连接并发、吞吐与突发断连场景。

## 1. 目标

1. 评估代理在高并发短连接下的成功率与握手时延。
2. 评估代理在持续流量下的吞吐能力（上/下行 Mbps）。
3. 评估代理在突发断连下的稳定性（失败率、资源回收表现）。

## 2. 脚本

脚本路径：`scripts/proxy-bench.js`

说明：

1. 脚本会自动启动一个本地 echo 上游服务（127.0.0.1 随机端口），避免外部网络波动影响结果。
2. 脚本通过你的代理（HTTP 或 SOCKS5）连到本地 echo，上报三阶段指标。
3. 输出默认为 pretty JSON，可切换为单行 JSON 便于落盘。

## 3. 前置条件

1. 先在 FluxTerm 中启动一个代理实例（HTTP 或 SOCKS5）。
2. 确认 Node.js 可用（建议 Node 18+）。

## 4. 常用命令

```powershell
# HTTP 代理基线（默认参数）
node .\scripts\proxy-bench.js --protocol http --proxyHost 127.0.0.1 --proxyPort 7890

# SOCKS5 代理基线
node .\scripts\proxy-bench.js --protocol socks5 --proxyHost 127.0.0.1 --proxyPort 1080

# 启用认证（HTTP/SOCKS5 都适用）
node .\scripts\proxy-bench.js --protocol socks5 --proxyHost 127.0.0.1 --proxyPort 1080 --authUser demo --authPass demo

# 输出单行 JSON 并写入结果文件
node .\scripts\proxy-bench.js --protocol http --proxyHost 127.0.0.1 --proxyPort 7890 --output json > .\bench-results\proxy-http-local.json
```

## 5. 关键参数

1. `--connectConcurrency`：连接并发数（默认 80）。
2. `--throughputConnections`：吞吐阶段并发连接数（默认 24）。
3. `--throughputSeconds`：吞吐阶段持续秒数（默认 12）。
4. `--payloadBytes`：每次回环数据量（默认 32768）。
5. `--burstTotal`：突发阶段总连接数（默认 600）。
6. `--burstConcurrency`：突发阶段并发上限（默认 100）。
7. `--burstAbruptRatio`：突发阶段立即断连比例（默认 0.35）。
8. `--timeoutMs`：连接/读写超时毫秒（默认 5000）。

## 6. 输出字段说明

1. `phases.connect`：并发连接指标，关注 `success/failed/connectP95Ms`。
2. `phases.throughput`：吞吐指标，关注 `mbpsOut/mbpsIn/failed`。
3. `phases.burst`：突发断连指标，关注 `failed` 与 `abruptClosed`。

示例（节选）：

```json
{
  "kind": "proxy-benchmark-v1",
  "target": {
    "protocol": "http",
    "proxyHost": "127.0.0.1",
    "proxyPort": 7890
  },
  "phases": {
    "connect": {
      "success": 80,
      "failed": 0,
      "connectP95Ms": 31.42
    },
    "throughput": {
      "mbpsOut": 412.77,
      "mbpsIn": 412.77,
      "failed": 0
    },
    "burst": {
      "total": 600,
      "failed": 0
    }
  }
}
```

## 7. 基线建议

1. 同一台机器同一构建版本至少执行 3 次，记录中位数。
2. 分别记录 HTTP 与 SOCKS5 基线，不混合比较。
3. 发布前对比上一个版本：
   - `connectP95Ms` 上升 > 20% 视为疑似回归。
   - `mbpsOut/mbpsIn` 下降 > 15% 视为疑似回归。
   - `failed` 非零需要排查并附带埋点日志片段。

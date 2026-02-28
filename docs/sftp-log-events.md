# SFTP 日志埋点说明

本文档定义 `engine` 中 SFTP 上传与下载日志的事件名和字段约定，便于本地排查、后续接入日志平台以及做传输链路分析。

## 1. 事件列表

- `sftp_upload_start`：开始上传本地文件到远端。
- `sftp_upload_success`：上传完成。
- `sftp_upload_failed`：上传失败。
- `sftp_download_start`：开始从远端下载文件到本地。
- `sftp_download_success`：下载完成。
- `sftp_download_failed`：下载失败。

## 2. 通用字段

- `session_id`：当前 SSH 会话 ID。
- `started_at_ms`：操作开始时间，Unix 时间戳，单位毫秒。
- `elapsed_ms`：从开始到结束或失败时的总耗时，单位毫秒。
- `total_bytes`：文件总大小，单位字节；如果无法提前获取则记为 `0`。
- `transferred_bytes`：当前已传输字节数，单位字节。

## 3. 路径字段

为保持上传和下载日志结构统一，成功/失败日志统一使用下面两个字段：

- `source_path`：源文件路径。
- `target_path`：目标文件路径。

对应关系如下：

- 上传：`source_path=local_path`，`target_path=remote_path`
- 下载：`source_path=remote_path`，`target_path=local_path`

开始日志保留更直观的原始字段名：

- 上传开始：`local_path`、`remote_path`
- 下载开始：`remote_path`、`local_path`

## 4. 成功日志字段

除通用字段外，成功日志额外包含：

- `avg_bytes_per_sec`：平均传输速率，按 `transferred_bytes / elapsed_ms` 计算，单位字节每秒。

## 5. 失败日志字段

除通用字段外，失败日志额外包含：

- `error_code`：引擎错误码。
- `error_message`：引擎错误消息。
- `error_detail`：底层错误详情，没有时为空字符串。

下载过程中如果在读取或写入中途失败，`transferred_bytes` 会记录失败前已经成功传输的真实字节数，而不是固定写成 `0`。

## 6. 示例

```text
sftp_upload_start session_id=... local_path=C:\tmp\a.txt remote_path=/home/user/a.txt started_at_ms=1740732000123 total_bytes=1024

sftp_upload_success session_id=... source_path=C:\tmp\a.txt target_path=/home/user/a.txt started_at_ms=1740732000123 elapsed_ms=86 transferred_bytes=1024 total_bytes=1024 avg_bytes_per_sec=11906

sftp_download_failed session_id=... source_path=/home/user/big.iso target_path=D:\download\big.iso started_at_ms=1740732001123 elapsed_ms=2310 transferred_bytes=10485760 total_bytes=52428800 error_code=sftp_transfer_failed error_message=无法写入文件数据 error_detail=...
```

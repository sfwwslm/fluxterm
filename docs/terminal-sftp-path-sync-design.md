# 终端与文件管理器路径联动设计

## 目标

让终端当前工作目录与文件管理器目录保持联动。

当前设计目标：

- 优先消费 `OSC 7` 工作目录上报
- 在缺少 `OSC 7` 时提供 prompt fallback
- 为 Windows `cmd.exe` 提供独立 fallback
- 同一套 cwd 获取模型同时适用于本地与远端会话
- 不破坏终端原生交互体验

## 总体模型

路径联动分成两层：

1. `cwd 来源层`
2. `目标驱动层`

### `cwd 来源层`

`cwd 来源层`只负责回答一件事：

- 当前终端会话能否提供可靠 cwd

统一优先级如下：

1. `OSC 7`
2. prompt 解析
3. `cmd` 解析
4. `unsupported`

含义如下：

- `OSC 7`
  - shell 通过协议显式上报 cwd
  - 是最高优先级真值
  - 本地与远端统一适用
- prompt 解析
  - 用于类 Unix shell 的文本 fallback
  - 主要覆盖 bash 常见提示符
- `cmd` 解析
  - 用于 Windows `cmd.exe` 的文本 fallback
  - 独立于 bash/zsh 提示符规则
- `unsupported`
  - 表示当前拿不到可靠 cwd

### `目标驱动层`

`目标驱动层`只负责回答另一件事：

- 拿到 cwd 之后，应该驱动哪个文件系统视图，以及是否允许继续驱动

这一层区分三种目标：

- `local-fs`
- `remote-sftp`
- `none`

这一层处理的约束包括：

- 本地与远端路径语义差异
- 远端 SFTP 可用性
- 文件管理器是否可见
- 远端登录身份一致性保护

## cwd 来源规则

### `OSC 7`

收到 `OSC 7` 时，直接以协议上报的 cwd 为准。

规则：

- `OSC 7` 优先级高于所有文本解析结果
- 同一段输出中如果既有 `OSC 7` 又能匹配出 prompt 路径，优先使用 `OSC 7`
- `OSC 7` 可同时服务本地与远端会话

### prompt fallback

类 Unix shell 的 fallback 使用 prompt 文本解析。

当前识别的 bash 常见形态：

- `user@host:/abs/path$`
- `user@host:~/path$`
- `/abs/path$`
- `~/path$`

上报字段：

- 当前 shell 用户名
- 当前工作目录路径

### `cmd` fallback

Windows `cmd.exe` 的 fallback 使用标准提示符解析。

当前识别的常见形态：

- `C:\Users\name>`
- `D:\repo\app>`
- `\\server\share\dir>`

`cmd` fallback 只负责提取当前目录，不复用 bash/zsh 的提示符规则。

## 各类 shell 的联动路径

- bash
  - 优先使用 `OSC 7`
  - 缺少 `OSC 7` 时回退到 prompt 解析
- zsh / sh / 其他类 Unix shell
  - 优先使用 `OSC 7`
  - 没有 `OSC 7` 时仅在提示符可稳定还原 cwd 的情况下联动
- Windows `cmd.exe`
  - 优先使用 `OSC 7`
  - 缺少 `OSC 7` 时回退到 `cmd` 提示符解析

## 用户配置

会话级开关：

- `终端路径联动文件管理器`

配置行为：

- 开启后启用 cwd 获取与文件视图驱动
- 关闭后停止消费 cwd 上报并停止驱动文件管理器
- 配置写入 `session.json`

## 状态模型

### cwd 来源

- `osc7`
- `prompt`
- `cmd`
- `none`

### cwd 能力状态

- `supported`
- `unsupported`

### 联动状态

- `active`
- `paused-mismatch`
- `disabled`

### 驱动目标

- `local-fs`
- `remote-sftp`
- `none`

## UI 状态映射

文件管理器路径栏前展示压缩后的联动状态：

- `联动中`
  - 已拿到可靠 cwd
  - 当前目标驱动层允许继续联动
- `联动已暂停`
  - 已拿到可靠 cwd
  - 远端驱动层因身份不一致等原因暂停联动
- `不支持联动`
  - 功能开启
  - 当前拿不到可靠 cwd
- `联动已关闭`
  - 用户主动关闭联动功能
- `检测中`
  - 远端会话尚在完成首轮可用性判断

## 远端身份一致性保护

远端 `remote-sftp` 驱动层使用 shell 用户与 SSH 初始登录用户的一致性保护。

规则：

- 一致时允许继续联动
- 不一致时进入 `paused-mismatch`
- 恢复一致时自动恢复联动

这条保护只作用于远端驱动层，不影响本地文件系统联动。

相关日志事件：

- `terminal:cwd-sync-paused-user-mismatch`
- `terminal:cwd-sync-resumed-user-match`

## `~` 语义

当 cwd 来源是 prompt 且路径以 `~` 表示时，使用当前会话已知 home 做展开。

规则：

- 绝对路径优先
- `~` 与 `~/subdir` 依赖已知 home 展开
- home 未知时不强行同步

## 终端与文件管理器的关系

联动方向保持为：

- 终端驱动文件管理器

不做反向行为：

- 文件管理器不反向驱动 shell cwd

## 已知边界

- 无 `OSC 7` 时，不保证所有 zsh/sh 提示符都能稳定还原 cwd
- 无 `OSC 7` 时，不保证高度自定义 `PS1` / prompt 主题可联动
- 不保证高度自定义 `cmd.exe` `PROMPT` 变体可联动
- 远端用户身份不一致时不会继续驱动 `remote-sftp`

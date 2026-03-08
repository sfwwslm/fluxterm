# 本地 Shell 终端/字符集配置生效说明

本文档描述当前代码中已经落地并生效的本地 Shell 终端参数能力。

## 1. 已实现能力

1. 前端可配置本地 Shell 的 `终端类型(TERM)` 与 `字符集`。
2. 配置保存到 `settings.json` 的 `localShellLaunchConfig` 与 `localShellByShellId`。
3. 本地会话连接时，前端会把配置通过 `local_shell_connect` 传给后端。
4. 后端在启动本地 Shell 前写入环境变量，确保参数真实生效。
5. 本地会话重连会复用同一套启动配置。

当前 UI 展示策略：

1. `shell` 分组隐藏 `系统` 字段。
2. `ssh` 分组隐藏 `字符集` 字段。
3. 隐藏仅限 UI 展示层，数据字段仍保留，便于后续启用。

## 2. 配置模型

前端类型定义：

```ts
type LocalShellLaunchConfig = {
  terminalType?:
    | "xterm-256color"
    | "xterm"
    | "screen-256color"
    | "tmux-256color"
    | "vt100";
  charset?: "utf-8" | "gbk" | "gb18030";
};
```

设置文件字段：

```ts
type AppSettings = {
  // ...
  localShellLaunchConfig?: LocalShellLaunchConfig;
  localShellByShellId?: Record<string, LocalShellLaunchConfig>;
};
```

解析优先级（高 -> 低）：

1. `localShellByShellId[shellId]`
2. `localShellLaunchConfig`
3. 内置默认值

内置默认值：

1. `terminalType`: `xterm-256color`
2. `charset`: `utf-8`

## 3. 连接链路

1. 用户在 `ProfileModal` 的 shell 页保存配置。
2. `AppShell` 将配置写入 `useAppSettings.localShellLaunchConfig`，并在存在 `shellId` 时写入 `localShellByShellId[shellId]`。
3. `useSessionStateCore` 连接本地 Shell 时按 `shellId` 解析有效配置，并在 payload 中附带 `launchConfig`。
4. `src-tauri/src/commands/local_shell.rs` 接收并透传给 `start_local_shell`。
5. `src-tauri/src/local_shell.rs` 将配置写入 `CommandBuilder::env` 后启动子进程。

## 4. 后端生效规则

`terminalType`：

1. 支持值：`xterm-256color / xterm / screen-256color / tmux-256color / vt100`
2. 非法或缺失时使用 `xterm-256color`
3. 启动前直接设置 `TERM`

`charset`：

1. 非 Windows 平台会设置 `LC_CTYPE` 与 `LANG`
2. 映射关系：
   1. `utf-8` -> `en_US.UTF-8`
   2. `gbk` -> `zh_CN.GBK`
   3. `gb18030` -> `zh_CN.GB18030`
3. Windows 当前不注入 `chcp`，避免 shell 启动阶段产生额外输出或续行副作用。

## 5. 运行时行为

1. 仅对新建/重连后的本地会话生效。
2. 已在运行中的会话不会动态改写环境变量。
3. 重连时复用 `localSessionMeta.launchConfig`，保持行为一致。

## 6. 验证方式

1. 在 shell 页选择终端类型并保存。
2. 新建本地会话后执行 `echo $TERM`，应输出所选终端类型。
3. 修改终端类型后重连，再次执行 `echo $TERM`，应更新为新值。
4. 选择不同字符集后，在 macOS/Linux 会话内执行 `locale`，可看到 `LANG/LC_CTYPE` 变化。
5. Windows 会话不执行 `chcp` 注入，字符集验证以 `TERM` 和实际交互行为为主。

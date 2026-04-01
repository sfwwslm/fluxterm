# RDP 远端音频播放实验记录

## 1. 文档目标

本文档记录 FluxTerm 当前“远端播放到本机”实验的实现状态、复现现象、排障过程与阶段性结论。

目标是为后续继续验证 `IronRDP rdpsnd` 能力提供上下文，避免重复试验和重复排查。

本文档以 2026-04-01 当前工作区状态为准。

## 2. 本轮实验范围

本轮只实验：

- RDP 远端音频输出重定向到本机
- 会话级静音与音量控制

本轮明确不包含：

- 麦克风输入回传
- 文件传输
- RDP 原生文件重定向
- 依赖 SSH / SFTP 的替代方案

## 3. 当前已落地改动

本轮已经在 FluxTerm 内落地了以下改动：

1. 在 `crates/rdp_core` 中启用了 `IronRDP` 的 `rdpsnd` feature
2. 新增 `crates/rdp_core/src/audio.rs`
3. 在 `ironrdp_runtime` 中将 `enable_audio_playback` 从 `false` 改为 `true`
4. 为连接器注册了静态通道：
   - `rdpsnd`
   - `drdynvc`
   - `cliprdr`
5. 在 `src-tauri` 与前端子应用中补齐了：
   - `rdp_session_set_audio_muted`
   - `rdp_session_set_audio_volume`
   - 子应用状态栏静音按钮
   - 子应用状态栏音量滑杆
   - 音频状态展示
6. 本地播放后端使用 Rust 侧 `cpal`，不走前端 WebAudio

当前 `rdp_core` 中的音频协商策略为：

- 静态通道：`rdpsnd`
- 本地播放：`cpal`
- 当前声明的客户端格式以 PCM 为主，已扩大到多种常见组合

## 4. 实验环境与复现条件

本轮确认问题的复现环境如下：

- 客户端：FluxTerm 开发态运行
- 客户端操作系统：Windows
- 被连接主机：`10.121.110.238`
- 连接协议：RDP
- 用户名：`dptech`

复现路径：

1. 启动 FluxTerm
2. 通过 RDP 子应用连接目标主机
3. 观察子应用底部音频状态
4. 观察被连接 Windows 机器上的系统弹窗
5. 查看本地日志

## 5. 当前稳定复现现象

### 5.1 客户端表现

客户端 RDP 子应用中的音频状态会持续停留在：

- `音频协商中`

没有进入：

- `音频播放中`
- `已静音`
- `音频不可用`

### 5.2 远端 Windows 表现

被连接的 Windows 机器会弹系统提示：

`找不到音频设备。请确保耳机或扬声器已连接。有关更多信息，请在设备中搜索“管理音频设备”`

该提示来自远端机器，而不是 FluxTerm 本地。

### 5.3 本地日志表现

当前日志中可以看到：

- `rdpsnd` 已被注册进静态通道列表
- RDP 主连接完成
- `cliprdr` 后续正常初始化

但没有看到任何 `rdpsnd` 进入协商或收包的迹象。

## 6. 关键日志证据

以下日志已确认出现：

```text
[INFO][rdp_core::ironrdp_runtime] registering static virtual channels event="rdp.runtime.static_channels" ... channels="rdpsnd,drdynvc,cliprdr"
[INFO][ironrdp_async::connector] Connected with success
```

以下日志已确认出现，说明其他静态通道至少部分正常：

```text
[INFO][ironrdp_cliprdr] CLIPRDR(clipboard) virtual channel has been initialized
[INFO][ironrdp_cliprdr] CLIPRDR(clipboard) Remote has received format list successfully
```

以下类型的日志始终没有出现：

- `rdpsnd` 初始化完成
- 服务端下发 `ServerAudioFormatPdu`
- 选中音频格式
- 本地开始播放音频流

## 7. 已验证并排除的方向

本轮已经验证过以下方向，但都不能解释当前现象。

### 7.1 不是前端 UI 或状态显示问题

原因：

- 子应用音频状态直接依赖后端桥接事件
- 后端没有上报进入 `playing`
- 远端机器同时弹出系统级“找不到音频设备”

所以不是单纯 UI 没刷新。

### 7.2 不是本地 `cpal` 播放设备打开失败

原因：

- 如果是本地播放设备初始化失败，更像是本地 `audio error`
- 当前远端机器直接弹系统提示，表示它自身没有认为当前 RDP 会话里存在可用音频输出设备
- 日志里也没有任何一次进入播放后端的迹象

所以问题发生在更早的协议协商阶段。

### 7.3 不是仅仅因为 PCM 格式集合太窄

原因：

- 一开始只声明了单一 PCM 格式
- 后续已经扩大到多种常见 PCM 组合
- 但问题依旧，而且日志中仍没有任何 `rdpsnd` 协商消息

如果只是格式交集为空，通常至少应能看到 `rdpsnd` 收到服务端格式列表后再失败；当前连这一步都没有证据。

### 7.4 不是静态通道顺序遗漏导致完全未注册

原因：

- 已经在运行时中显式记录了静态通道注册顺序
- 日志确认 `rdpsnd` 已注册：

```text
channels="rdpsnd,drdynvc,cliprdr"
```

后续也试过将 `rdpsnd` 提前到注册顺序最前面，现象没有改变。

### 7.5 不是静态通道 ID 映射顺序不稳定

排查结果：

- `IronRDP` 当前使用的 `StaticChannelSet` 底层是 `BTreeMap`
- 通道迭代顺序是稳定的

因此“静态通道 ID 绑错对象”不是当前最优先怀疑项。

## 8. 当前最可能的结论

当前更可能的问题已经落到 `IronRDP` 上游实现层，而不是 FluxTerm 自己的业务接入层。

更具体地说，当前最像的问题是：

1. `FluxTerm` 已经把 `rdpsnd` 注册给了 `IronRDP`
2. 但服务端没有对该通道发出后续音频协商消息
3. 因此远端 Windows 没有创建出“Remote Audio”输出设备
4. 最终远端系统弹出“找不到音频设备”

换句话说：

- 不是“播放失败”
- 更像是“音频重定向设备根本没有建立成功”

## 9. 当前对上游 `IronRDP` 的判断

基于目前证据，可以初步判断：

- 问题大概率已经延申到上游 `IronRDP` 的 `rdpsnd` 客户端实现

可能方向包括但不限于：

1. `rdpsnd` 静态通道虽然注册了，但没有被服务端视为有效音频输出通道
2. `rdpsnd` 在当前 `IronRDP` 客户端路径下没有触发服务端后续 `AudioFormat` 下发
3. 当前分支在音频输出重定向上仍有某个协议兼容缺口

当前还没有足够证据证明是哪一条，但已经足够说明：

- 继续在 FluxTerm 前端或 Tauri 业务层兜圈子，收益很低

## 10. 后续建议实验路线

下一步建议改为做“最小复现”，而不是继续在 FluxTerm 里盲改。

推荐路线：

1. 基于 `IronRDP` 单独写一个最小客户端
2. 只保留最基础连接能力和 `rdpsnd`
3. 连接同一台远端主机 `10.121.110.238`
4. 增加更细的 `rdpsnd` 协商日志，确认是否收到：
   - `ServerAudioFormatPdu`
   - `TrainingPdu`
   - `Wave2Pdu`
5. 如果最小例子同样失败，则可以基本确认是上游问题
6. 再准备：
   - 最小复现代码
   - 关键日志
   - 服务端现象
   - 发给 `IronRDP` 上游 issue 或自行修补

## 11. 如果继续在 FluxTerm 内实验，建议补充的日志

如果后续仍想先在 FluxTerm 中追加诊断，优先建议补以下日志：

1. 连接期静态通道的 `ClientNetworkData` 详细内容
2. 服务端返回的 static channel id 列表
3. `rdpsnd` 对应的 channel id 是否被正确绑定
4. `x224` 路径上是否收到该 channel id 的任何数据
5. 如果收到，具体是哪个 `rdpsnd` PDU

这些日志的目标不是继续“修业务层”，而是为上游最小复现收集证据。

## 12. 当前结论摘要

截至本文档记录时，结论可以简化为：

- FluxTerm 已完成一版远端音频播放接入
- 当前问题不在前端 UI，也不像本地音频设备打开失败
- `rdpsnd` 已注册，但看不到后续协商
- 远端 Windows 明确认为当前 RDP 会话中没有可用音频设备
- 该问题大概率已进入 `IronRDP` 上游 `rdpsnd` 实现层
- 下一步应优先做最小复现


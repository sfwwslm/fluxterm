# RDP 主窗口组件与子应用拆分设计

## 1. 文档目标

本文档记录当前 FluxTerm RDP 功能在前端侧的职责边界与交互结构，供后续任务直接参考。

本文档只关注当前已经落地的产品与前端架构约束，不重复展开 `rdp_core`、桥接协议和 Rust 运行时历史。底层运行时背景请继续参考 [rdp-subapp-design.md](./rdp-subapp-design.md)。

## 2. 当前结论

当前 RDP 功能采用“两层入口 + 单一 runtime owner”模型：

- 主窗口：负责 `RDP Profile` 的列表、配置、编辑和发起连接
- RDP 子应用：负责远程桌面画面显示、输入、状态和会话标签

明确约束如下：

- `RDP Profile` 的配置入口只允许存在于主窗口
- RDP 子应用不再承载 Profile CRUD 或配置模态框
- 主窗口不能直接持有 RDP runtime
- RDP 子应用是唯一的 RDP 会话 runtime owner

## 3. 组件结构

### 3.1 主窗口

主窗口现在有两个与 RDP 相关的 UI 单元：

1. `RdpWidget`
2. `RdpProfileModal`

职责拆分如下：

- `RdpWidget`
  - 显示已保存的 RDP Profile 列表
  - 支持单击选中
  - 支持双击连接
  - 提供“刷新”和“配置”入口
  - 风格与“会话管理”组件保持一致
- `RdpProfileModal`
  - 负责新增、编辑、删除 RDP Profile
  - 采用左侧 Profile 列表 + 右侧详情编辑结构
  - 右侧继续分为 `连接信息 / 显示设置 / 安全与证书 / 会话操作`

### 3.2 RDP 子应用

RDP 子应用当前只保留以下职责：

- 顶部会话标签栏
- 中间远程画面视口
- 底部状态栏
- 远程输入采集
- 会话切换 / 关闭
- 证书确认、错误状态、连接状态展示

RDP 子应用中已经移除：

- 配置按钮
- 配置模态框
- RDP Profile 列表与草稿编辑状态
- Profile 保存 / 删除 / 新建交互

## 4. 主窗口与子应用通信

### 4.1 基本原则

主窗口只发送“意图”，不接管 RDP 会话运行时。

当前唯一保留的主窗口到子应用控制消息是：

- `subapp:rdp-connect`

消息负载只包含：

- `profileId`

### 4.2 连接流程

当前双击连接的链路是：

1. 用户在主窗口 `RdpWidget` 中双击某个 Profile
2. 主窗口调用 `useSubApps.connectRdpProfile(profile.id)`
3. `useSubApps` 负责：
   - 若 RDP 子应用未打开，则创建窗口
   - 若 RDP 子应用已打开，则聚焦复用
   - 在子应用 ready 后发送 `subapp:rdp-connect`
4. RDP 子应用收到 `profileId`
5. 子应用重新读取持久化的 Profile 列表，解析出对应 Profile
6. 子应用内部调用 `createRdpSession(profile.id)` 和 `connectRdpSession(sessionId)`

### 4.3 为什么不让主窗口直接建连接

原因如下：

- 避免主窗口和子应用各自维护一套会话状态机
- 避免 runtime source of truth 分裂
- 避免把远程桌面运行时逻辑扩散进主窗口域
- 保持“主窗口管理、子应用运行”的长期边界

## 5. 当前文件分工

### 5.1 主窗口域

- `src/widgets/rdp/components/RdpWidget.tsx`
  - RDP 列表型组件
- `src/main/components/modals/RdpProfileModal.tsx`
  - RDP Profile 配置弹窗
- `src/main/hooks/useSubApps.ts`
  - 负责唤起 / 复用 RDP 子应用并发送连接意图
- `src/main/AppShell.tsx`
  - 管理 `RdpProfileModal` 打开状态与 `RdpWidget` 的接线

### 5.2 子应用域

- `src/subapps/rdp/RdpSubApp.tsx`
  - 远程桌面显示壳层与输入/状态逻辑
- `src/subapps/rdp/rdp.worker.ts`
  - 离屏渲染与会话画面切换
- `src/subapps/rdp/WebGLRenderer.ts`
  - WebGL 画面渲染器

### 5.3 通信契约

- `src/subapps/core/lifecycle.ts`
  - 主窗口与子应用共享的生命周期/控制消息定义

## 6. 后续任务约束

后续任何 RDP 相关任务都应遵守以下约束：

1. 不要把 RDP 配置入口重新加回子应用
2. 不要在主窗口中直接创建或持有 RDP 会话 runtime
3. 如果新增 RDP Profile 字段，优先修改主窗口 `RdpProfileModal`
4. 如果新增 RDP 会话状态展示，优先修改 `RdpSubApp`
5. 如果新增“最近连接 / 收藏 / 分组”等管理能力，优先放在 `RdpWidget`
6. 如果新增“会话级操作”且属于 runtime 行为，例如截图、发送特殊键、断开当前会话，应优先放在子应用

## 7. 推荐演进方向

后续建议按下面顺序扩展：

1. 给 `RdpWidget` 增加右键菜单
2. 给 `RdpProfileModal` 增加字段校验与更完整的提示
3. 给 `RdpWidget` 增加搜索、分组、最近连接
4. 给 RDP 子应用增加 runtime 级操作菜单，例如发送剪贴板、断开当前会话、发送组合键

## 8. 不建议的方向

以下方向不建议继续采用：

- 在子应用中再次引入完整 Profile 管理面板
- 主窗口和子应用各自缓存并编辑一套 RDP Profile 草稿
- 让主窗口直接 `create/connect/disconnect` RDP session
- 为了掩盖 runtime 问题，在主窗口 widget 中做会话假状态或占位补丁

## 9. 一句话总结

当前 RDP 设计的核心原则是：

主窗口负责“管理和发起”，RDP 子应用负责“运行和显示”。

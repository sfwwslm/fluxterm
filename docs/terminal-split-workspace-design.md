# 终端拆分工作区设计

## 文档目标

本文档描述当前已经落地的终端拆分工作区实现，作为后续维护、排查问题和继续演进的参考。

这份文档只记录“当前真实实现”，不再复述已经放弃的外层 tab 方案。

## 当前结论

当前终端区域采用：

1. 单根工作区树模型。
2. Pane 作为可拆分区域。
3. 每个 Pane 顶部自带一条工作区栏。
4. Pane 内可以承载多个会话，并支持区域内会话排序。
5. 全局不再存在用户可见的“最顶部总工作区栏”。

## 核心状态模型

### 工作区状态

工作区状态定义在 `src/types.ts`：

```ts
type SessionPaneNode =
  | {
      kind: "leaf";
      paneId: string;
      sessionIds: string[];
      activeSessionId: string | null;
    }
  | {
      kind: "split";
      axis: "horizontal" | "vertical";
      ratio: number;
      first: SessionPaneNode;
      second: SessionPaneNode;
    };

type SessionWorkspaceState = {
  root: SessionPaneNode | null;
  activePaneId: string | null;
};
```

语义如下：

1. `root` 是唯一的终端工作区根节点。
2. `leaf` 表示一个实际可见的终端区域。
3. `leaf.sessionIds` 表示该区域内部的会话列表。
4. `leaf.activeSessionId` 表示该区域当前选中的会话。
5. `split` 表示区域拆分节点，`ratio` 保存分割比例。
6. `activePaneId` 表示当前全局活动区域。

### 活动会话派生

当前没有单独存储“独立的活动 tab”。`activeSessionId` 由工作区状态派生：

1. 先定位 `activePaneId` 对应的 leaf。
2. 再读取该 leaf 的 `activeSessionId`。
3. 若为空，则回退到该 leaf 最后一个会话。

这条逻辑位于 `src/features/session/core/workspaceReducer.ts` 的 `getActiveSessionIdFromWorkspace()`。

## 分层职责

### 会话状态层

入口：

- `src/features/session/hooks/useSessionStateCore.ts`
- `src/features/session/hooks/useSessionWorkspace.ts`
- `src/features/session/core/workspaceReducer.ts`

职责：

1. 管理 SSH / 本地 shell 连接生命周期。
2. 管理会话与工作区树的附着关系。
3. 维护 pane 拆分、区域聚焦、区域内会话排序、区域收缩。
4. 对 UI 暴露 pane 级操作接口。

### 终端运行时层

入口：

- `src/features/terminal/hooks/useTerminalRuntimeCore.ts`

职责：

1. 为每个 `sessionId` 管理一个 xterm 实例。
2. 处理 terminal 输出、输入、搜索、复制、链接菜单。
3. 维护完整会话文本缓存，保证 split 后重挂载仍能恢复内容。
4. 监听每个终端容器尺寸变化并执行 `fit/resize`。

### UI 编排层

入口：

- `src/components/terminal/sessions/TerminalPanel.tsx`
- `src/components/terminal/sessions/TerminalPaneTree.tsx`
- `src/components/terminal/sessions/useTerminalMenus.tsx`
- `src/components/terminal/sessions/TerminalSearchBar.tsx`

职责：

1. 把工作区树渲染成实际的 split 布局。
2. 为每个 Pane 渲染工作区栏。
3. 处理区域内会话右键菜单、拖拽排序和搜索栏显示。

## 关键交互语义

### 新建会话

当前新建会话不是总是创建新区域，而是：

1. 若工作区为空，创建一个根 leaf。
2. 若工作区已存在，则优先附着到当前活动区域。

这意味着：

1. 首个会话创建根区域。
2. 拆分后再新建会话，会进入当前活动区域。

### 拆分区域

当前拆分行为由 `splitActivePane()` 驱动。

规则如下：

1. 只对当前活动区域执行拆分。
2. 复制当前活动会话的连接来源：
   - 本地 shell 则创建新的本地 shell 会话
   - SSH 会话则使用同一个 profile 再创建一个新 SSH 会话
3. 原区域会变成 split 的第一子节点。
4. 新区域会变成 split 的第二子节点。
5. 新区域自动成为活动区域。

方向语义：

1. `horizontal` 表示左右拆分。
2. `vertical` 表示上下拆分。

### 区域工作区栏

每个 leaf pane 顶部都有一条 `terminal-header` 工作区栏。

这条栏负责：

1. 展示该区域内部的会话列表。
2. 切换该区域当前活动会话。
3. 区域内会话拖拽排序。
4. 当前会话右键菜单。
5. 当前会话关闭按钮。

当前没有独立的 pane 标题栏，也没有全局顶部工作区栏。

### 区域内关闭语义

右键菜单里的以下操作只对当前区域生效：

1. 关闭当前会话
2. 关闭其他会话
3. 关闭右侧会话
4. 关闭全部会话

关闭链路为：

1. 根据 `paneId` 找到该区域内的 `sessionIds`
2. 调用现有 `disconnectSession()`
3. reducer 通过 `detach-session` 从工作区树删除会话
4. 若 leaf 最后一个会话被关掉，则删除该 leaf
5. 若 split 某一侧被删空，则自动折叠为剩余子树

## 工作区树变换规则

### attach-session

语义：

1. 首个会话创建根 leaf。
2. 后续会话附着到目标 pane 或当前活动 pane。

### activate-session

语义：

1. 根据 `sessionId` 找到所在 leaf。
2. 将该 leaf 设为活动区域。
3. 将该会话设为该 leaf 的活动会话。

### focus-pane

语义：

1. 切换当前活动区域。
2. 保留该区域现有活动会话。
3. 若该区域没有显式活动会话，则回退到最后一个会话。

### split-pane

语义：

1. 找到目标 leaf。
2. 用 split 节点替换原 leaf。
3. 原 leaf 成为第一子节点。
4. 新建 leaf 成为第二子节点。
5. 新 leaf 成为活动区域。

### detach-session

语义：

1. 从对应 leaf 的 `sessionIds` 中移除目标会话。
2. 如果 leaf 空了，则删除该 leaf。
3. 如果 split 某一侧为空，则直接提升另一侧子树。
4. 重新选择仍存在的活动区域。

### reorder-pane-sessions

语义：

1. 只在当前 pane 内部调整 `sessionIds` 顺序。
2. 不跨区域移动会话。
3. 不影响其它 pane。

### resize-split

语义：

1. split 比例存储在父 split 节点上。
2. 当前实现通过句柄定位到该 split 下任意一个叶子 pane，再向上更新对应 split 的 `ratio`。
3. 比例被限制在 `0.2 ~ 0.8`。

## 终端运行时设计

## xterm 实例与 session 的关系

当前是一对一关系：

1. 每个 `sessionId` 对应一个 xterm bundle。
2. bundle 内包含：
   - `terminal`
   - `fitAddon`
   - `searchAddon`
   - `webglAddon`
   - `host/container`
   - `disposables`

### 容器挂载与重建

当 React 把某个 `sessionId` 的容器挂到 DOM 时：

1. `registerTerminalContainer(sessionId, element)` 被调用。
2. 若尚未存在 bundle，则执行 `ensureTerminal()` 创建 xterm。
3. 创建后进入 `finalizeTerminalMount()`，统一处理首次 `fit/focus/resize`。

当容器被卸载时：

1. 取消该容器的尺寸观察。
2. 销毁对应 xterm bundle。

### 为什么 split 后旧内容不会丢

当前终端输出会持续追加到 `sessionBuffersRef`，而不是只做“挂载前临时缓存”。

因此：

1. 即使某个 xterm 因为重挂载被销毁
2. 只要 session 仍然存在
3. 重新创建 xterm 时就会把完整缓存重新写回

这也是“保存会话”能够导出完整横幅和历史内容的基础。

### 尺寸同步

当前不是只观察活动会话，而是每个终端容器都独立挂到 `ResizeObserver`。

这样可以解决：

1. split 后非活动区域尺寸变化却未 `fit` 的问题
2. 只有再次点击区域后才恢复显示的问题

### 保存会话

保存流程：

1. UI 根据当前操作的 `sessionId` 调用 `getSessionBufferText(sessionId)`
2. 运行时优先从 xterm buffer 导出文本
3. 若 xterm 当前不存在，则回退到 `sessionBuffersRef`
4. 上层使用 Tauri 的保存对话框和文件写入能力完成落盘

当前导出的是纯文本，不保留 ANSI 样式。

## UI 结构

### TerminalPanel

`TerminalPanel` 当前只做编排：

1. 解析会话名称和状态
2. 为 `sessionId` 提供稳定的 terminal 容器 ref
3. 连接 pane 树、菜单和搜索栏

它已经不再直接维护复杂的搜索和菜单状态。

### TerminalPaneTree

`TerminalPaneTree` 负责：

1. 递归渲染 split / leaf
2. 渲染区域工作区栏
3. 渲染每个会话对应的 `terminal-container`
4. 处理区域内拖拽排序和 split resize

### useTerminalMenus

负责三类菜单状态：

1. 终端正文右键菜单
2. 区域工作区栏会话菜单
3. 链接菜单

### TerminalSearchBar

负责搜索栏局部状态：

1. 关键字
2. 大小写 / 正则 / 全词匹配
3. 高亮开关
4. 搜索结果统计显示

## 当前边界

### 已支持

1. Pane 拆分
2. 区域内多会话
3. 区域内会话拖拽排序
4. 区域级关闭语义
5. 区域 resize
6. split 后终端内容恢复
7. 保存完整会话文本

### 当前未做

1. 区域之间拖拽移动会话
2. 多工作区根节点
3. 会话跨区域拖放
4. 自动化单元测试
5. 输出缓存上限控制

## 维护建议

### 变更工作区语义时

优先修改：

1. `src/features/session/core/workspaceReducer.ts`
2. `src/features/session/hooks/useSessionWorkspace.ts`
3. `src/features/session/hooks/useSessionStateCore.ts`

不要先在 UI 上打补丁，否则很容易出现状态真相和界面行为不一致。

### 变更 split / 显示问题时

优先检查：

1. `TerminalPaneTree.tsx` 的区域结构是否改变了容器尺寸
2. `useTerminalRuntimeCore.ts` 的容器观察和 `finalizeTerminalMount()` 是否仍然覆盖该场景

### 变更会话导出/恢复时

优先检查：

1. `sessionBuffersRef` 是否仍然持续累计完整输出
2. xterm 重建时是否仍会完整回放缓存

## 相关文件

- `src/types.ts`
- `src/features/session/core/workspaceReducer.ts`
- `src/features/session/hooks/useSessionWorkspace.ts`
- `src/features/session/hooks/useSessionStateCore.ts`
- `src/features/terminal/hooks/useTerminalRuntimeCore.ts`
- `src/components/terminal/sessions/TerminalPanel.tsx`
- `src/components/terminal/sessions/TerminalPaneTree.tsx`
- `src/components/terminal/sessions/useTerminalMenus.tsx`
- `src/components/terminal/sessions/TerminalSearchBar.tsx`

# 历史命令与命令联想设计

## 1. 目标

当前设计解决两个核心问题：

1. 历史命令基于终端当前输入行的实际显示内容进行实时监听。
2. 命令联想通过可替换的 provider 输出候选，为后续 AI 联想预留统一入口。

本设计同时覆盖：

- 历史命令面板
- 终端输入行实时监听
- 全局历史命令持久化
- 命令联想候选生成与展示
- 浮动历史面板同步

## 2. 模块划分

### 2.1 `src/features/command-history/core`

- `storage.ts`
  负责 `terminal/command-history.json` 的读写和 schema 规范化。
- `query.ts`
  提供历史命令的统一排序和搜索过滤逻辑。
- `autocomplete.ts`
  提供联想 provider 接口和基于历史命令的默认实现。
- `inputTracker.ts`
  负责联想使用的本地输入缓冲辅助与历史命令项工具函数。
- `floatingSync.ts`
  约束主窗口和浮动历史命令面板之间的最小同步协议。

### 2.2 `src/features/command-history/hooks`

- `useCommandHistoryState.ts`
  聚合运行期会话历史、全局持久化历史和实时监听状态。

### 2.3 `src/features/terminal/hooks`

- `useTerminalRuntimeCore.ts`
  在终端运行时中完成输入行监听、命令提交收口、联想开关、联想导航和联想浮层锚点计算。

### 2.4 `src/components/terminal/history`

- `CommandHistoryPanel.tsx`
  展示历史命令列表和实时监听项。

## 3. 数据模型

### 3.1 历史命令项

```ts
type CommandHistoryItem = {
  id: string;
  command: string;
  firstUsedAt: number;
  lastUsedAt: number;
  useCount: number;
  source: "typed" | "quickbar" | "history";
};
```

说明：

- `typed` 表示通过终端回车提交收口得到的命令
- `quickbar` 预留给未来真正“执行完成”的快捷命令路径
- `history` 表示双击历史命令再次执行

### 3.2 历史命令分桶

```ts
type CommandHistoryBucket = {
  scopeKey: string;
  scopeType: "ssh" | "local" | "global";
  label: string;
  updatedAt: number;
  items: CommandHistoryItem[];
};
```

当前实际使用两类：

- 运行期会话桶：以内存形式存在，按当前 `sessionId` 维护
- 全局持久化桶：`scopeKey = "__global__"`，用于命令联想

### 3.3 实时监听状态

```ts
type CommandHistoryLiveCapture = {
  state: "listening" | "tracking";
  command: string;
  updatedAt: number;
};
```

## 4. 输入行监听状态机

### 4.1 状态定义

#### `listening`

- 当前 prompt 输入区为空
- 历史命令面板顶部显示“监听中”

#### `tracking`

- 当前 prompt 输入区存在可见内容
- 历史命令面板顶部实时显示输入区文本

### 4.2 生命周期

1. prompt 空行时进入 `listening`
2. 用户开始输入后切换到 `tracking`
3. 输入区再次清空后回到 `listening`
4. 用户按回车后，本轮输入被收口为正式历史命令
5. 终端等待下一次 prompt 出现，开始下一轮监听

### 4.3 关键实现

实时监听通过读取 xterm 当前光标所在 buffer 行完成：

- 先识别 prompt 前缀
- 再截取 prompt 后的输入区内容
- 对结果做 `trim()`，统一去掉首尾空格
- 使用防抖避免快速编辑导致 UI 抖动

当前防抖常量：

- `COMMAND_CAPTURE_DEBOUNCE_MS = 500`

## 5. 历史命令记录策略

### 5.1 记录来源

- `typed`
  终端回车提交后，由输入行监听收口得到
- `history`
  双击历史命令执行后记录
- `quickbar`
  当前不主动增加历史次数，避免“发送但未真实执行”的误计数

### 5.2 去重规则

同一条命令在同一分桶内只保留一份：

- 首次出现时插入
- 再次命中时仅更新 `lastUsedAt`
- `useCount += 1`

### 5.3 裁剪规则

- 单个历史桶最多保留 `300` 条命令
- 裁剪时按 `lastUsedAt` 倒序保留最新项

## 6. 联想设计

### 6.1 数据来源

联想当前仅使用全局持久化历史命令，不使用运行期单会话历史。

这样做的原因：

- 会话重连后联想仍然可用
- 联想与当前会话生命周期解耦
- 为未来全局排序和 AI provider 提供稳定数据源

### 6.2 Provider 抽象

终端层只依赖：

```ts
type CommandAutocompleteProvider = {
  getSuggestions: (input: string) => CommandAutocompleteCandidate[];
};
```

当前默认实现：

- `createHistoryAutocompleteProvider(items)`

未来可无缝替换为：

- AI provider
- 远端 provider
- 混合 provider

### 6.3 候选过滤与排序

当前规则：

- 最低使用次数：`useCount >= 5`
- 输入非空才触发联想
- 完全等于当前输入的命令不显示
- 默认最多返回 `100` 条候选

排序因素：

1. 前缀命中优先
2. 命中位置越靠前越优先
3. 使用次数越高越优先
4. 最近使用越新越优先

### 6.4 交互规则

- `↑ / ↓` 进入候选选择
- 联想面板默认不自动选中第一项
- `Enter`
  - 选中候选时：只写回输入行，不直接执行
  - 未选中候选时：保持终端原生回车行为
- `Esc`、左右方向键、应用内点击空白区域、窗口失焦时关闭联想

## 7. 联想浮层布局规则

联想浮层定位由终端运行时计算锚点：

- 优先显示在 prompt 行上方
- 上方空间不足时翻到 prompt 行下方
- 左侧起点尽量对齐当前光标列
- 保留 pane 边距，避免超出可视区域
- 最多显示 `5` 条可视项，超出后滚动

当前关键常量：

- `AUTOCOMPLETE_MAX_CANDIDATES = 100`
- `AUTOCOMPLETE_VISIBLE_ITEMS = 5`
- `AUTOCOMPLETE_MIN_PANEL_HEIGHT = 120`

## 8. 浮动历史面板同步

浮动历史面板通过 `BroadcastChannel` 与主窗口同步：

- 主窗口广播当前活动会话的最小历史快照
- 浮动窗口只做本地搜索过滤
- 浮动窗口执行历史命令时，通过消息回传主窗口执行

同步内容包括：

- `activeSessionId`
- `hasActiveSession`
- `liveCapture`
- `items`

## 9. 当前边界

当前实现仍有这些边界：

1. 提示符识别依赖当前输入行和 prompt 前缀的稳定性
2. 多行复杂命令的监听精度仍取决于 xterm buffer 的当前显示方式
3. 联想候选仍是规则排序，不包含语义理解
4. 历史命令全局持久化与运行期会话历史是分层存储，不是统一多作用域数据库

## 10. 后续演进方向

### 10.1 历史命令

- 增加清空当前会话历史
- 增加删除单条历史命令
- 增加全局历史视图

### 10.2 联想

- 支持 `Tab` 接受候选
- 支持当前会话优先、全局兜底的混合排序
- 接入 AI provider 替换默认排序逻辑

### 10.3 输入行监听

- 进一步抽象 prompt 识别策略
- 将复杂 shell 场景下的弱监听和强监听区分为不同模式

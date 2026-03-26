# 历史命令与命令联想设计

## 1. 目标

本设计定义两项核心能力：

1. 历史命令基于终端当前输入行的实际显示内容进行实时监听
2. 命令联想通过可替换的 Provider 输出候选，并保留统一扩展入口

覆盖范围包括：

- 历史命令面板
- 终端输入行实时监听
- 全局历史命令持久化
- 命令联想候选生成与展示
- 浮动历史面板同步

## 2. 模块划分

### 2.1 `src/features/command-history/core`

- `storage.ts`
  负责 `terminal/command-history.json` 的读写与 schema 规范化
- `query.ts`
  提供历史命令的统一排序与搜索过滤逻辑
- `autocomplete.ts`
  提供联想 Provider 接口与基于历史命令的默认实现
- `inputTracker.ts`
  负责联想所需的本地输入缓冲辅助与历史命令项工具函数
- `floatingSync.ts`
  定义主窗口与浮动历史面板之间的最小同步协议

### 2.2 `src/features/command-history/hooks`

- `useCommandHistoryState.ts`
  聚合运行期会话历史、全局持久化历史与实时监听状态

### 2.3 `src/features/terminal/hooks`

- `useTerminalRuntimeCore.ts`
  在终端运行时中完成输入行监听、命令提交收口、联想开关、联想导航与联想浮层锚点计算

### 2.4 `src/components/terminal/history`

- `CommandHistoryPanel.tsx`
  展示历史命令列表与实时监听项

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

- `typed`：通过终端回车提交收口得到的命令
- `quickbar`：通过快捷命令路径触发
- `history`：通过双击历史命令再次执行

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
- 全局持久化桶：`scopeKey = "__global__"`，供命令联想使用

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
4. 用户按回车后，本轮输入收口为正式历史命令
5. 终端等待下一次 prompt 出现并开始下一轮监听

### 4.3 关键实现

实时监听通过读取 xterm 当前光标所在 buffer 行完成：

- 先识别 prompt 前缀
- 再截取 prompt 后的输入区内容
- 对结果执行 `trim()` 以去除首尾空格
- 使用防抖策略减小高频编辑带来的 UI 抖动

当前防抖常量：

- `COMMAND_CAPTURE_DEBOUNCE_MS = 500`

## 5. 历史命令记录策略

### 5.1 记录来源

- `typed`
  终端回车提交后，由输入行监听收口得到
- `history`
  双击历史命令执行后记录
- `quickbar`
  不主动增加历史次数，避免将“发送但未真实执行”的动作计入历史频次

### 5.2 去重规则

同一条命令在同一分桶内仅保留一份：

- 首次出现时插入
- 再次命中时更新 `lastUsedAt`
- `useCount += 1`

### 5.3 裁剪规则

- 单个历史桶最多保留 `300` 条命令
- 裁剪时按 `lastUsedAt` 倒序保留最新项

## 6. 联想设计

### 6.1 数据来源

联想仅使用全局持久化历史命令，不直接依赖运行期单会话历史。

该设计用于保证：

- 会话重连后联想仍然可用
- 联想与当前会话生命周期解耦
- 全局排序与扩展型 Provider 拥有稳定数据源

### 6.2 Provider 抽象

终端层仅依赖以下接口：

```ts
type CommandAutocompleteProvider = {
  getSuggestions: (input: string) => CommandAutocompleteCandidate[];
};
```

当前默认实现：

- `createHistoryAutocompleteProvider(items)`

可替换实现包括：

- AI Provider
- 远端 Provider
- 混合 Provider

### 6.3 候选过滤与排序

当前规则：

- 最低使用次数：`useCount >= 5`
- 输入非空时才触发联想
- 仅在命令行编辑态触发
- 不使用全文 `includes`，以降低中段字符误命中
- 单词输入按“首词前缀”匹配
- 含空格输入按“整行连续前缀”匹配
- 与当前输入完全相等的命令不显示
- 默认最多返回 `100` 条候选

排序因素：

1. 命中质量分
2. 使用频次分：`log2(useCount + 1)`
3. 近期性分：按 30 天窗口线性衰减
4. 长度惩罚：候选越长，分值越低

当前权重常量统一定义在 `src/features/terminal/core/constants.ts`，包括：

- `AUTOCOMPLETE_MIN_USE_COUNT`
- `AUTOCOMPLETE_RECENCY_DECAY_WINDOW_DAYS`
- `AUTOCOMPLETE_FREQUENCY_WEIGHT`
- `AUTOCOMPLETE_RECENCY_MAX_SCORE`
- `AUTOCOMPLETE_MATCH_SCORE_COMMAND_PREFIX`
- `AUTOCOMPLETE_MATCH_SCORE_COMMAND_EXACT`
- `AUTOCOMPLETE_MATCH_SCORE_ARGS_PREFIX`
- `AUTOCOMPLETE_LENGTH_PENALTY_PER_CHAR`

### 6.4 交互规则

- `↑ / ↓`：进入候选选择
- 联想面板默认不自动选中第一项
- `Enter`
  - 选中候选时：写回输入行，不直接执行
  - 未选中候选时：保持终端原生回车语义
- `Esc`、左右方向键、应用空白区点击、窗口失焦时关闭联想

## 7. 联想浮层布局规则

联想浮层定位由终端运行时计算锚点：

- 优先显示在 prompt 行上方
- 上方空间不足时翻转到下方
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
- 浮动窗口执行本地搜索过滤
- 浮动窗口触发历史命令执行时，将动作回传主窗口

同步内容包括：

- `activeSessionId`
- `hasActiveSession`
- `liveCapture`
- `items`

## 9. 设计边界

当前实现具备以下边界：

1. 提示符识别依赖输入行与 prompt 前缀的稳定性
2. 多行复杂命令的监听精度取决于 xterm buffer 的当前显示方式
3. 联想候选采用规则排序，不包含语义理解
4. 历史命令全局持久化与运行期会话历史为分层存储，而非统一多作用域数据库

## 10. 扩展方向

### 10.1 历史命令

- 增加清空当前会话历史
- 增加删除单条历史命令
- 增加全局历史视图

### 10.2 联想

- 支持 `Tab` 接受候选
- 支持当前会话优先、全局兜底的混合排序
- 接入 AI Provider 以扩展默认排序逻辑

### 10.3 输入行监听

- 进一步抽象 prompt 识别策略
- 将复杂 shell 场景下的弱监听与强监听区分为不同模式

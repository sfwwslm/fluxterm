# FluxTerm 主题设计与 Token 规范

## 1. 文档目标

本文档定义 FluxTerm 主题系统的标准结构、命名规则、编译接口与扩展约束。

主题系统覆盖以下范围：

- 应用背景与窗口骨架
- 通用文本与状态色
- 按钮、输入、标签与菜单等通用组件
- 终端画布与 ANSI 色板
- 背景图模式下的表面透明度策略

本文档适用于内置主题设计、样式开发、组件接入以及未来用户自定义主题能力扩展。

## 2. 设计原则

### 2.1 单一主题源

所有主题颜色、字体、边框、阴影与终端色板均由结构化主题定义提供。  
业务样式仅消费标准 token，不直接定义新的核心视觉语义。

### 2.2 分层建模

主题结构采用三层模型：

- `foundation`：基础视觉原语，包括字体、正文层级、强调色与效果
- `semantic`：语义层，包括背景、表面、边框、反馈状态
- `component`：组件派生层，仅描述少量通用组件的直接消费值

终端主题作为独立子系统，使用专门的 `terminal` 结构表达。

### 2.3 深浅主题一致性

深色与浅色主题必须共享相同的 token 结构与命名集合。  
同一语义在不同主题中的值可以不同，但字段含义必须稳定。

### 2.4 可扩展性

主题定义应支持未来用户自定义主题配置。  
新增主题能力时，优先扩展结构化 schema，不通过业务样式临时追加变量。

### 2.5 可读性优先

正文、命令文本、输入值、菜单项、状态标签与终端输出必须具备稳定可见性。  
装饰性透明、模糊与发光效果不得削弱信息可读性。

## 3. 主题定义结构

### 3.1 Foundation

`foundation.typography`

- `fontFamilyBody`：正文与常规界面字体族
- `fontFamilyMono`：命令、路径、终端与代码字体族
- `textPrimary`：主要正文颜色
- `textSecondary`：次级说明颜色
- `textTertiary`：辅助说明颜色
- `textMuted`：低优先级辅助文本颜色
- `textSoft`：强调但非主标题文本颜色
- `textQuiet`：弱提示文本颜色

`foundation.accent`

- `default`：主强调色
- `strong`：高强调色
- `contrast`：强调色上的对比文本色
- `soft`：强调色软层
- `subtle`：强调色轻层

`foundation.effects`

- `shadowStrong`：高层级浮层阴影
- `brandGlow`：品牌性光晕或强调发光

### 3.2 Semantic

`semantic.background`

- `appBase`：应用基础底色
- `appGradient`：应用主背景渐变
- `appImage`：背景媒体层
- `appOverlay`：背景叠加层

`semantic.surface`

- `canvas`：最低层画布面
- `base`：主面板基底
- `strong`：高密度容器表面
- `alt`：替代表面
- `panel`：内容面板表面
- `elevated`：浮起表面
- `header`：标题栏与区块头部表面
- `headerStrong`：更强标题表面
- `menu`：菜单与浮层表面

`semantic.border`

- `weak`：弱边框
- `soft`：柔和边框
- `strong`：强调边框
- `input`：输入类边框
- `focus`：焦点边框

`semantic.feedback`

- `success` / `successSoft`
- `warning` / `warningSoft`
- `info` / `infoSoft`
- `danger` / `dangerSoft`

### 3.3 Component

`component.button`

- `bg`
- `bgStrong`
- `text`

`component.input`

- `bg`
- `text`

`component.tabs`

- `bg`
- `border`

`component.layout`

- `resizerBg`

`component.progress`

- `gradient`

### 3.4 Terminal

`terminal`

- `background`
- `foreground`
- `selectionBackground`
- `selectionForeground`
- `cursor`
- `cursorAccent`
- `searchMatchBackground`
- `searchMatchBorder`
- `searchMatchOverviewRuler`
- `searchActiveMatchBackground`
- `searchActiveMatchBorder`
- `searchActiveMatchOverviewRuler`

`terminal.ansi`

- `black`
- `red`
- `green`
- `yellow`
- `blue`
- `magenta`
- `cyan`
- `white`
- `brightBlack`
- `brightRed`
- `brightGreen`
- `brightYellow`
- `brightBlue`
- `brightMagenta`
- `brightCyan`
- `brightWhite`

## 4. Token 命名规范

### 4.1 CSS 变量命名

CSS 变量使用统一前缀与语义域：

- `--text-*`
- `--accent-*`
- `--surface-*`
- `--border-*`
- `--success-*` / `--warning-*` / `--info-*` / `--danger-*`
- `--button-*`
- `--input-*`
- `--tab-*`
- `--terminal-*`
- `--chrome-*`

### 4.2 Chrome 变量

`--chrome-*` 用于表达应用骨架层的直接消费变量，例如：

- 标题栏
- 主面板
- 终端外层容器
- 模态框
- 浮层菜单
- 底栏

`--chrome-*` 必须由标准主题 token 派生，不单独承载新的颜色语义。

### 4.3 禁止项

以下做法不属于标准主题体系：

- 在业务组件中发明新的核心颜色语义
- 用未注册的 CSS 变量承载文本、表面、边框或状态色
- 将同一 token 同时用于多个不同优先级的文本角色
- 用透明度或阴影模拟文本层级

## 5. 编译与消费接口

### 5.1 主题定义

主题对象使用 `ThemeDefinition` 结构表达。  
内置主题预设使用 `ThemePreset` 结构表达。

### 5.2 CSS 变量编译

`buildThemeCssVars(theme)` 负责：

- 把结构化主题映射为标准 CSS 变量
- 输出普通 UI 与终端搜索相关变量
- 为运行时主题切换提供统一注入字典

### 5.3 终端主题编译

`buildTerminalTheme(theme, options)` 负责：

- 把终端结构化 token 编译为 xterm 可直接消费的终端主题对象
- 处理背景图模式下的透明背景输出
- 保持 ANSI 色板字段稳定

### 5.4 运行时注入

主题切换时，运行时将编译结果注入 `document.documentElement`，并通过 `data-theme`、`data-background-image-mode` 等根节点状态驱动样式分支。

## 6. 背景图模式规范

### 6.1 背景层

背景按以下顺序叠加：

1. `appOverlay`
2. `appImage`
3. `appGradient`

### 6.2 表面透明度

背景图模式使用统一透明度变量控制应用骨架层表面。  
骨架层应共享同一透明度语义，避免不同区域透明度逻辑割裂。

### 6.3 深浅主题策略

深色主题与浅色主题可使用不同的透明度派生策略。  
浅色主题允许使用更高的可读性保底值，以保证正文、终端与组件信息密度。

### 6.4 终端透明规则

终端背景由外层 pane 表面与 xterm 画布协同构成。  
终端画布透明策略不得与外层 pane 产生重复叠色，确保命令文本与 ANSI 色板稳定可见。

## 7. 组件接入规范

### 7.1 文本

组件中的标题、正文、说明、提示与弱文本必须使用标准 `--text-*` 层级。  
不得用 `opacity` 代替文本层级设计。

### 7.2 表面

组件表面优先使用：

- `--surface`
- `--surface-panel`
- `--surface-elevated`
- `--surface-header`
- `--surface-menu`

### 7.3 边框与焦点

边框与焦点反馈优先使用：

- `--border-soft`
- `--border-input`
- `--border-strong`
- `--border-focus`

### 7.4 状态反馈

业务状态必须通过标准反馈色表达：

- 成功：`--success` / `--success-soft`
- 警告：`--warning` / `--warning-soft`
- 信息：`--info` / `--info-soft`
- 危险：`--danger` / `--danger-soft`

### 7.5 字体

常规 UI 使用 `--font-family-body`。  
终端、命令、路径、代码、日志与数值密集信息使用 `--font-family-mono`。

## 8. 用户自定义主题扩展规范

### 8.1 扩展入口

用户主题能力应基于 `ThemeDefinition` 数据结构扩展，不通过直接写入任意 CSS 变量实现。

### 8.2 校验要求

用户主题定义应满足：

- 字段完整
- 命名合法
- 颜色格式合法
- 深浅主题语义一致

### 8.3 兼容要求

新增主题字段时，应保证：

- 结构可被编译函数消费
- 未新增字段的业务组件不需要单独修改
- 字段语义对内置主题与用户主题保持一致

### 8.4 不开放能力

以下能力不应作为主题定义的直接输入：

- 任意业务组件私有颜色注入
- 未注册变量名注入
- 绕过编译器直接控制终端色板

## 9. 可访问性与可读性基线

主题系统必须保证以下基线：

- 主要正文可稳定辨识
- 次级文本与辅助信息具备明确层级
- 深色与浅色主题均能区分交互状态
- 终端 ANSI 输出在深浅主题下均具有稳定可见性
- 背景图模式下正文、控件与终端输出不因透明度丢失可读性

## 10. 维护要求

新增或调整主题能力时，应同步维护以下内容：

- 主题结构类型
- token 键注册表
- 主题预设
- CSS 变量编译器
- 终端主题编译器
- 本规范文档

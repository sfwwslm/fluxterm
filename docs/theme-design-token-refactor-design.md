# 主题与透明度规范（当前实现）

## 目标

本规范用于统一 FluxTerm 的主题颜色与透明度实现，保证新增 UI 与现有实现保持一致，并持续支持主题切换与背景图模式。

## 当前实现基线

主题系统按以下链路工作：

1. `useAppSettings` 持久化 `themeId` 与背景图相关设置。
2. `AppShell` 读取 `themePresets`，调用构建函数生成变量。
3. `buildThemeCssVars.ts` 将结构化主题映射到 CSS Variables。
4. `buildTerminalTheme.ts` 将终端 token 映射到 xterm 主题。
5. `App.css` 与组件样式通过 CSS 变量消费主题与透明度。

背景图模式通过 `:root[data-background-image-mode="on"]` 启用，并由 `--chrome-surface-alpha` 统一控制主要区域透明度。

## 主题模块职责

- `src/app/theme/themeContracts.ts`：主题结构类型定义。
- `src/app/theme/tokens.ts`：主题 token 键位与映射约束。
- `src/app/theme/themePresets.ts`：主题预设数据。
- `src/app/theme/buildThemeCssVars.ts`：普通 UI CSS 变量生成。
- `src/app/theme/buildTerminalTheme.ts`：xterm 主题生成。

## 变量分层规范

### 1. 背景层（App Background）

- `--app-bg-overlay`
- `--app-bg-image`
- `--app-bg-gradient`

页面背景按以上三层叠加渲染。

### 2. 应用骨架层（Chrome）

应用主要容器统一消费 `--chrome-*` 变量，包括标题栏、面板、终端容器、底栏、模态框、浮层菜单等。

典型变量：

- `--chrome-titlebar-bg`
- `--chrome-panel-bg`
- `--chrome-terminal-bg`
- `--chrome-bottom-bg`
- `--chrome-modal-bg`
- `--chrome-flyout-menu-bg`

### 3. 输入层（Input）

输入类组件统一消费输入变量链路：

- `--ui-input-bg`
- `--ui-input-bg-hover`
- `--ui-input-border`
- `--ui-input-border-hover`
- `--chrome-input-bg`
- `--chrome-input-bg-hover`

文本输入、搜索输入、输入壳层、select 输入面均使用同一套输入透明度来源。

### 4. 菜单与浮层（Flyout）

菜单与浮层统一基于以下变量：

- `--chrome-flyout-menu-bg`
- `--chrome-widget-settings-menu-bg`
- `--chrome-select-list-bg`

组件通过变量派生 hover/active 视觉。

### 5. 模态层（Modal）

模态框与遮罩统一基于：

- `--chrome-modal-bg`
- `--chrome-modal-header-bg`
- `--chrome-modal-actions-bg`
- `--chrome-modal-overlay-bg`

## 透明度统一规范

1. 背景图模式下，主要区域透明度由 `--chrome-surface-alpha` 统一驱动。
2. 各层组件通过本层变量派生透明度，不在组件内创建独立主题透明度体系。
3. 同类组件在常态、hover、focus、active 状态下使用同一层变量链路。
4. 终端可视区域透明度与容器变量保持一致，xterm 背景与 pane 背景协同。

## 组件实现规范

1. 组件负责布局、尺寸、结构与交互语义。
2. 视觉色值、透明度、阴影、边框强度通过主题变量提供。
3. 新增组件优先复用已有 `--chrome-*` 与 `--ui-*` 变量。
4. 当存在跨组件复用需求时，在 `themeContracts/tokens/themePresets` 中新增 token，再由构建函数映射到 CSS 变量。
5. 组件状态（hover/focus/active/disabled）基于同一 token 体系派生，保持应用行为一致。

## 自定义背景图规范

1. 背景图资源由应用托管并持久化到用户目录配置路径。
2. 配置保存资源引用，不依赖原始选择路径。
3. 背景图启用状态由设置项控制。
4. 背景图开启后，前景内容通过 overlay 与透明层保证可读性。

## 开发与评审清单

1. 新增 UI 是否复用现有主题变量分层。
2. 颜色与透明度是否来自统一 token 链路。
3. 背景图模式下是否保持可读与对比。
4. 交互状态是否与同类组件一致。
5. 新增 token 时是否同步更新 `themeContracts.ts`、`tokens.ts`、`themePresets.ts` 与构建函数。

## 验收标准

1. 主题切换后普通 UI 与终端主题同步生效。
2. 背景图模式下主要区域透明度一致且可调。
3. 输入、菜单、模态、面板使用统一变量链路。
4. 新增主题时通过主题预设与构建函数完成接入，无需在业务组件中补硬编码视觉值。
5. 背景图配置在重启后可恢复，视觉表现稳定一致。

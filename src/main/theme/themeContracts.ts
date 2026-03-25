/**
 * 主题契约定义。
 * 职责：约束主题预设的结构化 token 形态，避免主题字段在业务侧随意扩散。
 */
import type { Locale } from "@/i18n";

/** 基础视觉原语集合。 */
export type FoundationTokens = {
  /** 排版与文本层级 token。 */
  typography: {
    /** 正文默认字体族。 */
    fontFamilyBody: string;
    /** 等宽场景字体族。 */
    fontFamilyMono: string;
    /** 主要正文颜色。 */
    textPrimary: string;
    /** 次级说明颜色。 */
    textSecondary: string;
    /** 辅助说明颜色。 */
    textTertiary: string;
    /** 低优先级辅助文本颜色。 */
    textMuted: string;
    /** 强调但非主标题文本颜色。 */
    textSoft: string;
    /** 弱提示文本颜色。 */
    textQuiet: string;
  };
  /** 强调色与其层级变体。 */
  accent: {
    /** 主强调色。 */
    default: string;
    /** 高强调色。 */
    strong: string;
    /** 强调色上的对比文本色。 */
    contrast: string;
    /** 强调色软层。 */
    soft: string;
    /** 强调色轻层。 */
    subtle: string;
  };
  /** 全局视觉效果 token。 */
  effects: {
    /** 高层级阴影。 */
    shadowStrong: string;
    /** 品牌性光晕。 */
    brandGlow: string;
  };
};

/** 语义层 token。 */
export type SemanticTokens = {
  /** 应用背景层。 */
  background: {
    /** 应用基础底色。 */
    appBase: string;
    /** 应用主背景渐变。 */
    appGradient: string;
    /** 背景媒体层。 */
    appImage: string;
    /** 背景叠加层。 */
    appOverlay: string;
  };
  /** 通用表面层。 */
  surface: {
    /** 最低层画布面。 */
    canvas: string;
    /** 主面板基底。 */
    base: string;
    /** 高密度容器表面。 */
    strong: string;
    /** 替代表面。 */
    alt: string;
    /** 内容面板表面。 */
    panel: string;
    /** 浮起表面。 */
    elevated: string;
    /** 头部表面。 */
    header: string;
    /** 强头部表面。 */
    headerStrong: string;
    /** 菜单与浮层表面。 */
    menu: string;
  };
  /** 通用边框层。 */
  border: {
    /** 弱边框。 */
    weak: string;
    /** 柔和边框。 */
    soft: string;
    /** 强调边框。 */
    strong: string;
    /** 输入类边框。 */
    input: string;
    /** 焦点边框。 */
    focus: string;
  };
  /** 反馈状态色。 */
  feedback: {
    /** 成功主色。 */
    success: string;
    /** 成功软层。 */
    successSoft: string;
    /** 警告主色。 */
    warning: string;
    /** 警告软层。 */
    warningSoft: string;
    /** 信息主色。 */
    info: string;
    /** 信息软层。 */
    infoSoft: string;
    /** 危险主色。 */
    danger: string;
    /** 危险软层。 */
    dangerSoft: string;
  };
};

/** 通用组件派生 token。 */
export type ComponentTokens = {
  /** 按钮组件视觉 token。 */
  button: {
    /** 按钮默认背景。 */
    bg: string;
    /** 按钮强化背景。 */
    bgStrong: string;
    /** 按钮文本颜色。 */
    text: string;
  };
  /** 输入组件视觉 token。 */
  input: {
    /** 输入背景。 */
    bg: string;
    /** 输入文本颜色。 */
    text: string;
  };
  /** 标签页组件视觉 token。 */
  tabs: {
    /** 标签页背景。 */
    bg: string;
    /** 标签页边框。 */
    border: string;
  };
  /** 布局组件视觉 token。 */
  layout: {
    /** 拖拽分隔条背景。 */
    resizerBg: string;
  };
  /** 进度类视觉 token。 */
  progress: {
    /** 进度渐变。 */
    gradient: string;
  };
};

/** 终端 ANSI 色板。 */
export type TerminalAnsiTokens = {
  /** ANSI 黑色。 */
  black: string;
  /** ANSI 红色。 */
  red: string;
  /** ANSI 绿色。 */
  green: string;
  /** ANSI 黄色。 */
  yellow: string;
  /** ANSI 蓝色。 */
  blue: string;
  /** ANSI 品红。 */
  magenta: string;
  /** ANSI 青色。 */
  cyan: string;
  /** ANSI 白色。 */
  white: string;
  /** ANSI 亮黑。 */
  brightBlack: string;
  /** ANSI 亮红。 */
  brightRed: string;
  /** ANSI 亮绿。 */
  brightGreen: string;
  /** ANSI 亮黄。 */
  brightYellow: string;
  /** ANSI 亮蓝。 */
  brightBlue: string;
  /** ANSI 亮品红。 */
  brightMagenta: string;
  /** ANSI 亮青。 */
  brightCyan: string;
  /** ANSI 亮白。 */
  brightWhite: string;
};

/** 终端主题 token。 */
export type TerminalThemeTokens = {
  /** 终端背景色。 */
  background: string;
  /** 终端前景色。 */
  foreground: string;
  /** 选区背景色。 */
  selectionBackground: string;
  /** 选区前景色。 */
  selectionForeground: string;
  /** 光标主色。 */
  cursor: string;
  /** 光标对比色。 */
  cursorAccent: string;
  /** 搜索匹配背景色。 */
  searchMatchBackground: string;
  /** 搜索匹配边框色。 */
  searchMatchBorder: string;
  /** 搜索匹配概览标尺颜色。 */
  searchMatchOverviewRuler: string;
  /** 当前搜索匹配背景色。 */
  searchActiveMatchBackground: string;
  /** 当前搜索匹配边框色。 */
  searchActiveMatchBorder: string;
  /** 当前搜索匹配概览标尺颜色。 */
  searchActiveMatchOverviewRuler: string;
  /** ANSI 16 色集合。 */
  ansi: TerminalAnsiTokens;
};

/** 可持久化的主题定义结构。 */
export type ThemeDefinition = {
  /** 多语言主题名称。 */
  label: Record<Locale, string>;
  /** 基础视觉原语。 */
  foundation: FoundationTokens;
  /** 语义层 token。 */
  semantic: SemanticTokens;
  /** 组件派生层 token。 */
  component: ComponentTokens;
  /** 终端主题定义。 */
  terminal: TerminalThemeTokens;
};

/** 内置主题预设类型。 */
export type ThemePreset = ThemeDefinition;

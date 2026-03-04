/**
 * 主题契约定义。
 * 职责：约束主题预设的结构化 token 形态，避免主题字段在业务侧随意扩散。
 */
import type { Locale } from "@/i18n";

/** 基础层 token。 */
export type FoundationTokens = {
  typography: {
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textSoft: string;
    textQuiet: string;
  };
  accent: {
    default: string;
    strong: string;
    contrast: string;
    soft: string;
    subtle: string;
  };
  effects: {
    shadowStrong: string;
    brandGlow: string;
  };
};

/** 语义层 token。 */
export type SemanticTokens = {
  background: {
    appBase: string;
    appGradient: string;
    appImage: string;
    appOverlay: string;
  };
  surface: {
    base: string;
    strong: string;
    alt: string;
    header: string;
    headerStrong: string;
    menu: string;
  };
  border: {
    weak: string;
    soft: string;
    input: string;
  };
  feedback: {
    success: string;
    successSoft: string;
    danger: string;
  };
};

/** 通用组件层 token。 */
export type ComponentTokens = {
  button: {
    bg: string;
    bgStrong: string;
    text: string;
  };
  input: {
    bg: string;
    text: string;
  };
  tabs: {
    bg: string;
    border: string;
  };
  layout: {
    resizerBg: string;
  };
  progress: {
    gradient: string;
  };
};

/** 终端主题 token。 */
export type TerminalThemeTokens = {
  background: string;
  foreground: string;
  selectionBackground: string;
  cursor: string;
};

/** 主题预设。 */
export type ThemePreset = {
  label: Record<Locale, string>;
  foundation: FoundationTokens;
  semantic: SemanticTokens;
  component: ComponentTokens;
  terminal: TerminalThemeTokens;
};

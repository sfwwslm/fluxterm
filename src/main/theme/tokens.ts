/**
 * 主题 token 键定义。
 * 职责：集中维护结构化 token 到 CSS 变量的标准键名，降低拼写分散风险。
 */
export const themeCssVarKeys = {
  background: {
    appBase: "--app-bg-base",
    appGradient: "--app-bg-gradient",
    appImage: "--app-bg-image",
    appOverlay: "--app-bg-overlay",
  },
  typography: {
    textPrimary: "--text-primary",
    textSecondary: "--text-secondary",
    textMuted: "--text-muted",
    textSoft: "--text-soft",
    textQuiet: "--text-quiet",
  },
  accent: {
    default: "--accent",
    strong: "--accent-strong",
    contrast: "--accent-contrast",
    soft: "--accent-soft",
    subtle: "--accent-subtle",
  },
  surface: {
    base: "--surface",
    strong: "--surface-strong",
    alt: "--surface-alt",
    header: "--surface-header",
    headerStrong: "--surface-header-strong",
    menu: "--surface-menu",
  },
  border: {
    weak: "--border-weak",
    soft: "--border-soft",
    input: "--border-input",
  },
  button: {
    bg: "--button-bg",
    bgStrong: "--button-bg-strong",
    text: "--button-text",
  },
  input: {
    bg: "--input-bg",
    text: "--input-text",
  },
  tabs: {
    bg: "--tab-bg",
    border: "--tab-border",
  },
  feedback: {
    success: "--success",
    successSoft: "--success-soft",
    danger: "--danger",
  },
  layout: {
    resizerBg: "--resizer-bg",
  },
  progress: {
    gradient: "--progress-gradient",
  },
  effects: {
    shadowStrong: "--shadow-strong",
    brandGlow: "--brand-glow",
  },
} as const;

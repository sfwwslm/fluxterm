/**
 * 主题 token 键定义。
 * 职责：集中维护结构化 token 到 CSS 变量的标准键名，降低拼写分散风险。
 */
export const themeCssVarKeys = {
  font: {
    body: "--font-family-body",
    mono: "--font-family-mono",
  },
  background: {
    appBase: "--app-bg-base",
    appGradient: "--app-bg-gradient",
    appImage: "--app-bg-image",
    appOverlay: "--app-bg-overlay",
  },
  typography: {
    textPrimary: "--text-primary",
    textSecondary: "--text-secondary",
    textTertiary: "--text-tertiary",
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
    canvas: "--surface-canvas",
    base: "--surface",
    strong: "--surface-strong",
    alt: "--surface-alt",
    panel: "--surface-panel",
    elevated: "--surface-elevated",
    header: "--surface-header",
    headerStrong: "--surface-header-strong",
    menu: "--surface-menu",
  },
  border: {
    weak: "--border-weak",
    soft: "--border-soft",
    strong: "--border-strong",
    input: "--border-input",
    focus: "--border-focus",
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
    warning: "--warning",
    warningSoft: "--warning-soft",
    info: "--info",
    infoSoft: "--info-soft",
    danger: "--danger",
    dangerSoft: "--danger-soft",
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
  terminal: {
    background: "--terminal-background",
    foreground: "--terminal-foreground",
    selectionBackground: "--terminal-selection-background",
    selectionForeground: "--terminal-selection-foreground",
    cursor: "--terminal-cursor",
    cursorAccent: "--terminal-cursor-accent",
    searchMatchBackground: "--terminal-search-match-bg",
    searchMatchBorder: "--terminal-search-match-border",
    searchMatchOverviewRuler: "--terminal-search-match-ruler",
    searchActiveMatchBackground: "--terminal-search-active-match-bg",
    searchActiveMatchBorder: "--terminal-search-active-match-border",
    searchActiveMatchOverviewRuler: "--terminal-search-active-match-ruler",
  },
} as const;

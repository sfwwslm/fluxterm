/**
 * 主题预设定义。
 * 职责：集中维护结构化主题 token，作为编译 CSS 变量与终端主题的唯一来源。
 */
import type { ThemeId } from "@/types";
import type { ThemePreset } from "@/main/theme/themeContracts";

/**
 * 内置主题预设集合。
 * 每个预设都必须完整实现标准主题结构，以便被 CSS 与终端编译器直接消费。
 */
export const themePresets: Record<ThemeId, ThemePreset> = {
  dark: {
    label: { "zh-CN": "深色", "en-US": "Dark" },
    foundation: {
      typography: {
        fontFamilyBody: '"IBM Plex Sans", "Segoe UI", sans-serif',
        fontFamilyMono: '"JetBrains Mono", "Cascadia Mono", monospace',
        textPrimary: "#f8fafc",
        textSecondary: "#cbd5e1",
        textTertiary: "#94a3b8",
        textMuted: "#aab8cb",
        textSoft: "#d7e0ec",
        textQuiet: "#7b8aa0",
      },
      accent: {
        default: "#3794ff",
        strong: "#5aa8ff",
        contrast: "#1e1e1e",
        soft: "rgba(55, 148, 255, 0.26)",
        subtle: "rgba(55, 148, 255, 0.14)",
      },
      effects: {
        shadowStrong: "0 18px 38px rgba(0, 0, 0, 0.38)",
        brandGlow: "0 0 16px rgba(55, 148, 255, 0.16)",
      },
    },
    semantic: {
      background: {
        appBase: "#1e1e1e",
        appGradient:
          "linear-gradient(160deg, #1b1b1b 0%, #202020 48%, #1f1f1f 100%)",
        appImage: "none",
        appOverlay: "none",
      },
      surface: {
        canvas: "#161616",
        base: "#252526",
        strong: "#1f1f1f",
        alt: "#2a2d2e",
        panel: "#252526",
        elevated: "#313335",
        header: "#252526",
        headerStrong: "#1f1f1f",
        menu: "#252526",
      },
      border: {
        weak: "rgba(255, 255, 255, 0.09)",
        soft: "rgba(255, 255, 255, 0.06)",
        strong: "rgba(255, 255, 255, 0.16)",
        input: "rgba(255, 255, 255, 0.14)",
        focus: "#3794ff",
      },
      feedback: {
        success: "#4ade80",
        successSoft: "rgba(74, 222, 128, 0.18)",
        warning: "#fbbf24",
        warningSoft: "rgba(251, 191, 36, 0.18)",
        info: "#60a5fa",
        infoSoft: "rgba(96, 165, 250, 0.18)",
        danger: "#f87171",
        dangerSoft: "rgba(248, 113, 113, 0.18)",
      },
    },
    component: {
      button: {
        bg: "#2a2d2e",
        bgStrong: "#333639",
        text: "#f8fafc",
      },
      input: {
        bg: "#1f1f1f",
        text: "#f8fafc",
      },
      tabs: {
        bg: "#2a2d2e",
        border: "rgba(255, 255, 255, 0.12)",
      },
      layout: {
        resizerBg: "rgba(255, 255, 255, 0.06)",
      },
      progress: {
        gradient: "linear-gradient(120deg, #3794ff, #4ade80)",
      },
    },
    terminal: {
      background: "#1e1e1e",
      foreground: "#edf2f7",
      selectionBackground: "rgba(38, 79, 120, 0.48)",
      selectionForeground: "#f8fbff",
      cursor: "#f8fafc",
      cursorAccent: "#1e1e1e",
      searchMatchBackground: "rgba(251, 191, 36, 0.22)",
      searchMatchBorder: "#fbbf24",
      searchMatchOverviewRuler: "#fbbf24",
      searchActiveMatchBackground: "rgba(55, 148, 255, 0.22)",
      searchActiveMatchBorder: "#3794ff",
      searchActiveMatchOverviewRuler: "#3794ff",
      ansi: {
        black: "#2d2d2d",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#3794ff",
        magenta: "#c084fc",
        cyan: "#45c1cf",
        white: "#cbd5e1",
        brightBlack: "#808080",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fcd34d",
        brightBlue: "#5aa8ff",
        brightMagenta: "#d8b4fe",
        brightCyan: "#8dd9e2",
        brightWhite: "#f8fafc",
      },
    },
  },
  light: {
    label: { "zh-CN": "浅色", "en-US": "Light" },
    foundation: {
      typography: {
        fontFamilyBody: '"IBM Plex Sans", "Segoe UI", sans-serif',
        fontFamilyMono: '"JetBrains Mono", "Cascadia Mono", monospace',
        textPrimary: "#0f172a",
        textSecondary: "#334155",
        textTertiary: "#64748b",
        textMuted: "#526277",
        textSoft: "#1f2937",
        textQuiet: "#7b8798",
      },
      accent: {
        default: "#2563eb",
        strong: "#1d4ed8",
        contrast: "#f8fafc",
        soft: "rgba(37, 99, 235, 0.24)",
        subtle: "rgba(37, 99, 235, 0.12)",
      },
      effects: {
        shadowStrong: "0 18px 38px rgba(15, 23, 42, 0.12)",
        brandGlow: "0 0 18px rgba(37, 99, 235, 0.16)",
      },
    },
    semantic: {
      background: {
        appBase: "#f3f7fb",
        appGradient:
          "linear-gradient(160deg, #f7fafc 0%, #edf3f9 52%, #e8eef6 100%)",
        appImage: "none",
        appOverlay: "none",
      },
      surface: {
        canvas: "#edf2f7",
        base: "#ffffff",
        strong: "#f8fbff",
        alt: "#eef3f9",
        panel: "#f6f9fd",
        elevated: "#ffffff",
        header: "#f1f5f9",
        headerStrong: "#e8eef6",
        menu: "#ffffff",
      },
      border: {
        weak: "rgba(51, 65, 85, 0.14)",
        soft: "rgba(51, 65, 85, 0.1)",
        strong: "rgba(51, 65, 85, 0.22)",
        input: "rgba(51, 65, 85, 0.2)",
        focus: "#2563eb",
      },
      feedback: {
        success: "#15803d",
        successSoft: "rgba(21, 128, 61, 0.14)",
        warning: "#b45309",
        warningSoft: "rgba(180, 83, 9, 0.14)",
        info: "#1d4ed8",
        infoSoft: "rgba(29, 78, 216, 0.14)",
        danger: "#dc2626",
        dangerSoft: "rgba(220, 38, 38, 0.14)",
      },
    },
    component: {
      button: {
        bg: "#e9f0f8",
        bgStrong: "#dce8f6",
        text: "#0f172a",
      },
      input: {
        bg: "#ffffff",
        text: "#0f172a",
      },
      tabs: {
        bg: "#eef4fb",
        border: "rgba(51, 65, 85, 0.18)",
      },
      layout: {
        resizerBg: "rgba(51, 65, 85, 0.1)",
      },
      progress: {
        gradient: "linear-gradient(120deg, #2563eb, #15803d)",
      },
    },
    terminal: {
      background: "#f5f7fb",
      foreground: "#0f172a",
      selectionBackground: "rgba(37, 99, 235, 0.18)",
      selectionForeground: "#0b1324",
      cursor: "#0f172a",
      cursorAccent: "#f5f7fb",
      searchMatchBackground: "rgba(180, 83, 9, 0.16)",
      searchMatchBorder: "#b45309",
      searchMatchOverviewRuler: "#b45309",
      searchActiveMatchBackground: "rgba(37, 99, 235, 0.16)",
      searchActiveMatchBorder: "#2563eb",
      searchActiveMatchOverviewRuler: "#2563eb",
      ansi: {
        black: "#334155",
        red: "#dc2626",
        green: "#15803d",
        yellow: "#a16207",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0f766e",
        white: "#64748b",
        brightBlack: "#475569",
        brightRed: "#ef4444",
        brightGreen: "#16a34a",
        brightYellow: "#ca8a04",
        brightBlue: "#1d4ed8",
        brightMagenta: "#a855f7",
        brightCyan: "#0891b2",
        brightWhite: "#0f172a",
      },
    },
  },
};

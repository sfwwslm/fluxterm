/**
 * 主题预设定义。
 * 职责：集中维护结构化主题 token，作为编译 CSS 变量与终端主题的唯一来源。
 */
import type { ThemeId } from "@/types";
import type { ThemePreset } from "@/app/theme/themeContracts";

/** 主题预设列表。 */
export const themePresets: Record<ThemeId, ThemePreset> = {
  dark: {
    label: { zh: "深色", en: "Dark" },
    foundation: {
      typography: {
        textPrimary: "#ffffff",
        textSecondary: "#e6e6e6",
        textMuted: "#bdbdbd",
        textSoft: "#cccccc",
        textQuiet: "#999999",
      },
      accent: {
        default: "#ffffff",
        strong: "#ffffff",
        contrast: "#000000",
        soft: "rgba(255, 255, 255, 0.6)",
        subtle: "rgba(255, 255, 255, 0.18)",
      },
      effects: {
        shadowStrong: "0 16px 32px rgba(0, 0, 0, 0.5)",
        brandGlow: "0 0 12px rgba(255, 255, 255, 0.55)",
      },
    },
    semantic: {
      background: {
        appBase: "#000000",
        appGradient: "linear-gradient(140deg, #000000 0%, #000000 100%)",
        appImage: "none",
        appOverlay: "none",
      },
      surface: {
        base: "rgba(0, 0, 0, 0.86)",
        strong: "rgba(0, 0, 0, 0.92)",
        alt: "rgba(0, 0, 0, 0.8)",
        header: "rgba(0, 0, 0, 0.8)",
        headerStrong: "rgba(0, 0, 0, 0.88)",
        menu: "rgba(0, 0, 0, 0.98)",
      },
      border: {
        weak: "rgba(255, 255, 255, 0.16)",
        soft: "rgba(255, 255, 255, 0.1)",
        input: "rgba(255, 255, 255, 0.2)",
      },
      feedback: {
        success: "#ffffff",
        successSoft: "rgba(255, 255, 255, 0.3)",
        danger: "#d9d9d9",
      },
    },
    component: {
      button: {
        bg: "rgba(255, 255, 255, 0.08)",
        bgStrong: "rgba(255, 255, 255, 0.12)",
        text: "#ffffff",
      },
      input: {
        bg: "rgba(0, 0, 0, 0.92)",
        text: "#ffffff",
      },
      tabs: {
        bg: "rgba(0, 0, 0, 0.88)",
        border: "rgba(255, 255, 255, 0.24)",
      },
      layout: {
        resizerBg: "rgba(255, 255, 255, 0.08)",
      },
      progress: {
        gradient: "linear-gradient(120deg, #ffffff, #bfbfbf)",
      },
    },
    terminal: {
      background: "#000000",
      foreground: "#ffffff",
      selectionBackground: "#333333",
      cursor: "#ffffff",
    },
  },
  light: {
    label: { zh: "浅色", en: "Light" },
    foundation: {
      typography: {
        textPrimary: "#000000",
        textSecondary: "#1f1f1f",
        textMuted: "#595959",
        textSoft: "#434343",
        textQuiet: "#737373",
      },
      accent: {
        default: "#000000",
        strong: "#000000",
        contrast: "#ffffff",
        soft: "rgba(0, 0, 0, 0.46)",
        subtle: "rgba(0, 0, 0, 0.12)",
      },
      effects: {
        shadowStrong: "0 16px 32px rgba(0, 0, 0, 0.2)",
        brandGlow: "0 0 12px rgba(0, 0, 0, 0.28)",
      },
    },
    semantic: {
      background: {
        appBase: "#ffffff",
        appGradient: "linear-gradient(140deg, #ffffff 0%, #ffffff 100%)",
        appImage: "none",
        appOverlay: "none",
      },
      surface: {
        base: "rgba(255, 255, 255, 0.9)",
        strong: "rgba(255, 255, 255, 0.96)",
        alt: "rgba(255, 255, 255, 0.88)",
        header: "rgba(255, 255, 255, 0.92)",
        headerStrong: "rgba(255, 255, 255, 0.98)",
        menu: "rgba(255, 255, 255, 0.98)",
      },
      border: {
        weak: "rgba(0, 0, 0, 0.14)",
        soft: "rgba(0, 0, 0, 0.08)",
        input: "rgba(0, 0, 0, 0.2)",
      },
      feedback: {
        success: "#000000",
        successSoft: "rgba(0, 0, 0, 0.24)",
        danger: "#262626",
      },
    },
    component: {
      button: {
        bg: "rgba(0, 0, 0, 0.06)",
        bgStrong: "rgba(0, 0, 0, 0.1)",
        text: "#000000",
      },
      input: {
        bg: "rgba(255, 255, 255, 0.95)",
        text: "#000000",
      },
      tabs: {
        bg: "rgba(255, 255, 255, 0.95)",
        border: "rgba(0, 0, 0, 0.22)",
      },
      layout: {
        resizerBg: "rgba(0, 0, 0, 0.06)",
      },
      progress: {
        gradient: "linear-gradient(120deg, #000000, #666666)",
      },
    },
    terminal: {
      background: "#ffffff",
      foreground: "#000000",
      selectionBackground: "#d9d9d9",
      cursor: "#000000",
    },
  },
};

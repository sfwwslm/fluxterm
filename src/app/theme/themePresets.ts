/**
 * 主题预设定义模块。
 * 职责：集中维护应用主题变量与终端配色，供全局主题切换使用。
 */
import type { Locale } from "@/i18n";
import type { ThemeId } from "@/types";

export type ThemePreset = {
  label: Record<Locale, string>;
  vars: Record<string, string>;
  terminal: {
    background: string;
    foreground: string;
    selectionBackground: string;
    cursor: string;
  };
};

/** 主题预设定义。 */
export const themePresets: Record<ThemeId, ThemePreset> = {
  dark: {
    label: { zh: "深色", en: "Dark" },
    vars: {
      "--app-bg-gradient": "linear-gradient(140deg, #000000 0%, #000000 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#000000",
      "--text-primary": "#ffffff",
      "--text-secondary": "#e6e6e6",
      "--text-muted": "#bdbdbd",
      "--text-soft": "#cccccc",
      "--text-quiet": "#999999",
      "--accent": "#ffffff",
      "--accent-strong": "#ffffff",
      "--accent-contrast": "#000000",
      "--accent-soft": "rgba(255, 255, 255, 0.6)",
      "--accent-subtle": "rgba(255, 255, 255, 0.18)",
      "--surface": "rgba(0, 0, 0, 0.86)",
      "--surface-strong": "rgba(0, 0, 0, 0.92)",
      "--surface-alt": "rgba(0, 0, 0, 0.8)",
      "--surface-header": "rgba(0, 0, 0, 0.8)",
      "--surface-header-strong": "rgba(0, 0, 0, 0.88)",
      "--surface-menu": "rgba(0, 0, 0, 0.98)",
      "--border-weak": "rgba(255, 255, 255, 0.16)",
      "--border-soft": "rgba(255, 255, 255, 0.1)",
      "--border-input": "rgba(255, 255, 255, 0.2)",
      "--button-bg": "rgba(255, 255, 255, 0.08)",
      "--button-bg-strong": "rgba(255, 255, 255, 0.12)",
      "--button-text": "#ffffff",
      "--input-bg": "rgba(0, 0, 0, 0.92)",
      "--input-text": "#ffffff",
      "--tab-bg": "rgba(0, 0, 0, 0.88)",
      "--tab-border": "rgba(255, 255, 255, 0.24)",
      "--success": "#ffffff",
      "--success-soft": "rgba(255, 255, 255, 0.3)",
      "--danger": "#d9d9d9",
      "--resizer-bg": "rgba(255, 255, 255, 0.08)",
      "--progress-gradient": "linear-gradient(120deg, #ffffff, #bfbfbf)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.5)",
      "--brand-glow": "0 0 12px rgba(255, 255, 255, 0.55)",
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
    vars: {
      "--app-bg-gradient": "linear-gradient(140deg, #ffffff 0%, #ffffff 100%)",
      "--app-bg-image": "none",
      "--app-bg-base": "#ffffff",
      "--text-primary": "#000000",
      "--text-secondary": "#1f1f1f",
      "--text-muted": "#595959",
      "--text-soft": "#434343",
      "--text-quiet": "#737373",
      "--accent": "#000000",
      "--accent-strong": "#000000",
      "--accent-contrast": "#ffffff",
      "--accent-soft": "rgba(0, 0, 0, 0.46)",
      "--accent-subtle": "rgba(0, 0, 0, 0.12)",
      "--surface": "rgba(255, 255, 255, 0.9)",
      "--surface-strong": "rgba(255, 255, 255, 0.96)",
      "--surface-alt": "rgba(255, 255, 255, 0.88)",
      "--surface-header": "rgba(255, 255, 255, 0.92)",
      "--surface-header-strong": "rgba(255, 255, 255, 0.98)",
      "--surface-menu": "rgba(255, 255, 255, 0.98)",
      "--border-weak": "rgba(0, 0, 0, 0.14)",
      "--border-soft": "rgba(0, 0, 0, 0.08)",
      "--border-input": "rgba(0, 0, 0, 0.2)",
      "--button-bg": "rgba(0, 0, 0, 0.06)",
      "--button-bg-strong": "rgba(0, 0, 0, 0.1)",
      "--button-text": "#000000",
      "--input-bg": "rgba(255, 255, 255, 0.95)",
      "--input-text": "#000000",
      "--tab-bg": "rgba(255, 255, 255, 0.95)",
      "--tab-border": "rgba(0, 0, 0, 0.22)",
      "--success": "#000000",
      "--success-soft": "rgba(0, 0, 0, 0.24)",
      "--danger": "#262626",
      "--resizer-bg": "rgba(0, 0, 0, 0.06)",
      "--progress-gradient": "linear-gradient(120deg, #000000, #666666)",
      "--shadow-strong": "0 16px 32px rgba(0, 0, 0, 0.2)",
      "--brand-glow": "0 0 12px rgba(0, 0, 0, 0.28)",
    },
    terminal: {
      background: "#ffffff",
      foreground: "#000000",
      selectionBackground: "#d9d9d9",
      cursor: "#000000",
    },
  },
};

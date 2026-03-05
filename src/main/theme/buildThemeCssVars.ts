/**
 * 主题 CSS 变量编译器。
 * 职责：把结构化 token 统一编译成可直接写入 `document.documentElement.style` 的字典。
 */
import type { ThemePreset } from "@/main/theme/themeContracts";
import { themeCssVarKeys } from "@/main/theme/tokens";

/** 编译主题预设为扁平 CSS 变量。 */
export function buildThemeCssVars(theme: ThemePreset): Record<string, string> {
  return {
    [themeCssVarKeys.background.appBase]: theme.semantic.background.appBase,
    [themeCssVarKeys.background.appGradient]:
      theme.semantic.background.appGradient,
    [themeCssVarKeys.background.appImage]: theme.semantic.background.appImage,
    [themeCssVarKeys.background.appOverlay]:
      theme.semantic.background.appOverlay,

    [themeCssVarKeys.typography.textPrimary]:
      theme.foundation.typography.textPrimary,
    [themeCssVarKeys.typography.textSecondary]:
      theme.foundation.typography.textSecondary,
    [themeCssVarKeys.typography.textMuted]:
      theme.foundation.typography.textMuted,
    [themeCssVarKeys.typography.textSoft]: theme.foundation.typography.textSoft,
    [themeCssVarKeys.typography.textQuiet]:
      theme.foundation.typography.textQuiet,

    [themeCssVarKeys.accent.default]: theme.foundation.accent.default,
    [themeCssVarKeys.accent.strong]: theme.foundation.accent.strong,
    [themeCssVarKeys.accent.contrast]: theme.foundation.accent.contrast,
    [themeCssVarKeys.accent.soft]: theme.foundation.accent.soft,
    [themeCssVarKeys.accent.subtle]: theme.foundation.accent.subtle,

    [themeCssVarKeys.surface.base]: theme.semantic.surface.base,
    [themeCssVarKeys.surface.strong]: theme.semantic.surface.strong,
    [themeCssVarKeys.surface.alt]: theme.semantic.surface.alt,
    [themeCssVarKeys.surface.header]: theme.semantic.surface.header,
    [themeCssVarKeys.surface.headerStrong]: theme.semantic.surface.headerStrong,
    [themeCssVarKeys.surface.menu]: theme.semantic.surface.menu,

    [themeCssVarKeys.border.weak]: theme.semantic.border.weak,
    [themeCssVarKeys.border.soft]: theme.semantic.border.soft,
    [themeCssVarKeys.border.input]: theme.semantic.border.input,

    [themeCssVarKeys.button.bg]: theme.component.button.bg,
    [themeCssVarKeys.button.bgStrong]: theme.component.button.bgStrong,
    [themeCssVarKeys.button.text]: theme.component.button.text,

    [themeCssVarKeys.input.bg]: theme.component.input.bg,
    [themeCssVarKeys.input.text]: theme.component.input.text,

    [themeCssVarKeys.tabs.bg]: theme.component.tabs.bg,
    [themeCssVarKeys.tabs.border]: theme.component.tabs.border,

    [themeCssVarKeys.feedback.success]: theme.semantic.feedback.success,
    [themeCssVarKeys.feedback.successSoft]: theme.semantic.feedback.successSoft,
    [themeCssVarKeys.feedback.danger]: theme.semantic.feedback.danger,

    [themeCssVarKeys.layout.resizerBg]: theme.component.layout.resizerBg,
    [themeCssVarKeys.progress.gradient]: theme.component.progress.gradient,
    [themeCssVarKeys.effects.shadowStrong]:
      theme.foundation.effects.shadowStrong,
    [themeCssVarKeys.effects.brandGlow]: theme.foundation.effects.brandGlow,
  };
}

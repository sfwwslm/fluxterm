/**
 * 主题 CSS 变量编译器。
 * 职责：把结构化 token 统一编译成可直接写入 `document.documentElement.style` 的字典。
 */
import type { ThemePreset } from "@/main/theme/themeContracts";
import { themeCssVarKeys } from "@/main/theme/tokens";

/**
 * 编译主题定义为标准 CSS 变量字典。
 * 输出结果用于注入根节点样式，并作为普通 UI 与终端搜索装饰的统一变量来源。
 */
export function buildThemeCssVars(theme: ThemePreset): Record<string, string> {
  return {
    [themeCssVarKeys.font.body]: theme.foundation.typography.fontFamilyBody,
    [themeCssVarKeys.font.mono]: theme.foundation.typography.fontFamilyMono,

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
    [themeCssVarKeys.typography.textTertiary]:
      theme.foundation.typography.textTertiary,
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

    [themeCssVarKeys.surface.canvas]: theme.semantic.surface.canvas,
    [themeCssVarKeys.surface.base]: theme.semantic.surface.base,
    [themeCssVarKeys.surface.strong]: theme.semantic.surface.strong,
    [themeCssVarKeys.surface.alt]: theme.semantic.surface.alt,
    [themeCssVarKeys.surface.panel]: theme.semantic.surface.panel,
    [themeCssVarKeys.surface.elevated]: theme.semantic.surface.elevated,
    [themeCssVarKeys.surface.header]: theme.semantic.surface.header,
    [themeCssVarKeys.surface.headerStrong]: theme.semantic.surface.headerStrong,
    [themeCssVarKeys.surface.menu]: theme.semantic.surface.menu,

    [themeCssVarKeys.border.weak]: theme.semantic.border.weak,
    [themeCssVarKeys.border.soft]: theme.semantic.border.soft,
    [themeCssVarKeys.border.strong]: theme.semantic.border.strong,
    [themeCssVarKeys.border.input]: theme.semantic.border.input,
    [themeCssVarKeys.border.focus]: theme.semantic.border.focus,

    [themeCssVarKeys.button.bg]: theme.component.button.bg,
    [themeCssVarKeys.button.bgStrong]: theme.component.button.bgStrong,
    [themeCssVarKeys.button.text]: theme.component.button.text,

    [themeCssVarKeys.input.bg]: theme.component.input.bg,
    [themeCssVarKeys.input.text]: theme.component.input.text,

    [themeCssVarKeys.tabs.bg]: theme.component.tabs.bg,
    [themeCssVarKeys.tabs.border]: theme.component.tabs.border,

    [themeCssVarKeys.feedback.success]: theme.semantic.feedback.success,
    [themeCssVarKeys.feedback.successSoft]: theme.semantic.feedback.successSoft,
    [themeCssVarKeys.feedback.warning]: theme.semantic.feedback.warning,
    [themeCssVarKeys.feedback.warningSoft]: theme.semantic.feedback.warningSoft,
    [themeCssVarKeys.feedback.info]: theme.semantic.feedback.info,
    [themeCssVarKeys.feedback.infoSoft]: theme.semantic.feedback.infoSoft,
    [themeCssVarKeys.feedback.danger]: theme.semantic.feedback.danger,
    [themeCssVarKeys.feedback.dangerSoft]: theme.semantic.feedback.dangerSoft,

    [themeCssVarKeys.layout.resizerBg]: theme.component.layout.resizerBg,
    [themeCssVarKeys.progress.gradient]: theme.component.progress.gradient,
    [themeCssVarKeys.effects.shadowStrong]:
      theme.foundation.effects.shadowStrong,
    [themeCssVarKeys.effects.brandGlow]: theme.foundation.effects.brandGlow,

    [themeCssVarKeys.terminal.background]: theme.terminal.background,
    [themeCssVarKeys.terminal.foreground]: theme.terminal.foreground,
    [themeCssVarKeys.terminal.selectionBackground]:
      theme.terminal.selectionBackground,
    [themeCssVarKeys.terminal.selectionForeground]:
      theme.terminal.selectionForeground,
    [themeCssVarKeys.terminal.cursor]: theme.terminal.cursor,
    [themeCssVarKeys.terminal.cursorAccent]: theme.terminal.cursorAccent,
    [themeCssVarKeys.terminal.searchMatchBackground]:
      theme.terminal.searchMatchBackground,
    [themeCssVarKeys.terminal.searchMatchBorder]:
      theme.terminal.searchMatchBorder,
    [themeCssVarKeys.terminal.searchMatchOverviewRuler]:
      theme.terminal.searchMatchOverviewRuler,
    [themeCssVarKeys.terminal.searchActiveMatchBackground]:
      theme.terminal.searchActiveMatchBackground,
    [themeCssVarKeys.terminal.searchActiveMatchBorder]:
      theme.terminal.searchActiveMatchBorder,
    [themeCssVarKeys.terminal.searchActiveMatchOverviewRuler]:
      theme.terminal.searchActiveMatchOverviewRuler,

    "--terminal-ansi-black": theme.terminal.ansi.black,
    "--terminal-ansi-red": theme.terminal.ansi.red,
    "--terminal-ansi-green": theme.terminal.ansi.green,
    "--terminal-ansi-yellow": theme.terminal.ansi.yellow,
    "--terminal-ansi-blue": theme.terminal.ansi.blue,
    "--terminal-ansi-magenta": theme.terminal.ansi.magenta,
    "--terminal-ansi-cyan": theme.terminal.ansi.cyan,
    "--terminal-ansi-white": theme.terminal.ansi.white,
    "--terminal-ansi-bright-black": theme.terminal.ansi.brightBlack,
    "--terminal-ansi-bright-red": theme.terminal.ansi.brightRed,
    "--terminal-ansi-bright-green": theme.terminal.ansi.brightGreen,
    "--terminal-ansi-bright-yellow": theme.terminal.ansi.brightYellow,
    "--terminal-ansi-bright-blue": theme.terminal.ansi.brightBlue,
    "--terminal-ansi-bright-magenta": theme.terminal.ansi.brightMagenta,
    "--terminal-ansi-bright-cyan": theme.terminal.ansi.brightCyan,
    "--terminal-ansi-bright-white": theme.terminal.ansi.brightWhite,
  };
}

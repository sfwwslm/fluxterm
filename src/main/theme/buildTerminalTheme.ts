/**
 * 终端主题编译器。
 * 职责：把主题预设中的终端 token 转换为 xterm 可直接消费的对象。
 */
import type {
  TerminalThemeTokens,
  ThemePreset,
} from "@/main/theme/themeContracts";

type BuildTerminalThemeOptions = {
  translucentBackground?: boolean;
  translucentBackgroundAlpha?: number;
  translucentBackgroundBase?: string;
};

/**
 * 把十六进制颜色转为带透明度的 rgba。
 * 仅处理 #rgb / #rrggbb，其他格式直接回退原值。
 */
function withAlpha(color: string, alpha: number) {
  const normalized = color.trim();
  const shortHex = /^#([0-9a-fA-F]{3})$/;
  const longHex = /^#([0-9a-fA-F]{6})$/;
  const rgbLike =
    /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(?:[0-9]*\.?[0-9]+))?\s*\)$/i;
  if (shortHex.test(normalized)) {
    const [, raw] = shortHex.exec(normalized) ?? [];
    if (!raw) return color;
    const [r, g, b] = raw.split("").map((char) => char + char);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  if (longHex.test(normalized)) {
    const [, raw] = longHex.exec(normalized) ?? [];
    if (!raw) return color;
    const r = raw.slice(0, 2);
    const g = raw.slice(2, 4);
    const b = raw.slice(4, 6);
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${alpha})`;
  }
  if (rgbLike.test(normalized)) {
    const [, r, g, b] = rgbLike.exec(normalized) ?? [];
    if (!r || !g || !b) return color;
    return `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${alpha})`;
  }
  return color;
}

/** 从主题预设提取终端主题。 */
export function buildTerminalTheme(
  theme: ThemePreset,
  options: BuildTerminalThemeOptions = {},
): TerminalThemeTokens {
  const alpha = options.translucentBackgroundAlpha ?? 0.52;
  const translucentBase =
    options.translucentBackgroundBase ?? theme.terminal.background;
  const background = options.translucentBackground
    ? withAlpha(translucentBase, alpha)
    : theme.terminal.background;
  return {
    background,
    foreground: theme.terminal.foreground,
    selectionBackground: theme.terminal.selectionBackground,
    cursor: theme.terminal.cursor,
  };
}

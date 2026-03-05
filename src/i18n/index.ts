import { en as enUS } from "@/i18n/en";
import { zh as zhCN } from "@/i18n/zh";

/** 支持的语言标签，采用 BCP 47 标准。 */
export type Locale = "zh-CN" | "en-US";

export const translations = {
  "zh-CN": zhCN,
  "en-US": enUS,
} as const;

export type TranslationKey = keyof typeof zhCN;
export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

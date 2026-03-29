import { enUsTranslations } from "@/i18n/en";
import { zhCnTranslations } from "@/i18n/zh";

/** 支持的语言标签，采用 BCP 47 标准。 */
export type Locale = "zh-CN" | "en-US";

export const translations = {
  "zh-CN": zhCnTranslations,
  "en-US": enUsTranslations,
} as const;

export type TranslationKey = keyof typeof zhCnTranslations;
export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

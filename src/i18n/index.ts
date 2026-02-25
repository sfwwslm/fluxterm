import { en } from "@/i18n/en";
import { zh } from "@/i18n/zh";

export type Locale = "zh" | "en";

export const translations = {
  zh,
  en,
} as const;

export type TranslationKey = keyof typeof translations.zh;
export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

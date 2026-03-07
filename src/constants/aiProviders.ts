import type { AiProviderVendor } from "@/features/ai/types";

export type AiProviderPreset = {
  vendor: Exclude<AiProviderVendor, "custom">;
  label: string;
  defaultBaseUrl: string;
  models: string[];
};

/** 大厂预置接入目录（首版固定 4 家）。 */
export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    vendor: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    vendor: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
  },
  {
    vendor: "qwen",
    label: "通义千问",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
    models: ["qwen-plus", "qwen-turbo", "qwen-max"],
  },
  {
    vendor: "moonshot",
    label: "Moonshot",
    defaultBaseUrl: "https://api.moonshot.cn",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
];

/** 根据厂商获取预置元数据。 */
export function getAiProviderPreset(vendor: AiProviderVendor) {
  return AI_PROVIDER_PRESETS.find((item) => item.vendor === vendor) ?? null;
}

import { getDb } from "@/db";
import { getTopicsWithCounts } from "@/lib/topics";
import { getQueueStats } from "@/lib/ai/worker";
import { getLastReviewWeek, isWeeklyReviewEnabled } from "@/lib/ai/weekly-review";
import { getLastBackupAt } from "@/lib/backup";
import { getTrashCount } from "@/lib/trash";
import { getImageConfig, getLlmConfig, getVisionConfig } from "@/lib/llm-config";
import { SettingsPanel } from "./settings-panel";

export const dynamic = "force-dynamic";

function maskKey(key: string | null): string {
  if (!key) return "未配置";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export default function SettingsPage() {
  const db = getDb();
  const rows = getTopicsWithCounts();

  const config = getLlmConfig();
  const llm = {
    configured: Boolean(config.baseUrl && config.apiKey && config.model),
    baseUrl: config.baseUrl ?? "",
    model: config.model ?? "",
    apiKeyMasked: maskKey(config.apiKey),
    hasDbConfig: config.hasDbConfig,
    sources: config.sources,
  };
  const visionConfig = getVisionConfig();
  const vision = {
    model: visionConfig.model ?? "",
    baseUrl: visionConfig.baseUrl ?? "",
    apiKeyMasked: maskKey(visionConfig.apiKey),
    sources: visionConfig.sources,
  };
  const imageConfig = getImageConfig();
  const image = {
    model: imageConfig.model ?? "",
    baseUrl: imageConfig.baseUrl ?? "",
    apiKeyMasked: maskKey(imageConfig.apiKey),
    sources: imageConfig.sources,
  };

  return (
    <SettingsPanel
      topics={rows}
      llm={llm}
      vision={vision}
      image={image}
      queue={getQueueStats(db)}
      review={{ enabled: isWeeklyReviewEnabled(db), lastWeek: getLastReviewWeek(db) }}
      lastBackupAt={getLastBackupAt()}
      trashCount={getTrashCount(db)}
    />
  );
}

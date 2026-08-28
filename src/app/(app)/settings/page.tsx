import { getDb } from "@/db";
import { getTopicsWithCounts } from "@/lib/topics";
import { getQueueStats } from "@/lib/ai/worker";
import { getLastReviewWeek, isWeeklyReviewEnabled } from "@/lib/ai/weekly-review";
import { getLastBackupAt } from "@/lib/backup";
import { getTrashCount } from "@/lib/trash";
import { getImageConfig, getLlmConfig, getVisionConfig, getReasoningConfig, getEmbeddingConfig } from "@/lib/llm-config";
import { SettingsPanel } from "./settings-panel";
import { listApiTokens } from "@/lib/api-token";
import { isCorrectionLearningEnabled } from "@/lib/correction-learning";
import { getFeatureFlags } from "@/lib/feature-flags";
import { correctionExamples } from "@/db/schema";

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
    shadowed: config.shadowed,
  };
  const visionConfig = getVisionConfig();
  const vision = {
    model: visionConfig.model ?? "",
    baseUrl: visionConfig.baseUrl ?? "",
    apiKeyMasked: maskKey(visionConfig.apiKey),
    sources: visionConfig.sources,
    shadowed: visionConfig.shadowed,
  };
  const imageConfig = getImageConfig();
  const image = {
    model: imageConfig.model ?? "",
    baseUrl: imageConfig.baseUrl ?? "",
    apiKeyMasked: maskKey(imageConfig.apiKey),
    sources: imageConfig.sources,
    shadowed: imageConfig.shadowed,
  };
  const reasoningConfig = getReasoningConfig();
  const reasoning = { model: reasoningConfig.model ?? "", baseUrl: reasoningConfig.baseUrl ?? "", apiKeyMasked: maskKey(reasoningConfig.apiKey), sources: reasoningConfig.sources, shadowed: reasoningConfig.shadowed };
  const embeddingConfig = getEmbeddingConfig();
  const embedding = { model: embeddingConfig.model ?? "", baseUrl: embeddingConfig.baseUrl ?? "", apiKeyMasked: maskKey(embeddingConfig.apiKey), sources: embeddingConfig.sources, shadowed: embeddingConfig.shadowed };

  return (
    <SettingsPanel
      topics={rows}
      llm={llm}
      vision={vision}
      image={image}
      reasoning={reasoning}
      embedding={embedding}
      apiTokens={listApiTokens().map((t) => ({ id: t.id, scope: t.scope, prefix: t.tokenPrefix, last4: t.tokenLast4, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }))}
      correctionLearning={{ enabled: isCorrectionLearningEnabled(db), count: db.select().from(correctionExamples).all().length }}
      features={getFeatureFlags(db)}
      queue={getQueueStats(db)}
      review={{ enabled: isWeeklyReviewEnabled(db), lastWeek: getLastReviewWeek(db) }}
      lastBackupAt={getLastBackupAt()}
      trashCount={getTrashCount(db)}
    />
  );
}

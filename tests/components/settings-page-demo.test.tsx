import { afterEach, describe, expect, it, vi } from "vitest";

const { captured } = vi.hoisted(() => ({
  captured: { baseUrl: undefined as string | undefined },
}));

vi.mock("@/app/(app)/settings/settings-panel", () => ({
  SettingsPanel: (props: { llm: { baseUrl: string } }) => {
    captured.baseUrl = props.llm.baseUrl;
    return null;
  },
}));

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ all: () => [] }) }),
  }),
}));
vi.mock("@/db/schema", () => ({ correctionExamples: {} }));
vi.mock("@/lib/topics", () => ({ getTopicsWithCounts: () => [] }));
vi.mock("@/lib/ai/worker", () => ({
  getQueueStats: () => ({ pending: 0, running: 0, failed: 0, recentFailures: [] }),
}));
vi.mock("@/lib/ai/weekly-review", () => ({
  getLastReviewWeek: () => null,
  isWeeklyReviewEnabled: () => false,
}));
vi.mock("@/lib/backup", () => ({ getLastBackupAt: () => null }));
vi.mock("@/lib/trash", () => ({ getTrashCount: () => 0 }));
vi.mock("@/lib/api-token", () => ({ listApiTokens: () => [] }));
vi.mock("@/lib/correction-learning", () => ({ isCorrectionLearningEnabled: () => false }));
vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlags: () => ({ handwriting: false, imageGen: false, mermaid: false, reasoning: false }),
}));

import SettingsPage from "@/app/(app)/settings/page";

afterEach(() => {
  captured.baseUrl = undefined;
  vi.unstubAllEnvs();
});

describe("设置页 Demo 接入点", () => {
  it("DEMO_MODE=1 时传给 SettingsPanel 的 llm.baseUrl 为空", () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("DEMO_RUNTIME", undefined);
    SettingsPage();
    expect(captured.baseUrl).toBe("");
  });
});

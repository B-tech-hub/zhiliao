import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/settings-panel", () => ({
  SettingsPanel: () => null,
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
  vi.unstubAllEnvs();
});

describe("设置页 Demo 接入点", () => {
  it("DEMO_MODE=1 时传给 SettingsPanel 的 llm.baseUrl 为空", () => {
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("DEMO_RUNTIME", undefined);
    // 服务端页面返回 React 元素，不会直接执行子组件；检查实际传给客户端的参数。
    const page = SettingsPage();
    expect(page.props.llm.baseUrl).toBe("");
  });
});

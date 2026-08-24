import { describe, expect, it } from "vitest";
import { getDb } from "@/db";
import { correctionExamples, settings } from "@/db/schema";
import { recordCorrection, renderCorrectionHints, CORRECTION_LEARNING_SETTING } from "@/lib/correction-learning";
import { insertNote, wipeData } from "../helpers/db";

describe("correction learning", () => {
  it("records user corrections and renders bounded hints", () => {
    wipeData(); insertNote("n1", "关于读书的正文");
    recordCorrection(getDb(), "n1", "topic", "收件箱", "读书");
    expect(getDb().select().from(correctionExamples).all()).toHaveLength(1);
    expect(renderCorrectionHints(getDb())).toContain("收件箱 -> 读书");
  });
  it("can be disabled", () => {
    getDb().insert(settings).values({ key: CORRECTION_LEARNING_SETTING, value: "0", updatedAt: Date.now() }).onConflictDoUpdate({ target: settings.key, set: { value: "0" } }).run();
    expect(renderCorrectionHints(getDb())).toBe("");
  });
});

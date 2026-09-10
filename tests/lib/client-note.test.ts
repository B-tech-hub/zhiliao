import { describe, expect, it } from "vitest";
import { toClientNote } from "@/lib/client-note";

describe("toClientNote", () => {
  it("移除不可跨 Server/Client 边界传递的 embedding BLOB", () => {
    const note = {
      id: "n1",
      topicId: "inbox",
      title: "测试",
      content: "正文",
      summary: null,
      aiStatus: "done",
      transcriptionReviewStatus: "reviewed",
      transcriptionWarnings: null,
      transcriptionCandidate: null,
      topicLocked: 0,
      titleLocked: 0,
      tagsLocked: 0,
      deletedAt: null,
      createdAt: 1,
      updatedAt: 1,
      embedding: Buffer.from([1, 2, 3]),
      embeddingModel: "model",
      embeddingDim: 3,
      embeddingUpdatedAt: 1,
      embeddingChunkCount: 1,
    } as const;

    const result = toClientNote(note);
    expect(result).not.toHaveProperty("embedding");
    expect(result.id).toBe("n1");
    expect(result.embeddingModel).toBe("model");
  });
});

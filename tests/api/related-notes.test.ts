import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { insertNote, wipeData } from "../helpers/db";

const searchMock = vi.fn();
const chatJsonMock = vi.fn();
const configuredMock = vi.fn(() => true);

vi.mock("@/lib/search", () => ({
  hybridSearchNoteIds: searchMock,
  makeExcerpt: (content: string) => content.slice(0, 40),
}));

vi.mock("@/lib/llm", () => ({
  chatJson: chatJsonMock,
  isLlmConfigured: configuredMock,
}));

async function post(noteId: string, content = "这是一段足够长的正文，用来测试相关笔记召回和冲突判断逻辑。") {
  const { POST } = await import("@/app/api/notes/[id]/related/route");
  const request = new NextRequest(`http://localhost/api/notes/${noteId}/related`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return POST(request, { params: Promise.resolve({ id: noteId }) });
}

beforeEach(() => {
  wipeData();
  searchMock.mockReset();
  chatJsonMock.mockReset();
  configuredMock.mockReset().mockReturnValue(true);
  searchMock.mockResolvedValue({
    ids: ["current", "active", "deleted", "missing"],
    terms: ["正文"],
    vectorEnabled: false,
    staleEmbeddingCount: 0,
  });
});

describe("相关笔记接口", () => {
  it("排除当前笔记、回收站笔记和召回但不存在的 ID", async () => {
    insertNote("current", "当前正在编辑的笔记");
    insertNote("active", "一条仍然有效的相关笔记");
    insertNote("deleted", "已删除的相关笔记", { deletedAt: Date.now() });
    chatJsonMock.mockResolvedValue({ conflicts: [] });

    const response = await post("current");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ id: "active", title: "（无标题笔记）" }],
      conflicts: [],
    });
  });

  it("只接受真实候选 ID 的冲突，并截断过长理由", async () => {
    insertNote("current", "当前正在编辑的笔记");
    insertNote("active", "有效候选");
    chatJsonMock.mockResolvedValue({
      conflicts: [
        { noteId: "active", reason: "a".repeat(200) },
        { noteId: "forged", reason: "不应出现在结果中" },
      ],
    });

    const response = await post("current");
    const body = await response.json() as { conflicts: { noteId: string; reason: string }[] };
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].noteId).toBe("active");
    expect(body.conflicts[0].reason).toHaveLength(120);
  });

  it("LLM 未配置或失败时保留相关笔记并返回空冲突", async () => {
    insertNote("current", "当前正在编辑的笔记");
    insertNote("active", "有效候选");
    configuredMock.mockReturnValue(false);

    const response = await post("current");
    await expect(response.json()).resolves.toMatchObject({ conflicts: [], results: [{ id: "active" }] });
    expect(chatJsonMock).not.toHaveBeenCalled();

    configuredMock.mockReturnValue(true);
    chatJsonMock.mockRejectedValue(new Error("供应商不可用"));
    const failedResponse = await post("current");
    await expect(failedResponse.json()).resolves.toMatchObject({ conflicts: [], results: [{ id: "active" }] });
  });

  it("正文过短时不触发检索", async () => {
    const response = await post("current", "太短");
    await expect(response.json()).resolves.toEqual({ results: [], conflicts: [] });
    expect(searchMock).not.toHaveBeenCalled();
  });
});

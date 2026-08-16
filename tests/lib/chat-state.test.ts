import { describe, expect, it } from "vitest";
import type { ChatItem, HistoryMessage, ToolItem } from "@/components/chat/chat-state";
import {
  applyEvent,
  collectNoteIds,
  finalizeStream,
  markUndo,
  pumpSseEvents,
  rebuildItems,
  splitCitations,
} from "@/components/chat/chat-state";
import type { ToolPayload } from "@/lib/ai/chat-loop";

const tools = (items: ChatItem[]) => items.filter((i): i is ToolItem => i.kind === "tool");

function historyRow(
  id: string,
  role: string,
  content: string,
  payload?: ToolPayload,
): HistoryMessage {
  return {
    id,
    conversationId: "conv-1",
    role,
    content,
    toolPayload: payload ? JSON.stringify(payload) : null,
  };
}

describe("applyEvent 文本增量", () => {
  it("并入末尾的 assistant 消息", () => {
    let items: ChatItem[] = [];
    items = applyEvent(items, { delta: "你" });
    items = applyEvent(items, { delta: "好" });
    expect(items).toEqual([{ kind: "text", role: "assistant", content: "你好" }]);
  });

  /* 工具卡片会插在文本中间。若仍并入最后一条 assistant，
     模型「执行后的说明」会跑到卡片上方，读起来像是执行前就说了。 */
  it("卡片之后另起一条 assistant，不回填到卡片上方", () => {
    let items: ChatItem[] = [{ kind: "text", role: "assistant", content: "这就去建" }];
    items = applyEvent(items, { tool_start: { id: "c1", name: "create_note", args: "{}" } });
    items = applyEvent(items, { delta: "建好了" });
    expect(items.map((i) => (i.kind === "text" ? i.content : i.kind))).toEqual([
      "这就去建",
      "tool",
      "建好了",
    ]);
  });

  // 刚发出消息时末尾是用户气泡，首个 delta 若并进去，回答会长在用户消息里
  it("首个 delta 另起 assistant，不并进用户消息", () => {
    const items = applyEvent([{ kind: "text", role: "user", content: "在吗" }], { delta: "在" });
    expect(items).toEqual([
      { kind: "text", role: "user", content: "在吗" },
      { kind: "text", role: "assistant", content: "在" },
    ]);
  });

  it("空 delta 不产生空气泡", () => {
    expect(applyEvent([], { delta: "" })).toEqual([]);
  });
});

describe("applyEvent 工具卡片", () => {
  const start = { tool_start: { id: "c1", name: "create_note", args: '{"content":"跑步"}' } };

  it("tool_start 产生执行中的卡片", () => {
    const items = applyEvent([], start);
    expect(tools(items)[0]).toMatchObject({
      callId: "c1",
      name: "create_note",
      status: "running",
      undo: "none",
    });
  });

  it("tool_end 就地把执行中的卡片改为成功，并记下撤销用的 messageId", () => {
    let items = applyEvent([], start);
    items = applyEvent(items, {
      tool_end: {
        id: "c1",
        name: "create_note",
        ok: true,
        summary: "已新建笔记「跑步」",
        noteIds: ["n1"],
        messageId: "m9",
        canUndo: true,
      },
    });
    expect(tools(items)).toHaveLength(1);
    expect(tools(items)[0]).toMatchObject({
      status: "ok",
      summary: "已新建笔记「跑步」",
      messageId: "m9",
      undo: "available",
      noteIds: ["n1"],
    });
  });

  it("失败的调用不给撤销按钮", () => {
    let items = applyEvent([], start);
    items = applyEvent(items, {
      tool_end: {
        id: "c1",
        name: "create_note",
        ok: false,
        summary: "内容为空",
        messageId: "m9",
        canUndo: false,
      },
    });
    expect(tools(items)[0]).toMatchObject({ status: "failed", summary: "内容为空", undo: "none" });
  });

  /* /api/chat/confirm 会先补发一条 tool_end 再开流。用户若在此期间刷新过页面，
     内存里没有对应的 running 卡片，事件不能被丢掉。 */
  it("找不到对应卡片时补建一张，而不是丢弃事件", () => {
    const items = applyEvent([], {
      tool_end: {
        id: "c1",
        name: "delete_note",
        ok: true,
        summary: "已移入回收站",
        messageId: "m9",
        canUndo: true,
      },
    });
    expect(tools(items)[0]).toMatchObject({ callId: "c1", status: "ok", undo: "available" });
  });

  it("confirm_required 产生待确认卡片，带上回传所需的两个 id", () => {
    const items = applyEvent([], {
      confirm_required: {
        id: "c1",
        name: "delete_note",
        args: '{"noteId":"n1"}',
        summary: "删除笔记 n1",
        messageId: "m5",
        conversationId: "conv-1",
      },
    });
    expect(tools(items)[0]).toMatchObject({
      status: "pending",
      messageId: "m5",
      conversationId: "conv-1",
      summary: "删除笔记 n1",
    });
  });

  // 用户点「允许」后，确认卡片必须原地变成操作卡片，而不是并排出现两张
  it("tool_end 把同一次调用的待确认卡片换成结果卡片", () => {
    let items = applyEvent([], {
      confirm_required: {
        id: "c1",
        name: "delete_note",
        args: "{}",
        summary: "删除笔记 n1",
        messageId: "m5",
        conversationId: "conv-1",
      },
    });
    items = applyEvent(items, {
      tool_end: {
        id: "c1",
        name: "delete_note",
        ok: true,
        summary: "已移入回收站",
        messageId: "m5",
        canUndo: true,
      },
    });
    expect(tools(items)).toHaveLength(1);
    expect(tools(items)[0]).toMatchObject({ status: "ok", undo: "available" });
  });

  it("done 与 error 不改动条目", () => {
    const items: ChatItem[] = [{ kind: "text", role: "assistant", content: "在" }];
    expect(applyEvent(items, { done: true, conversationId: "c" })).toEqual(items);
    expect(applyEvent(items, { error: "炸了" })).toEqual(items);
  });
});

describe("markUndo", () => {
  const base: ChatItem[] = [
    {
      kind: "tool",
      callId: "c1",
      name: "create_note",
      args: "{}",
      status: "ok",
      summary: "已新建",
      messageId: "m9",
      undo: "available",
    },
  ];

  it("成功后置为已撤销", () => {
    const items = markUndo(base, "m9", { ok: true });
    expect(tools(items)[0]).toMatchObject({ undo: "undone" });
  });

  /* 撤销被拒（笔记已被改动，服务端 409）同样要置灰：
     再点一次还是会失败，但 reason 要留在卡片上让用户知道为什么。 */
  it("被拒时置灰并留下服务端给的原因", () => {
    const items = markUndo(base, "m9", { ok: false, reason: "笔记已被修改" });
    expect(tools(items)[0]).toMatchObject({ undo: "rejected", undoReason: "笔记已被修改" });
  });

  it("messageId 对不上时原样返回", () => {
    expect(markUndo(base, "别的消息", { ok: true })).toEqual(base);
  });
});

describe("rebuildItems 重开会话", () => {
  it("用户与助手的文本原样恢复", () => {
    const items = rebuildItems([
      historyRow("m1", "user", "帮我记一条"),
      historyRow("m2", "assistant", "好的"),
    ]);
    expect(items).toEqual([
      { kind: "text", role: "user", content: "帮我记一条" },
      { kind: "text", role: "assistant", content: "好的" },
    ]);
  });

  // 只带 tool_calls 的 assistant 消息 content 是空串，渲染出来是个空气泡
  it("只发起调用、没有文本的 assistant 消息不产生空气泡", () => {
    const items = rebuildItems([
      historyRow("m2", "assistant", "", {
        kind: "calls",
        calls: [{ id: "c1", name: "create_note", args: "{}" }],
      }),
    ]);
    expect(items).toEqual([]);
  });

  it("已执行的写操作重建为可撤销的卡片", () => {
    const items = rebuildItems([
      historyRow("m3", "tool", "笔记 n1 已创建", {
        kind: "result",
        callId: "c1",
        name: "create_note",
        args: "{}",
        ok: true,
        summary: "已新建笔记「跑步」",
        noteIds: ["n1"],
        undo: { tool: "create_note", noteId: "n1", before: {}, afterUpdatedAt: 1 },
      }),
    ]);
    expect(tools(items)[0]).toMatchObject({
      status: "ok",
      summary: "已新建笔记「跑步」",
      messageId: "m3",
      undo: "available",
      noteIds: ["n1"],
    });
  });

  it("撤销过的操作重开后按钮保持置灰", () => {
    const items = rebuildItems([
      historyRow("m3", "tool", "笔记 n1 已创建", {
        kind: "result",
        callId: "c1",
        name: "create_note",
        args: "{}",
        ok: true,
        summary: "已新建",
        undo: { tool: "create_note", noteId: "n1", before: {}, afterUpdatedAt: 1 },
        undone: true,
      }),
    ]);
    expect(tools(items)[0]).toMatchObject({ undo: "undone" });
  });

  it("只读工具没有撤销载荷，重建后也不给按钮", () => {
    const items = rebuildItems([
      historyRow("m3", "tool", "找到 3 条", {
        kind: "result",
        callId: "c1",
        name: "search_notes",
        args: "{}",
        ok: true,
        summary: "找到 3 条笔记",
        noteIds: ["n1", "n2"],
      }),
    ]);
    expect(tools(items)[0]).toMatchObject({ undo: "none", noteIds: ["n1", "n2"] });
  });

  // 关页面时正卡在确认上，重开会话得能接着确认
  it("待确认的操作重建为确认卡片，带回会话 id", () => {
    const items = rebuildItems([
      historyRow("m5", "tool", "（等待用户确认）", {
        kind: "pending",
        callId: "c1",
        name: "delete_note",
        args: '{"noteId":"n1"}',
        summary: "删除笔记 n1",
      }),
    ]);
    expect(tools(items)[0]).toMatchObject({
      status: "pending",
      messageId: "m5",
      conversationId: "conv-1",
      summary: "删除笔记 n1",
    });
  });

  it("载荷损坏的 tool 消息整条跳过，不渲染半张卡片", () => {
    const items = rebuildItems([
      { id: "m3", conversationId: "conv-1", role: "tool", content: "结果", toolPayload: "{坏的" },
    ]);
    expect(items).toEqual([]);
  });
});

describe("collectNoteIds 引用白名单", () => {
  it("累积各次工具结果里的 noteId", () => {
    const items: ChatItem[] = [
      {
        kind: "tool",
        callId: "c1",
        name: "search_notes",
        args: "{}",
        status: "ok",
        summary: "",
        undo: "none",
        noteIds: ["n1", "n2"],
      },
      {
        kind: "tool",
        callId: "c2",
        name: "read_note",
        args: "{}",
        status: "ok",
        summary: "",
        undo: "none",
        noteIds: ["n2", "n3"],
      },
    ];
    expect([...collectNoteIds(items)].sort()).toEqual(["n1", "n2", "n3"]);
  });

  // 当前页面的笔记是作为上下文附件直接塞进 system prompt 的，没经过工具，
  // 但模型引用它完全正当，不放行会把唯一一条真引用降级成纯文本
  it("把当前上下文附件的笔记 id 一并放行", () => {
    expect([...collectNoteIds([], "n9")]).toEqual(["n9"]);
  });
});

describe("splitCitations 引用溯源", () => {
  it("白名单内的引用切成可跳转的片段", () => {
    const segs = splitCitations("跑步有益[^n1]。", new Set(["n1"]));
    expect(segs).toEqual([{ text: "跑步有益" }, { text: "[^n1]", noteId: "n1" }, { text: "。" }]);
  });

  /* 模型会编造 id。渲染成链接点进去是 404，不如保持原样——
     用户看到的是一处无意义标记，而不是一条断掉的线索。 */
  it("白名单外的引用保持纯文本", () => {
    const segs = splitCitations("据说如此[^n404]。", new Set(["n1"]));
    expect(segs).toEqual([{ text: "据说如此[^n404]。" }]);
  });

  it("多处引用与文本按原顺序交错", () => {
    const segs = splitCitations("A[^n1]B[^n2]", new Set(["n1", "n2"]));
    expect(segs).toEqual([
      { text: "A" },
      { text: "[^n1]", noteId: "n1" },
      { text: "B" },
      { text: "[^n2]", noteId: "n2" },
    ]);
  });

  it("没有引用时原样返回一段", () => {
    expect(splitCitations("普通文本", new Set())).toEqual([{ text: "普通文本" }]);
  });

  it("空文本返回空数组", () => {
    expect(splitCitations("", new Set())).toEqual([]);
  });
});

describe("pumpSseEvents", () => {
  function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const s of chunks) c.enqueue(typeof s === "string" ? enc.encode(s) : s);
        c.close();
      },
    });
  }

  const collect = async (...chunks: (string | Uint8Array)[]) => {
    const got: unknown[] = [];
    await pumpSseEvents(streamOf(...chunks), (ev) => got.push(ev));
    return got;
  };

  // 分多次投递：帧读完后 buffer 必须清空，否则后一块会把前面的事件再解析一遍
  it("按空行分帧解析出每个事件，且不重复", async () => {
    const got = await collect(
      'data: {"delta":"你"}\n\n',
      'data: {"delta":"好"}\n\n',
      'data: {"done":true,"conversationId":"c1"}\n\n',
    );
    expect(got).toEqual([
      { delta: "你" },
      { delta: "好" },
      { done: true, conversationId: "c1" },
    ]);
  });

  // 网络会在任意位置切断。丢掉半截帧的话，长回答表现为随机丢字
  it("被切成两块的事件仍能完整解析", async () => {
    const got = await collect('data: {"delta":"跑', '步"}\n\ndata: {"delta":"完了"}\n\n');
    expect(got).toEqual([{ delta: "跑步" }, { delta: "完了" }]);
  });

  /* 中文一个字三个字节，TCP 可能切在字节中间。
     解码时不声明 stream 会把半个字解成 �，用户看到的是乱码而非缺字。 */
  it("多字节字符被切在字节中间不产生乱码", async () => {
    const full = new TextEncoder().encode('data: {"delta":"你好"}\n\n');
    const got = await collect(full.slice(0, 17), full.slice(17));
    expect(got).toEqual([{ delta: "你好" }]);
  });

  it("畸形帧跳过，不影响后续事件", async () => {
    const got = await collect('data: {坏的\n\ndata: {"delta":"还在"}\n\n');
    expect(got).toEqual([{ delta: "还在" }]);
  });

  it("非 data 行（心跳、注释）忽略", async () => {
    const got = await collect(': keep-alive\n\ndata: {"delta":"在"}\n\n');
    expect(got).toEqual([{ delta: "在" }]);
  });
});

/* 流断在半途时的收尾。这条提示是「回答可信度」的一部分：
   半段话与完整回答在气泡里长得一模一样，不标出来用户无从分辨。 */
describe("流式收尾", () => {
  const reply: ChatItem[] = [
    { kind: "text", role: "user", content: "问题" },
    { kind: "text", role: "assistant", content: "答了一半" },
  ];
  const flags = { sawDone: false, sawError: false, aborted: false };
  const lastText = (items: ChatItem[]) => items[items.length - 1] as { truncated?: boolean };

  it("没收到 done 就结束：标记最后一段回答", () => {
    expect(lastText(finalizeStream(reply, flags)).truncated).toBe(true);
  });

  it("正常收到 done：不标记", () => {
    expect(lastText(finalizeStream(reply, { ...flags, sawDone: true })).truncated).toBeUndefined();
  });

  // 用户点「停止」是他自己的意图，再提示「可能不完整」是废话
  it("用户主动停止：不标记", () => {
    expect(lastText(finalizeStream(reply, { ...flags, aborted: true })).truncated).toBeUndefined();
  });

  // 出错时错误条已经说明情况，气泡里不再重复一遍
  it("流内报错：不标记", () => {
    expect(lastText(finalizeStream(reply, { ...flags, sawError: true })).truncated).toBeUndefined();
  });

  it("末尾不是助手气泡时原样返回，不硬造空气泡", () => {
    const endsWithCard: ChatItem[] = [
      { kind: "text", role: "user", content: "删了它" },
      { kind: "tool", callId: "c1", name: "delete_note", args: "{}", status: "running", summary: "", undo: "none" },
    ];
    expect(finalizeStream(endsWithCard, flags)).toBe(endsWithCard);
    expect(finalizeStream([], flags)).toEqual([]);
  });
});

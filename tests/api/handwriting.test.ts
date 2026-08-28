/* 手写摄取接口的开关约束。界面入口藏起来了不等于功能关了——
   这条路径会先建一条笔记再排队转写，绕过界面直接打过来就会在库里留下
   一条只有原图的笔记，等一个永远不会跑的转写任务。 */

import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { POST } from "@/app/api/handwriting/route";
import { setFeatureEnabled } from "@/lib/feature-flags";
import { wipeData } from "../helpers/db";

function post(body: unknown) {
  return POST(
    new NextRequest("http://x/api/handwriting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/handwriting", () => {
  beforeEach(() => wipeData());

  it("功能默认关闭时返回 403，且不留下半条笔记", async () => {
    const res = await post({ filename: "whatever.png" });
    expect(res.status).toBe(403);
    expect(getDb().select().from(notes).all()).toHaveLength(0);
  });

  it("开关关闭的判断先于图片是否存在", async () => {
    // 关闭态下不该泄露「这张图在不在库里」，也省掉一次无谓查询
    setFeatureEnabled(getDb(), "handwriting", false);
    const res = await post({ filename: "missing.png" });
    expect(res.status).toBe(403);
  });

  /* 开启后这条路重新走通：图片不存在会走到 404，说明请求已经越过开关这一关。
     用 404 而不是 202 收尾，是为了不在单元测试里牵进真实图片与转写队列。 */
  it("开启后不再被开关拦下", async () => {
    setFeatureEnabled(getDb(), "handwriting", true);
    const res = await post({ filename: "missing.png" });
    expect(res.status).toBe(404);
  });

  it("请求体不合法仍先返回 400", async () => {
    setFeatureEnabled(getDb(), "handwriting", true);
    const res = await post({});
    expect(res.status).toBe(400);
  });
});

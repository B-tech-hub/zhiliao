/* T0 召回验收：用真实供应商与真实检索代码，跑一遍口语化查询的召回。

   默认跳过——它会真实调用 embedding API（约 11 次请求），既花钱又依赖网络，
   不该进 CI。需要时显式开启：

     EMBEDDING_ACCEPTANCE=1 npx vitest run tests/lib/t0-acceptance.test.ts

   保留而非用完即删的原因：计划 §4 把「T0 的 10 组样本回归不退化」列为 T1
   长笔记分块的验收标准之一，分块改的正是 vectorSearch 的召回，必须有同一
   组基准可以回归比对。

   查询设计说明：刻意避开笔记标题与正文用词，并埋了两组领域内干扰
   （09/10 都涉及「通信」，01/05 都涉及「分值与时间分配」），避免送分。
   诚实标注：查询由 AI 设计，虽已避开原文措辞，但设计者读过笔记，仍存在
   确认偏差；真正无偏应由笔记作者自行写出查询。

   2026-08-26 基准：Top1 8/10、Top3 10/10（Qwen3-Embedding-4B / 2560 维）。 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notes } from "@/db/schema";
import { hybridSearchNoteIds, refreshNoteFts } from "@/lib/search";
import { buildNoteEmbeddingText, embedTexts } from "@/lib/ai/embedding";
import { insertNote } from "../helpers/db";

const ENABLED = process.env.EMBEDDING_ACCEPTANCE === "1";
if (ENABLED) process.loadEnvFile(".env.local");

const DIR = path.resolve(__dirname, "../fixtures/t0-notes");

// 查询 → 期望命中的笔记文件序号
const CASES: { q: string; want: string }[] = [
  { q: "选择填空和大题各占多少分", want: "01" },
  { q: "零比零这种式子该怎么下手", want: "02" },
  { q: "拉格朗日那几个定理分别什么时候用", want: "03" },
  { q: "行列式特征值这些内容怎么串成一条线", want: "04" },
  { q: "考试三个小时怎么分配给各个部分", want: "05" },
  { q: "听力老是跟不上有什么办法", want: "06" },
  { q: "作文和翻译是怎么打分的", want: "07" },
  { q: "刚开始学单片机应该按什么顺序推进", want: "08" },
  { q: "传感器接主控芯片选哪种总线合适", want: "09" },
  { q: "多个任务之间传数据怎么避免冲突", want: "10" },
];

const idOf = (n: string) => `n-${n}`;

// 未开启时整体跳过：beforeAll 也必须放进 describe 内，否则它会照常执行并真发请求
describe.runIf(ENABLED)("T0 口语化查询召回验收", () => {
  beforeAll(async () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
    const texts: string[] = [];
    const ids: string[] = [];

    for (const file of files) {
      const raw = readFileSync(path.join(DIR, file), "utf8");
      const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      const front = m ? m[1] : "";
      const body = (m ? m[2] : raw).trim();
      const title = front.match(/^title:\s*(.+)$/m)?.[1].trim() ?? file.replace(/\.md$/, "");
      const id = idOf(file.slice(0, 2));
      insertNote(id, body, { title });
      refreshNoteFts(getDb(), id);
      const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
      texts.push(buildNoteEmbeddingText(note));
      ids.push(id);
    }

    // 真实补算：一次批量请求，写入方式与 worker.ts 的 embed_note 分支一致
    const vectors = await embedTexts(texts);
    const model = process.env.EMBEDDING_MODEL!;
    ids.forEach((id, i) => {
      const note = getDb().select().from(notes).where(eq(notes.id, id)).get()!;
      getDb().update(notes).set({
        embedding: Buffer.from(new Float32Array(vectors[i]).buffer),
        embeddingModel: model,
        embeddingDim: vectors[i].length,
        embeddingUpdatedAt: note.updatedAt,
      }).where(eq(notes.id, id)).run();
    });
    console.log(`\n已导入 ${ids.length} 条笔记并补算向量，维度 ${vectors[0].length}\n`);
  }, 300_000);

  it("逐条报告命中位次", async () => {
    let top1 = 0, top3 = 0;
    const lines: string[] = [];

    for (const { q, want } of CASES) {
      const r = await hybridSearchNoteIds(q, 10);
      const rank = r.ids.indexOf(idOf(want));
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;
      const titleOf = (id: string) =>
        getDb().select({ t: notes.title }).from(notes).where(eq(notes.id, id)).get()?.t ?? "?";
      const mark = rank === 0 ? "✓" : rank > 0 && rank < 3 ? "△" : "✗";
      lines.push(
        `${mark} 「${q}」\n     期望 ${want} → 实际位次 ${rank < 0 ? "未召回" : `第 ${rank + 1} 位`}` +
        `　vectorEnabled=${r.vectorEnabled}\n     Top3: ${r.ids.slice(0, 3).map((id) => titleOf(id)).join(" | ")}`,
      );
    }

    console.log("\n" + lines.join("\n") + "\n");
    console.log(`Top1 命中 ${top1}/${CASES.length}，Top3 命中 ${top3}/${CASES.length}\n`);

    // 计划定的门槛：至少 8/10 进入前 10；这里同时看更严格的 Top3
    expect(top3).toBeGreaterThanOrEqual(8);
  }, 300_000);
});

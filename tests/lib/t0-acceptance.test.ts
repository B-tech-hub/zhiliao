/* T0 召回验收：用真实供应商与真实检索代码，跑一遍口语化查询的召回。

   默认跳过——它会真实调用 embedding API，既花钱又依赖网络，不该进 CI。
   需要时显式开启：

     EMBEDDING_ACCEPTANCE=1 npx vitest run tests/lib/t0-acceptance.test.ts

   T1 分块要对比三种切法，用 CHUNK_MODE 切换（默认 title）：

     CHUNK_MODE=off      整篇一个向量，复现 T0 基准
     CHUNK_MODE=title    分块，标题随每块注入
     CHUNK_MODE=notitle  分块，不注入标题

   保留而非用完即删的原因：计划 §4 把「T0 的 10 组样本回归不退化」列为 T1
   长笔记分块的验收标准之一，分块改的正是 vectorSearch 的召回，必须有同一
   组基准可以回归比对。

   查询设计说明：刻意避开笔记标题与正文用词，并埋了两组领域内干扰
   （09/10 都涉及「通信」，01/05 都涉及「分值与时间分配」），避免送分。
   诚实标注：查询由 AI 设计，虽已避开原文措辞，但设计者读过笔记，仍存在
   确认偏差；真正无偏应由笔记作者自行写出查询。

   2026-08-26 基准（CHUNK_MODE=off）：Top1 8/10、Top3 10/10（Qwen3-Embedding-4B / 2560 维）。
   其中第 8 条只排到第 3，正是分块要解决的稀释问题。 */
import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { hybridSearchNoteIds } from "@/lib/search";
import {
  backfillFixtures,
  fixtureNoteId,
  importFixtureNotes,
  noteTitle,
  type ChunkMode,
} from "../helpers/acceptance";

const ENABLED = process.env.EMBEDDING_ACCEPTANCE === "1";
if (ENABLED) process.loadEnvFile(".env.local");

const CHUNK_MODE = (process.env.CHUNK_MODE ?? "title") as ChunkMode;

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

// 未开启时整体跳过：beforeAll 也必须放进 describe 内，否则它会照常执行并真发请求
describe.runIf(ENABLED)("T0 口语化查询召回验收", () => {
  beforeAll(async () => {
    const ids = importFixtureNotes([DIR]);
    const { dim, total, shape } = await backfillFixtures(ids, CHUNK_MODE);
    console.log(`\nCHUNK_MODE=${CHUNK_MODE}　共 ${total} 段，维度 ${dim}\n每条块数　${shape}\n`);
  }, 300_000);

  it("逐条报告命中位次", async () => {
    let top1 = 0, top3 = 0;
    const lines: string[] = [];

    for (const { q, want } of CASES) {
      const r = await hybridSearchNoteIds(q, 10);
      const rank = r.ids.indexOf(fixtureNoteId(want));
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;
      const mark = rank === 0 ? "✓" : rank > 0 && rank < 3 ? "△" : "✗";
      lines.push(
        `${mark} 「${q}」\n     期望 ${want} → 实际位次 ${rank < 0 ? "未召回" : `第 ${rank + 1} 位`}` +
        `　vectorEnabled=${r.vectorEnabled}\n     Top3: ${r.ids.slice(0, 3).map((id) => noteTitle(id)).join(" | ")}`,
      );
    }

    console.log("\n" + lines.join("\n") + "\n");
    console.log(`Top1 命中 ${top1}/${CASES.length}，Top3 命中 ${top3}/${CASES.length}\n`);

    // 计划定的门槛：至少 8/10 进入前 10；这里同时看更严格的 Top3
    expect(top3).toBeGreaterThanOrEqual(8);
  }, 300_000);
});

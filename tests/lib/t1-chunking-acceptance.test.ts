/* T1 分块验收：长笔记的末尾内容能否被召回。

   默认跳过，与 T0 验收同一套开关：

     EMBEDDING_ACCEPTANCE=1 npx vitest run tests/lib/t1-chunking-acceptance.test.ts --reporter=verbose

   三种切法逐个跑，跨运行对比分数与位次才是结论（CHUNK_MODE 默认 title）：

     CHUNK_MODE=off      整篇一个向量 —— 对照组
     CHUNK_MODE=title    分块且每块注入标题
     CHUNK_MODE=notitle  分块但不注入标题

   为什么只测 vectorSearch 而不测 hybridSearchNoteIds：首轮验收犯过这个错。
   混合检索里 BM25 索引的是全文、不受 5000 字截断影响，末尾查询它照样能命中，
   于是对照组也拿了 2/2 Top1——测出来的是「系统鲁棒」，不是「分块有效」。
   T1 改的是 vectorSearch，验收就必须把向量这一路单独拎出来看。

   为什么要批量预算查询向量：逐条查询各调一次 API，撞 429 的概率随查询数累积，
   首轮验收就因此有 3 条降级成纯 BM25、结论不可用。预算成一次请求后，
   补算与查询各一次，整轮只有两次网络往返。

   笔记与查询均由 AI 撰写，确认偏差与 T0 同：设计者知道答案在哪一节。 */
import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { vectorSearch } from "@/lib/search";
import { embedTexts } from "@/lib/ai/embedding";
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

// T0 的 10 条作为竞争对手，第 11 条是待验证的长笔记
const T0_DIR = path.resolve(__dirname, "../fixtures/t0-notes");
const T1_DIR = path.resolve(__dirname, "../fixtures/t1-notes");

/* 两个查询都指向 5000 字截断线之后的内容：
   - 第七节「代码评审优先看哪几处」是全文最末一节，且主题偏离前六节的内存技术细节
   - 第六节「禁用动态内存分配」是后段结论 */
const TAIL_CASES: { q: string; where: string }[] = [
  { q: "帮同事看代码应该重点盯哪些地方", where: "第七节 · 评审清单（全文最末）" },
  { q: "单片机项目里到底能不能用 malloc", where: "第六节 · 禁用动态分配（后段结论）" },
];

// 加入长笔记后，T0 原有的十条不能被它挤掉——多块笔记不该因为块多而占便宜
const T0_CASES: { q: string; want: string }[] = [
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

const LONG_ID = fixtureNoteId("11");

// 查询串 → 预先算好的查询向量，全部查询一次请求算完
const queryVectors = new Map<string, number[]>();

const fmt = (n: number | undefined) => (n === undefined ? "　　—" : n.toFixed(4));

describe.runIf(ENABLED)("T1 长笔记末尾内容召回", () => {
  beforeAll(async () => {
    const ids = importFixtureNotes([T0_DIR, T1_DIR]);
    const { dim, total, shape } = await backfillFixtures(ids, CHUNK_MODE);
    const queries = [...TAIL_CASES.map((c) => c.q), ...T0_CASES.map((c) => c.q)];
    const vectors = await embedTexts(queries);
    queries.forEach((q, i) => queryVectors.set(q, vectors[i]));
    console.log(`\nCHUNK_MODE=${CHUNK_MODE}　共 ${total} 段，维度 ${dim}\n每条块数　${shape}\n`);
  }, 300_000);

  it("针对末尾内容的查询能召回长笔记", () => {
    const lines: string[] = [];
    let top1 = 0;

    for (const { q, where } of TAIL_CASES) {
      const r = vectorSearch(queryVectors.get(q)!, 10);
      const rank = r.ids.indexOf(LONG_ID);
      if (rank === 0) top1++;
      lines.push(
        `${rank === 0 ? "✓" : rank > 0 ? "△" : "✗"} 「${q}」\n     ${where}` +
        `\n     位次 ${rank < 0 ? "未召回" : `第 ${rank + 1} 位`}　本条得分 ${fmt(r.scores[LONG_ID])}　榜首 ${fmt(r.scores[r.ids[0]])}（${noteTitle(r.ids[0])}）`,
      );
    }

    console.log("\n" + lines.join("\n") + `\n\n末尾召回 Top1 ${top1}/${TAIL_CASES.length}\n`);
    /* 位次只是保底，真正的判据是「本条得分」在三种模式间的变化——
       竞争对手里没有第二条讲 C 语言内存的笔记，光看位次区分不出切法好坏 */
    expect(top1).toBe(TAIL_CASES.length);
  });

  it("加入这条多块长笔记后 T0 十条在向量侧不退化", () => {
    let top1 = 0;
    let top3 = 0;
    const lines: string[] = [];

    for (const { q, want } of T0_CASES) {
      const r = vectorSearch(queryVectors.get(q)!, 10);
      const rank = r.ids.indexOf(fixtureNoteId(want));
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;
      /* 逐条打出得分而不只打异常项：验收标准要求确认「分块没有让原本召回正常的
         笔记吃亏」，位次相同但得分普遍下滑同样是退化信号，只看位次看不出来 */
      const mark = rank === 0 ? "✓" : rank > 0 ? "△" : "✗";
      lines.push(
        `${mark} ${want} ${rank < 0 ? "未召回" : `第 ${rank + 1} 位`}　得分 ${fmt(r.scores[fixtureNoteId(want)])}` +
        (rank === 0 ? "" : `　榜首 ${fmt(r.scores[r.ids[0]])}（${noteTitle(r.ids[0])}）`) +
        (r.ids[0] === LONG_ID ? "　← 被长笔记霸榜" : ""),
      );
    }

    console.log(`\n向量侧 Top1 ${top1}/${T0_CASES.length}　Top3 ${top3}/${T0_CASES.length}\n${lines.join("\n")}\n`);
    expect(top3).toBeGreaterThanOrEqual(8);
  });
});

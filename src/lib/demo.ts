import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { notes, topics } from "@/db/schema";
import { newId } from "@/lib/ids";
import { enqueueNoteProcess } from "@/lib/notes";
import { refreshNoteFts } from "@/lib/search";

// 演示数据必须与 scripts/mock-llm.mjs 的规则严格对齐：
//   含「球」→ 归入「羽毛球」（conf 0.9）；含「视频/选题」→ 归入「自媒体」（conf 0.85）；
//   其余 conf 0.4 留在未分类；未分类概要中 ≥3 条含「跑」/「菜|做饭|厨」→ 建议「跑步」「下厨」；
//   正文 ≥200 字才生成摘要。聚类关键词须出现在正文前 120 字（概要截断长度）内。
const DEMO_TOPICS = ["羽毛球", "自媒体"];

const DEMO_NOTES: string[] = [
  // 4 条 → 羽毛球（其中 1 条 ≥200 字，用于展示 AI 摘要）
  "今晚羽毛球多球训练，反手过渡球比上周稳定，就是步伐还是慢半拍。",
  "双打站位复盘：接杀球后第三拍抢网太急，教练说先稳住中场再压前场。",
  "新球拍拉了 26 磅，杀球下压明显有力，但控球变难了，得适应两周。",
  "这个月羽毛球训练小结：反手高远球终于能稳定打到后场，引拍时机比以前早了半拍，转体也更完整；网前搓球手感有进步，但对方压反手时仍然容易起高球；双打轮转还是乱，接杀之后经常和搭档抢同一个点，需要提前约定谁补网前谁守后场；体能是最大短板，第三局开始步伐就散了，回动速度明显掉下来。下个月计划把绳梯、跳绳和深蹲加回训练，每周三次每次二十分钟，先把下肢的快速启动练回来，再考虑加多球强度。另外拍线掉磅了，周末去把两支球拍都重新拉一次线。",
  // 3 条 → 自媒体
  "下周视频备选：宿舍收纳改造、二手相机购入指南、期末复习 vlog。",
  "剪辑复盘：这期视频开头 10 秒信息量太低，完播率掉得厉害，下次前 3 秒先抛结论。",
  "选题灵感：把长文笔记自动整理成短视频脚本，感觉可以做成一个系列。",
  // 5 条含「跑」→ 留在未分类，触发「跑步」主题建议
  "晨跑 5 公里，配速 6 分 10 秒，最后一公里有点顶不住。",
  "跑前热身偷懒了，小腿酸得不行，下次老老实实做动态拉伸。",
  "夜跑改到操场，塑胶场地对膝盖友好很多。",
  "跑步歌单更新：步频 180 的歌真的能带住节奏。",
  "周末想试 10 公里，先把平时的 5 公里跑扎实再说。",
  // 3 条含「菜/做饭/厨」→ 留在未分类，触发「下厨」主题建议
  "第一次做饭挑战可乐鸡翅，糖放多了，下次减半，出锅前大火收汁。",
  "学做菜第二天：番茄炒蛋要嫩，蛋七成熟先出锅，最后回锅拌匀。",
  "周末逛菜市场买了排骨，试做糖醋排骨，炒糖色差点糊锅。",
];

// 体验模式播种：仅当 DEMO_MODE=1 且笔记表为空时执行。
// 计数守卫保证有数据的库绝不被污染——正式部署误设 DEMO_MODE 也安全。
export function seedDemoDataIfNeeded(db: DB): void {
  if (process.env.DEMO_MODE !== "1") return;
  const count =
    db
      .select({ c: sql<number>`COUNT(*)` })
      .from(notes)
      .get()?.c ?? 0;
  if (count > 0) return;

  console.warn("[demo] 体验模式：写入演示数据（仅供本地体验，正式部署请勿设置 DEMO_MODE）");
  const now = Date.now();
  DEMO_TOPICS.forEach((name, i) => {
    db.insert(topics)
      .values({ id: newId(), name, sortOrder: i, createdAt: now, updatedAt: now })
      .run();
  });
  DEMO_NOTES.forEach((content, i) => {
    const id = newId();
    // 时间错落在过去几天，贴近真实使用痕迹
    const createdAt = now - (DEMO_NOTES.length - i) * 6 * 3600 * 1000;
    db.insert(notes)
      .values({ id, topicId: "inbox", title: "", content, createdAt, updatedAt: createdAt })
      .run();
    // 与生产写入同路径：同步 FTS + 入队 AI 处理（worker 启动后即消费）
    refreshNoteFts(db, id);
    enqueueNoteProcess(db, id);
  });
  console.log(`[demo] 已写入 ${DEMO_TOPICS.length} 个演示主题、${DEMO_NOTES.length} 条演示笔记`);
}

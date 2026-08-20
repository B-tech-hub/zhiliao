import Link from "next/link";
import { getTopicsWithCounts } from "@/lib/topics";
import { NewTopicButton } from "@/components/new-topic-button";

export const dynamic = "force-dynamic";

// 首页：主题卡片列表，未分类置顶
export default function HomePage() {
  const rows = getTopicsWithCounts();

  const inbox = rows.find((t) => t.isSystem);
  const normal = rows.filter((t) => !t.isSystem);

  return (
    <div>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
          <h1 className="font-serif text-display leading-[1.1] tracking-[-0.4px]">
            主题
          </h1>
        </div>
        {/* 主题＝分类容器，与到处都是的"新笔记"按钮刻意分开摆放、文案写全 */}
        <div className="shrink-0">
          <NewTopicButton />
        </div>
      </header>

      {inbox && (
        <Link
          href="/inbox"
          prefetch={true}
          className="mb-4 flex items-center justify-between rounded-card bg-tile px-5 py-4 transition-transform active:scale-[0.99]"
        >
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.24px] text-white">未分类</p>
            <p className="mt-0.5 text-[13px] text-dark-muted">AI 拿不准的笔记先放这里，待整理</p>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 font-mono text-meta font-semibold ${
              inbox.noteCount > 0 ? "bg-danger text-white" : "bg-white/10 text-dark-muted"
            }`}
          >
            {inbox.noteCount}
          </span>
        </Link>
      )}

      {normal.length === 0 ? (
        <div className="rounded-card bg-surface p-10 text-center text-[14px] text-ink-48">
          还没有主题。用右上角的「＋ 新建主题」建一个，比如“自媒体”“羽毛球”。
        </div>
      ) : (
        /* 主题卡不再是固定高度 + 40px 巨大数字的营销瓷砖：那是产品发布页的语法，
           用在每天要扫十几遍的工作台上，一屏放不下几个。改为高度随内容、
           计数回归常规字号，列数随宽度增加。 */
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {normal.map((t) => (
            <Link
              key={t.id}
              href={`/topics/${t.id}`}
              prefetch={true}
              className="flex items-baseline justify-between gap-2 rounded-card bg-surface px-4 py-3.5 ring-hairline transition-[box-shadow,transform] hover:ring-1 active:scale-[0.99]"
            >
              <p className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.24px]">
                {t.name}
              </p>
              <span className="shrink-0 font-mono text-meta text-ink-48">{t.noteCount}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

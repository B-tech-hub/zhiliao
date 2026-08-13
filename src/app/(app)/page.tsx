import Link from "next/link";
import { getTopicsWithCounts } from "@/lib/topics";

export const dynamic = "force-dynamic";

// 首页：主题卡片列表，未分类置顶
export default function HomePage() {
  const rows = getTopicsWithCounts();

  const inbox = rows.find((t) => t.isSystem);
  const normal = rows.filter((t) => !t.isSystem);

  return (
    <div>
      <header className="mb-10">
        <p className="mb-2 text-[12px] font-semibold tracking-[0.06em] text-ink-48">知了</p>
        <h1 className="text-[34px] font-semibold leading-[1.1] tracking-[-0.4px] md:text-[40px]">
          主题
        </h1>
      </header>

      {inbox && (
        <Link
          href="/inbox"
          prefetch={true}
          className="mb-6 flex items-center justify-between rounded-[18px] bg-tile p-6 transition-transform active:scale-[0.99]"
        >
          <div>
            <p className="text-[17px] font-semibold tracking-[-0.374px] text-white">未分类</p>
            <p className="mt-1 text-[14px] text-dark-muted">AI 拿不准的笔记先放这里，待整理</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-[14px] font-semibold ${
              inbox.noteCount > 0 ? "bg-danger text-white" : "bg-white/10 text-dark-muted"
            }`}
          >
            {inbox.noteCount}
          </span>
        </Link>
      )}

      {normal.length === 0 ? (
        <div className="rounded-[18px] bg-surface p-10 text-center text-[14px] text-ink-48">
          还没有主题。去{" "}
          <Link href="/settings" className="text-action">
            设置
          </Link>{" "}
          里创建你的第一个主题，比如“自媒体”“羽毛球”。
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5">
          {normal.map((t) => (
            <Link
              key={t.id}
              href={`/topics/${t.id}`}
              prefetch={true}
              className="flex h-36 flex-col justify-between rounded-[18px] bg-surface p-6 ring-hairline transition-[box-shadow,transform] hover:ring-1 active:scale-[0.99] md:h-44"
            >
              <p className="truncate text-[17px] font-semibold tracking-[-0.374px]">{t.name}</p>
              <div>
                <p className="text-[40px] font-semibold leading-none tracking-[-0.4px]">
                  {t.noteCount}
                </p>
                <p className="mt-1.5 text-[12px] text-ink-48">条笔记</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

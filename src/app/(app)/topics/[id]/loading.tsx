// 主题页骨架：header（标签/标题/计数）+ 右上按钮 + 笔记卡片列表，与真实页面形态对齐避免跳变
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-3 h-3 w-10 rounded bg-veil/5" />
          <div className="h-9 w-48 rounded-[8px] bg-veil/10" />
          <div className="mt-3 h-3.5 w-16 rounded bg-veil/5" />
        </div>
        <div className="h-8 w-[72px] shrink-0 rounded-full bg-veil/10" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[18px] bg-surface p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="h-4 w-1/3 rounded bg-veil/5" />
              <div className="h-3.5 w-10 rounded bg-veil/5" />
            </div>
            <div className="mt-3 h-3.5 w-2/3 rounded bg-veil/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

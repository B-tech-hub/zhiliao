// 未分类页骨架：header + 笔记列表行，与整理页列表形态对齐避免跳变
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="mb-3 h-3 w-14 rounded bg-veil/5" />
        <div className="h-9 w-32 rounded-[8px] bg-veil/10" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-[18px] bg-surface p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="h-4 w-2/5 rounded bg-veil/5" />
              <div className="h-3.5 w-10 rounded bg-veil/5" />
            </div>
            <div className="mt-3 h-3.5 w-3/5 rounded bg-veil/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

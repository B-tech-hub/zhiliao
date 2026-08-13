// 笔记编辑页骨架：与 NoteEditor 白纸卡等高，避免切换白屏与布局跳动
export default function Loading() {
  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7.5rem)]">
      <div className="flex min-h-0 flex-1 animate-pulse flex-col rounded-[18px] bg-surface p-6 md:px-10 md:py-8">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div className="h-[32px] w-32 rounded-full bg-veil/5" />
          <div className="h-4 w-16 rounded bg-veil/5" />
        </div>
        <div className="mb-4 h-9 w-2/3 rounded-[8px] bg-veil/10" />
        <div className="space-y-3">
          <div className="h-4 w-full rounded bg-veil/5" />
          <div className="h-4 w-11/12 rounded bg-veil/5" />
          <div className="h-4 w-4/5 rounded bg-veil/5" />
        </div>
      </div>
    </div>
  );
}

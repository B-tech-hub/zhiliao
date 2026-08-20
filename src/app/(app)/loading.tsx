// 路由切换时的即时反馈骨架：避免服务端渲染期间界面无响应的“卡顿”感
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-10">
        <div className="mb-3 h-3 w-16 rounded bg-veil/5" />
        <div className="h-9 w-40 rounded-utility bg-veil/10" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-36 rounded-card bg-surface md:h-44" />
        ))}
      </div>
    </div>
  );
}

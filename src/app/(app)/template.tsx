/* template 每次导航重新挂载：侧栏不动，内容区（含骨架屏）整体淡入上移 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="motion-safe:animate-page-in">{children}</div>;
}

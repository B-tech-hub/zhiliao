# 0006. PWA 采用"纯离线壳"Service Worker，不做业务缓存

日期：2026-08-12

状态：已采纳

## 背景

应用要落地为 PWA（添加到主屏幕），需要 manifest、图标与 Service Worker。核心矛盾：本应用业务强动态（笔记实时编辑、AI 异步回写、SSE 流式对话）且全站带鉴权，任何页面/数据缓存都有陈旧与泄露风险；而部署形态是 Tailscale 组网（蜂窝网络也可达），真正离线的场景很少。

## 决策

手写约 30 行的 `public/sw.js`，策略为**纯离线壳**：

1. **不缓存任何业务数据与页面**——所有静态资源、API、图片请求一律不拦截（network-only）。
2. 仅预缓存 `public/offline.html`（零依赖静态页，内联双主题 CSS，读 `localStorage("theme")` 与应用主题偏好对齐）。
3. fetch 只接管 `mode === "navigate"` 的页面导航请求，网络失败时兜底展示离线页。
4. `skipWaiting` + `clients.claim`：纯壳 SW 无版本化资源竞态，新版本直接接管；预缓存资源变更时递增 `VERSION` 使旧 cache 淘汰。
5. 仅生产环境注册（`sw-register.tsx`），开发时避免缓存干扰 HMR。

配套约束：`middleware.ts` 的 matcher 免登录放行 `/manifest.webmanifest`、`/sw.js`、`/offline.html`、`/apple-touch-icon.png`、`/icons/*`、`/robots.txt`——浏览器抓取 manifest 与图标**不携带 cookie**，不放行会被 302 到 /login 导致 PWA 安装失败。放行的均为无业务数据的静态壳资源。

## 备选方案与否决理由

1. **next-pwa / Workbox 预缓存全量静态资源**：离线可打开应用壳，但引入构建期依赖与缓存版本管理复杂度；鉴权应用缓存页面有泄露面；业务不可离线使用，缓存壳的收益名不副实。否决。
2. **完全不做 SW**：现代浏览器仅凭 manifest 已可安装，但断网点开 app 显示浏览器错误页，"app 感"崩坏。半天成本换离线兜底页，值得。否决。
3. **离线记笔记 + 回网同步**：IndexedDB 草稿队列、冲突处理、与 AI 流水线衔接均为大工程；Tailscale 下手机几乎总在线，性价比存疑。列入远期，本期不做。

## 边界与升级须知

- 本 SW 的 `skipWaiting` 策略只对"纯离线壳"安全；**将来若扩大缓存范围（预缓存 JS/CSS 等版本化资源），必须重审升级策略**（版本化资源新旧混用会白屏）。
- 图标由 `scripts/generate-icons.mjs` 生成（内嵌纯 path SVG + sharp 栅格化），产物提交进仓库。不复用 `src/app/icon.svg`——它靠 emoji `<text>` 渲染，无 emoji 字体的环境会画成豆腐块。

## 后果

- 新增 `src/app/manifest.ts`、`public/sw.js`、`public/offline.html`、`src/components/sw-register.tsx`、`public/icons/*`、`public/apple-touch-icon.png`；修改 `middleware.ts` matcher。
- 验收项：未登录（无 cookie）直接 GET 上述放行路径均返回 200；生产构建下 SW 注册成功；断网导航展示离线页且主题正确。
- 部署链路（Tailscale HTTPS）见 `docs/部署手册-tailscale.md`。

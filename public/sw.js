/* 极简离线兜底 Service Worker（决策见 docs/adr/0006）：
   不缓存任何业务数据/页面（避开缓存陈旧、鉴权页泄露、版本粘滞等坑）；
   只预缓存离线页；仅接管页面导航请求，网络失败时兜底展示离线页 */
const VERSION = "v1"; // 修改 offline.html 等预缓存资源时递增
const CACHE_NAME = `kb-shell-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])));
  // 纯离线壳无版本化资源竞态，新版本直接接管
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  // 非导航请求（静态资源/API/图片）一律不拦截，保持 network-only
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(OFFLINE_URL)) ?? Response.error();
    }),
  );
});

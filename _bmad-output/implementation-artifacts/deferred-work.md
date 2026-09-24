## Deferred from: code review of spec-2-2-isolate-demo-deployment-and-limit-resources (2026-09-13)

- `settings/features`、`settings/corrections`、`review`、`suggestions/generate`、`trash/purge` 和笔记删除路由在基线中未统一使用 Demo 服务端守卫；本轮未修改这些路由，后续 Demo 能力边界专项复核时处理，不能据此关闭 Story 2.1/2.2 的安全承诺。

- source_spec: `_bmad-output/implementation-artifacts/spec-r1-source-demo-wiring.md`
  summary: 为源码 Demo 的 mock 探测设置单次请求及正文读取时限，避免启动总等待超过预期。
  evidence: R1 独立审查的静态发现：scripts/demo.mjs 的 probeMock 在 fetch 和 res.json 上没有显式时间预算；50 次、每次间隔 200 毫秒的循环仅在单次探测返回后推进，不能约束慢响应或持续不结束的正文。该行为在 R1 前已存在，本轮保留接线修复范围，单独跟进。

- source_spec: none
  summary: 修复静态资源 503 与 Nginx 限流导致的 ChunkLoadError。
  evidence: 0.6.1 候选安装验收记录了六次 `_next/static` 503，日志与入口限流匹配，首轮触发 ChunkLoadError。
  resolution: 2026-09-16 已按 spec-repair-demo-static-rate-limit.md 修复并完成局部配置、HTTP 对照和浏览器复验；见 docs/R1安装验收-2026-09-15.md 第 9 节。该轮未覆盖 React #418，后续专项结果见下项；完整 R1 保持独立。
- source_spec: `_bmad-output/implementation-artifacts/spec-r1-settings-hydration-418.md`
  summary: 定位并修复设置页刷新时的 React #418 水合不一致。
  evidence: 0.6.1 候选安装验收在设置页记录一次 Minified React error #418，具体不一致字段尚未定位。
  progress: 2026-09-16 已复现备份时间的跨时区及日期边界水合错误，局部修复、13 项组件回归和目标文件 ESLint 通过；见 docs/R1安装验收-2026-09-15.md 第 10 节。
  resolution: 用户随后确认一次含补丁的候选构建和隔离浏览器复验，14 个设置页场景及 10 张截图通过；见 docs/R1安装验收-2026-09-15.md 第 11 节。本项代码与本机生产页面验收通过，原现场首帧/时区缺证仍如实保留；完整 R1、Story/Sprint 和发布未关闭。
- source_spec: none
  summary: 完成 0.6.1 候选无缓存安装流程的局部回归复核。
  evidence: 当前安装验收使用已有构建缓存且依赖获取耗时较长，原模板入口与浏览器异常尚未全部关闭，不能宣称候选安装流程完整通过。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-isolate-demo-deployment-and-limit-resources.md`
  summary: 发布并固定包含 Story 2.2 补丁的双架构应用镜像 digest。
  evidence: 当前 Demo Compose 仍指向尚未发布的 0.6.1 tag，本机和远端均无可用 manifest；需要正式构建、推送、manifest 校验及目标主机启动验收，不能由本地候选 tag 代替。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-isolate-demo-deployment-and-limit-resources.md`
  summary: 在目标主机完成 Demo 与正式服务的实际网络隔离、业务卷硬配额和公网 HTTPS 验收。
  evidence: 当前仅完成 Windows Docker Desktop 本机网络对照；Desktop ext4/local named volume 未落实持久硬配额，且未提供目标服务器、正式网络、域名或证书环境。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-isolate-demo-deployment-and-limit-resources.md`
  summary: 增加真实超限流式请求和候选镜像源码 provenance 的端到端验收。
  evidence: 现有 HTTP 探针主要验证 Content-Length 声明，代理超时使用合成 upstream；候选镜像验收尚未校验 OCI revision 与当前工作树源码一致性。

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-isolate-demo-deployment-and-limit-resources.md`
  summary: 为 Compose 启动阶段增加独立 Demo 会话密钥长度与强度校验，并处理宿主 shell 环境优先级污染。
  evidence: Compose 当前只能拒绝空值，弱密钥会在登录签发阶段才失败；Compose 环境优先级允许宿主 `DEMO_*`/`COMPOSE_*` 覆盖独立环境文件，需单独设计兼容的启动门禁。

## Deferred from: code review of spec-2-2-isolate-demo-deployment-and-limit-resources (2026-09-19)

- 应用镜像 `ghcr.io/b-tech-hub/zhiliao:0.6.1` 仍无 digest，且尚未发布；Nginx 已使用固定摘要。公开部署前必须正式构建、推送并钉死双架构 manifest，不能用本地候选 tag 代替。
- `demo_net` 只设置 `com.docker.network.bridge.gateway_mode_ipv4: isolated`，未声明 IPv6 隔离。目标主机验收仍须覆盖 IPv6 出站、实际正式服务边界、业务卷硬配额和公网 HTTPS。
- Compose 启动阶段的会话密钥长度/强度校验仍未落地；弱密钥会拖到登录签发才失败。宿主 `DEMO_*` 覆盖问题本轮单列为 Decision，不在此关闭。
## Deferred from: code review (2026-09-22)

- `GET /api/notes` 与 `GET /api/notes/[id]` 仍 `select()` 整行并展开返回。`embedding` Buffer 会经 JSON 变成 `{ type: "Buffer", data: [...] }` 到达调用方。这是本次三页改动之外的既有出口，不在本轮修补。
- `ClientNote = Omit<Note, "embedding">` 仍可接受完整 `Note`。当前三页已调用 `toClientNote`，但属性类型本身不能阻止以后直接传整行。类型层收紧方式不唯一，本轮不改。

## Deferred from: code review of spec-r1-core-loop.md (2026-09-23)

- 来源注入仍把笔记标成 noteId: <id>（src/lib/ai/sources.ts:156）。模型会把这个前缀抄进 [^noteId:id]。本次只在客户端白名单解析里兼容，没有改注入文案。这是本轮改动之前就有的提示形状。

---
title: '修复 Demo 静态资源请求限流'
type: 'bugfix'
created: '2026-09-15'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="用户已确认修复范围、现有工作区基线及局部验收">

## Intent

**Problem:** R1 安装验收的六次脚本 503 均匹配 `demo_req` 日志，首个失败 URL 导致 ChunkLoadError。静态资源与动态请求共用额度。

**Approach:** 用 `$uri` 映射请求限流 key，仅 `/_next/static/` 使用空 key；页面和 API 继续按来源地址限流。

## Boundaries & Constraints

**Always:** 单 Agent；保留既有改动、历史证据、10r/s、burst 40、nodelay、32 连接及正文/代理限制；同步文档。

**Ask First:** 扩大豁免路径、放宽限额，或增加构建、全量测试、长时验证。

**Never:** 处理 React #418；改变应用源码、缓存、Compose 拓扑、版本、Story/Sprint 或正式数据；提交、推送、发布。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 预期 | 失败处理 |
|---|---|---|---|
| 静态突发 | JS/CSS/字体，含查询参数 | 不占请求额度，完整 200 | 保存状态、正文哈希与日志 |
| 动态突发 | 页面、API | 超额仍按现有行为拒绝 | 必须匹配限流日志 |
| 路径边界 | `/_next/image`、`/_next/staticx/`、API | 无静态豁免 | 拒绝扩大匹配 |
| 动态额度耗尽 | 紧接着请求真实静态文件 | 静态资源仍为 200 | 不用重试掩盖失败 |

</frozen-after-approval>

## Code Map

- `nginx/demo.conf`：HTTP 层 zone、server 层限流及三个代理 location。
- `tests/config/demo-compose.test.ts`：现有配置断言，更新旧 key 并补边界检查。
- `scripts/demo-verification-utils.mjs`：复用清洁环境、Docker 调用及资源归属校验。
- `docs/R1安装验收-2026-09-15.md` 第 5、8 节及其原始日志：只读失败和镜像身份来源。
- 基线：`f213761b795cc020be2122e27301fe4a7c5cf7a0` 加现有工作区；本地 R1 应用与固定 Nginx 镜像均已核实存在。

## Tasks & Acceptance

**Execution:**
- [x] `nginx/demo.conf`：增加限定静态路径的 map，替换请求 zone 的 key。
- [x] `tests/config/demo-compose.test.ts`：覆盖矩阵、动态保护和其他配置约束。
- [x] `docs/验收证据/demo-static-rate-limit-20260915T155500Z-384669e0/`：归档临时验收脚本、旧新对照、浏览器及保护清理结果。
- [x] `README.md`、`README.en.md`、`CHANGELOG.md`：说明静态豁免及动态保护。
- [x] `docs/R1安装验收-2026-09-15.md`、`docs/README.md`、`docs/releases/v0.6.1.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`_bmad-output/implementation-artifacts/deferred-work.md`：追加实际结果，保留原失败及其他待验收项。

**Acceptance Criteria:**
- Given 同一固定候选与最多 6 并发，when 对照旧新配置，then 旧配置复现静态限流，新配置通过矩阵，正文完整且无对应限流日志。
- Given 普通模式、本机 mock 与独立空卷，when 登录、保存设置、禁用缓存刷新并保存笔记，then 无静态限流 503 / ChunkLoadError；React #418 独立记录。
- Given 原工作区和既有资源保护基线，when 本轮结束，then 范围外文件、原环境/数据及 Docker 资源保持，本轮资源归属核对后清理。

## Spec Change Log

## Design Notes

用户已确认本方案及局部运行，无需重复审批。BMad 的子 Agent 步骤按明确的单 Agent 要求改为顺序自查。空 key 使 Nginx 不计请求额度，连接限制保持；不新增静态 location，避免代理继承变化。

## Verification

- `npm test -- tests/config/demo-compose.test.ts --maxWorkers=1 --no-file-parallelism`：相关用例通过。
- `node node_modules/eslint/bin/eslint.js tests/config/demo-compose.test.ts`：通过。
- 独立 project、新卷和回环端口，复用原 R1 镜像，使用 `--no-build --pull never`；实际运行 `nginx -t`、有界 HTTP 对照和短程浏览器验收。
- 保留 32 连接限制，以最多 6 并发检验请求限流；不推广为所有负载均无 503，亦不关闭完整 R1 或发布验收。

2026-09-16 结果：20 项配置回归、局部 ESLint、Nginx 语法、矩阵运行与浏览器检查通过。旧配置 100 次静态请求中 59 次 503，新配置 100 次全部 200；动态突发仍有 59 次请求限流，饱和期间 14 次静态请求全部 200。浏览器三次禁用缓存刷新及笔记保存/重开通过，215 次静态响应均为 200。1 条字体正文采集因后续导航失效，原错误保留；React #418 未出现，仍独立待处理。

[运行结果](../../docs/验收证据/demo-static-rate-limit-20260915T155500Z-384669e0/runtime.json)、[局部检查](../../docs/验收证据/demo-static-rate-limit-20260915T155500Z-384669e0/local-checks.json)、[浏览器](../../docs/验收证据/demo-static-rate-limit-20260915T155500Z-384669e0/browser-report.json)、[最终校验](../../docs/验收证据/demo-static-rate-limit-20260915T155500Z-384669e0/final-checks.json)。本轮资源、凭据和浏览器临时目录已清理；既有资源、148 份环境/数据文件、HEAD、索引与范围外文件保持。

## Suggested Review Order

**静态豁免与动态保护**

- 仅构建静态资源豁免请求额度。
  [demo.conf:11](../../nginx/demo.conf#L11)

- 核对动态请求与连接上限继续生效。
  [demo.conf:29](../../nginx/demo.conf#L29)

**实测结果与配置应用**

- 核对旧新对照、浏览器结果与验收边界。
  [R1安装验收-2026-09-15.md:166](../../docs/R1安装验收-2026-09-15.md#L166)

- 现有实例单独重建入口，初始化新的限流区。
  [README.md:77](../../README.md#L77)

**回归约束**

- 检查规范化路径、相似前缀与限流继承。
  [demo-compose.test.ts:107](../../tests/config/demo-compose.test.ts#L107)

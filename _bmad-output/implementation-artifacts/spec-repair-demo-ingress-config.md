---
title: '修复 Demo 仓库入口配置'
type: 'bugfix'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
context:
  - 'D:/ClaudeProjects/ai_acknowladge/README.md'
  - 'D:/ClaudeProjects/ai_acknowladge/CONTEXT.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/开发规范.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/adr/0026-demo-ingress-isolation.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/验收证据/r1-install-20260915-093206-7a7ba6b4/ingress-config-finding.json'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** `docker-compose.demo.yml` 当前把宿主机入口网络声明为 `internal: true`，导致入口服务虽然健康但没有可用的宿主机端口映射；2026-09-15 安装验收只能通过临时覆盖 `internal: false` 启动，仓库模板本身仍未通过。

**Approach:** 修正 Demo Compose 的入口网络声明，使 Nginx 入口能够按既有配置绑定 `127.0.0.1:3210`，同时保持 app 与 mock LLM 仅加入隔离的 `demo_net`，不改变服务、卷、镜像、认证或代理规则。

## Boundaries & Constraints

**Always:** 入口服务继续通过 Nginx 对外发布；入口端口只绑定回环地址；`demo_net` 保持 `internal: true` 与 isolated 网关；保留现有健康检查、命名网络和 Compose project 隔离；修改使用 UTF-8/LF，中文注释保持简洁。

**Ask First:** 若验证发现 Docker Compose 版本、网关模式或现有 ADR 与该入口拓扑冲突，暂停并报告，不自行改写网络架构或安装流程。

**Never:** 不处理静态资源 503；不处理 React #418；不修改候选安装脚本、镜像版本、应用源码、Nginx 限流规则、数据卷或正式 Compose；不新增公网监听、服务端口或网络类型。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 模板入口启动 | 使用 `docker-compose.demo.yml`，提供 `DEMO_SESSION_SECRET` | `ingress` 获得 `127.0.0.1:3210:8080` 映射并可通过 `/api/healthz` 访问 | Compose 配置解析或健康检查失败时保留日志并报告，不继续扩大范围 |
| 内网隔离保持 | `app` 与 `mockllm` 使用 `demo_net` | 两者无宿主机端口发布，`demo_net` 仍为内部 isolated 网络 | 若出现额外端口或网络暴露，验收失败 |
| 其他环境变量 | 使用独立 `demo.env` 和自定义 project 名称 | 入口网络、卷和服务名称随 project 隔离，不读取正式数据卷 | 不删除或改写现有用户资源 |

</frozen-after-approval>

## Code Map

- `docker-compose.demo.yml:8-21` -- `ingress` 服务、回环端口映射和入口网络连接；本次沿用默认 `127.0.0.1:3210:8080`。
- `docker-compose.demo.yml:129-138` -- `demo_net` 保持 `internal + isolated`；`ingress_net.internal` 已改为 `false`。
- `tests/config/demo-compose.test.ts`、`tests/config/demo-compose-cli.test.ts` -- 分别验证源配置和真实 Compose 展开结果；后者兼容默认 `false` 被省略，并覆盖独立环境文件、缺失密钥及 project 隔离。
- `nginx/demo.conf:1-54` -- 入口监听 `8080` 并代理至 `app:3000`；本次不修改代理、限流或正文大小规则。
- `docs/验收证据/r1-install-20260915-093206-7a7ba6b4/ingress-config-finding.json` -- 记录原模板入口失败、临时 `internal: false` 修正成功及业务内网仍隔离的证据。
- `docs/adr/0026-demo-ingress-isolation.md` -- 既有拓扑决策：入口网络可发布宿主机端口，app/mock 仅在内部隔离网络。

## Tasks & Acceptance

**Execution:**
- [x] `docker-compose.demo.yml` -- 将 `ingress_net.internal` 修正为可发布宿主机端口的配置，保留 `demo_net.internal: true` 和其他服务字段 -- 使仓库模板直接符合既有入口拓扑。
- [x] `tests/config/demo-compose.test.ts`、`tests/config/demo-compose-cli.test.ts` -- 将独立 `.mjs` 检查归并进现有 Vitest 测试，覆盖入口非内部网络、业务 isolated 网关、回环端口及环境文件隔离；兼容 Compose 展开时省略 `false` 字段。
- [x] `docs/验收证据/` -- 复用已核对的本地候选和固定 Nginx 镜像，只覆盖镜像引用及临时资源标签，沿用仓库网络和 3210 端口，完成一次独立 project 入口冒烟、归属清理及保护核对。
- [x] `docs/releases/v0.6.1.md`、`CHANGELOG.md`、`docs/R1安装验收-2026-09-15.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/README.md` -- 补充入口修复结果及验证边界，保留历史失败证据与其他未完成验收。

**Acceptance Criteria:**
- Given 使用独立 `demo.env` 和任意 Compose project，when 执行 `docker compose -f docker-compose.demo.yml config`，then 配置成功展开，`ingress_net.internal` 为 `false` 或未声明内部网络，`demo_net.internal` 仍为 `true`。
- Given 模板启动条件满足，when 执行 Demo Compose 启动并等待健康检查，then 入口服务发布 `127.0.0.1:3210:8080`，`GET /api/healthz` 返回 200，app 与 mock LLM 没有宿主机端口映射。
- Given 回归测试运行，when 检查 Compose 文本或解析结果，then 不允许入口网络重新声明 `internal: true`，也不允许通过新增宿主机端口绕过入口服务。

## Spec Change Log

- 2026-09-15：用户确认收尾计划及一次隔离入口冒烟，保持单 Agent。调查发现配置与 Release Notes 已落盘，但独立 `.mjs` 未纳入 `npm test`，Compose CLI 旧断言仍要求入口 `internal: true`；局部复现为 8 项通过、1 项失败。按确认计划合并测试、补直接运行证据并同步当前文档口径，冻结意图与原 baseline 保持。
- 2026-09-15：规则核对以已批准修复意图及 ADR-0026 的可发布入口拓扑为准，旧模板/CLI 的 `internal: true` 属于待修复偏差，不新增网络架构决策。按用户明确要求及已确认计划，BMad 的审查层由同一 Agent 顺序执行，不启动子 Agent，也不记为独立审查。

## Verification

**Commands:**
- `node node_modules/vitest/vitest.mjs run tests/config/demo-compose.test.ts tests/config/demo-compose-cli.test.ts --maxWorkers=1 --no-file-parallelism`，设置 `REQUIRE_DOCKER_COMPOSE=1` -- expected: 两份测试全部通过且无跳过。
- `docker compose --env-file <临时 demo.env> -p <临时 project> -f docker-compose.demo.yml config` -- expected: 配置成功，入口网络可发布、业务网络保持内部隔离。

**Results（2026-09-15）:**
- 23:01，两份配置测试 9 项通过、无跳过，真实 Docker Compose 检查强制执行；两份测试的局部 ESLint 通过。原调查的 8 通过、1 失败记录保留，未重复全量测试。
- 23:06:38–23:07:17，独立 project `zhiliao-ingress-repair-20260915t145944z-b56abe15` 复用原本地候选 `sha256:8a8f2cd3ec1a26fc68bf04a2661f2306f09bba4b06ba9b1593d74b3f3953deb1`；无构建、无拉取，仅覆盖镜像引用与归属标签。合并前后逐字段对照证明仓库网络和默认端口未被覆盖。
- 三服务健康，实际 `127.0.0.1:3210:8080`，healthz 200；app/mock 无宿主端口或默认路由，业务网仍为 `internal + isolated`。本次 3 容器、3 卷、2 网及运行临时目录已清理，3210 释放；既有 7 容器、8 卷、7 网的受保护元数据与镜像列表未变。
- [运行与清理证据](../../docs/验收证据/demo-ingress-repair-20260915T145944Z-b56abe15/runtime.json)、[9 项配置测试结果](../../docs/验收证据/demo-ingress-repair-20260915T145944Z-b56abe15/vitest-results.json)、[验收说明与边界](../../docs/R1安装验收-2026-09-15.md#demo-ingress-repair)。本次不替代静态资源/React 缺陷、整体安装、原 20 项网络对照、长时代理或发布验收。

**Matrix audit:**

| 冻结矩阵场景 | 已执行并通过的覆盖 |
|---|---|
| 模板入口启动 | Vitest 源配置及 CLI 回环端口断言；运行报告的 baseConfig、overlayScope、servicesAndIsolation、实际端口和 health=200 |
| 内网隔离保持 | 两份配置测试的网络及无端口断言；运行报告的业务网 internal/isolated、app/mock 实际端口和默认路由核对 |
| 其他环境变量 | CLI 的独立环境文件、缺失密钥、正式配置污染对照及 project/卷名检查；运行报告的资源归属和既有资源保护 |

## Review Notes

- 已围绕本修复顺序执行缺漏、边界/删除和验证缺口检查，核对两份实际测试、Vitest 注册范围、旧失败证据及本次运行报告；未发现本修复范围内未解决的问题。
- 删除 `.mjs` 的入口网络、回环端口及 app/mock 网络/无端口断言均由现有 `.test.ts` 保留，新增的 isolated 网关断言及真实 CLI 解析均已运行；活动规格不再引用已删除脚本。
- 复核临时覆盖逐字段只改变本地镜像引用和资源标签，实际端口与 HTTP 均有运行断言；文档已明确保护核对针对资源元数据，不将其扩大为业务卷内容验收。
- 本次构建了覆盖原 `baseline_commit` 后已跟踪和未跟踪文件的差异供定位；正式判断限定于入口修复及本轮开始前后的相关差异，其他既有工作区改动不因本次审查整体获准发布。
- [顺序审查记录](../../docs/验收证据/demo-ingress-repair-20260915T145944Z-b56abe15/review.md)。静态资源 503、React #418、入口出站策略及 Story 2.2 既有公网门槛保持原跟踪范围。

## Suggested Review Order

**入口与业务隔离**

- 入口网允许发布端口，业务网继续隔离。
  [docker-compose.demo.yml:135](../../docker-compose.demo.yml#L135)

**实际运行与适用边界**

- 查看默认端口、网络、清理与未覆盖范围。
  [R1安装验收-2026-09-15.md:140](../../docs/R1安装验收-2026-09-15.md#L140)

**回归防护**

- 真实 Compose 解析兼容 false 字段省略。
  [demo-compose-cli.test.ts:102](../../tests/config/demo-compose-cli.test.ts#L102)

- 保留 isolated 网关和源配置约束。
  [demo-compose.test.ts:43](../../tests/config/demo-compose.test.ts#L43)

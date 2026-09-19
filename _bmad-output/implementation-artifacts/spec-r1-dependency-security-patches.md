---
title: 'R1：交付依赖安全补丁'
type: 'chore'
created: '2026-09-18'
status: 'done'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
review_loop_iteration: 0
context:
  - '{project-root}/docs/依赖告警分诊-2026-09-18.md'
---

<frozen-after-approval reason="待用户确认的实施范围">

## Intent

**Problem:** 0.6.1 候选锁文件有 37 个告警包，含 Next critical、Sharp 和 js-yaml high。

**Approach:** 仅升级已核实的兼容安全补丁；为 R1/R2 准备新的依赖基线，TipTap 风险另行处置。

## Boundaries & Constraints

**Always:** 单 Agent；保留既有工作区、UTF-8/LF、0.6.1 版本、冻结规则与原发布门禁。范围限 Next/ESLint 配置 15.5.24、Sharp 0.35.4、js-yaml 4.3.2、Vitest 4.1.11 及必要关联包。

**Ask First:** 范围外升级、生命周期脚本、build、全量测试或容器/浏览器验收。

**Never:** audit fix --force；升级 React、TipTap 或数据库驱动；新增 js-yaml 直接依赖；清理编译警告源码；接触正式数据、模型、发布或 Story/Sprint 状态。

</frozen-after-approval>

## Code Map

- `package.json`、`package-lock.json`：直接声明、Sharp override 与锁定原生包；PostCSS override 保留。
- `docs/依赖告警分诊-2026-09-18.md`：六份公告、版本证据、调用路径、残余风险和查询命令。
- `src/lib/auth.ts`、`src/lib/vision-images.ts`、`src/middleware.ts`：只读回归入口；不重写鉴权或图片处理。
- `Dockerfile`：standalone 分发；旧镜像不能作为新依赖运行证据。

## Tasks & Acceptance

**Execution:**
- [x] `package.json`、`package-lock.json`：先在临时副本解析并审阅差异，再应用上列版本；Sharp 声明与 override 一致，js-yaml 仅刷新锁文件，保留跨平台可选包。
- [x] `node_modules/`：按已审阅锁文件增量安装，禁用生命周期脚本，保留未变原生模块；若需要重新编译则先说明原因。
- [x] `tests/lib/auth.test.ts`、`tests/lib/vision-images.test.ts`、`tests/api/demo-boundary.test.ts`、`tests/components/settings-panel-hydration.test.tsx`：运行现有定向回归，原生包加载失败如实记录。
- [x] `docs/依赖告警分诊-2026-09-18.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/releases/v0.6.1.md`、`CHANGELOG.md`：追加修补结果、证据与待验收边界，保留旧记录。

**Acceptance Criteria:**
- Given 当前锁文件，When 修补并双范围审计，Then high/critical 清零，剩余 TipTap 不标为豁免；新告警重新分诊。
- Given 新依赖，When 定向回归与版本校验，Then 全部通过且应用版本仍为 0.6.1。
- Given 既有工作区，When 核对差异，Then 仅批准依赖链和文档变化，历史证据及业务源码不变。

## Spec Change Log

## Design Notes

只读分诊结束时，本规格尚未获得复杂实施确认；现有工作区按当时上下文保留。工作流多 Agent 要求按项目规则关闭。

2026-09-18 用户确认“按规格实施并做局部验证”。规格已从磁盘重读，无外部变更；沿用同一工作区与基线。冻结块原文保留，以下按单 Agent 实施，构建、全量测试和 R1/R2 运行验收继续单独确认。

## Verification

- `npm audit --json --package-lock-only` 及追加 `--omit=dev`：保存原始结果，按公告判断，不能仅以退出码推断。
- `npm run check:version`：版本一致。
- `npx --no-install vitest run tests/lib/auth.test.ts tests/lib/vision-images.test.ts tests/api/demo-boundary.test.ts tests/components/settings-panel-hydration.test.tsx --maxWorkers=1`：局部通过，无跳过。
- 目标文件 ESLint；核对实际 Sharp/原生包版本、双平台锁条目、文档链接和保留范围。新的构建与 R1/R2 运行验收另行确认。

### 2026-09-18 实施结果

- 获批的五组版本与必要关联包已更新，锁文件仅 48 个包变化，总包数保持 875。js-yaml 仍为传递开发依赖；React、TipTap、Vite、Rolldown、数据库驱动和 PostCSS 保持。
- 全量/生产审计均为 **32 moderate、0 high、0 critical**，仅剩 TipTap 公告；退出 `1` 的原始 JSON 已留证，未将剩余风险豁免。
- 定向回归 **65/65 通过、无跳过**；8 文件 ESLint 与版本校验通过，应用版本仍为 `0.6.1`。未重跑 build 或全量测试。
- 增量安装禁用生命周期脚本，SQLite/jieba 原生模块哈希未变；Windows 实际加载 Sharp `0.35.4`、libheif `1.23.2`，Linux 双架构可选锁条目完整。
- 临时解析的 Arborist 异常、排除无关锁变更、移除临时约束后的普通复核，以及最终指纹均见[补丁证据](../../docs/验收证据/dependency-patches-20260918T065520Z-aj_74aqy/README.md)。分诊报告、执行清单、Release Notes、CHANGELOG 与文档索引已同步。
- 本轮没有新镜像、R1/R2 运行或正式发布验收。讨论目录 `.memlog.md` 的同期外部变化及新增 `brainstorm.html` 保留并单列；其余范围外文件继续按基线保护。

## Review Notes

2026-09-18 按用户要求完成单 Agent 自审，不将其表述为独立多 Agent 审查。依赖差异、可选平台条目、114 条依赖关系、五份上游元数据和实际回归覆盖已核对，本轮范围内未发现待修复的实现缺陷。TipTap、生产构建和 R1/R2 等已知边界保留，详见[审查记录](../../docs/验收证据/dependency-patches-20260918T065520Z-aj_74aqy/review.md)。

## Suggested Review Order

- 检查直接依赖的安全补丁下限。
  [package.json:47](../../package.json#L47)

- 查看仅含本轮 48 个包变化的完整差异。
  [dependency-changes.patch:1](../../docs/验收证据/dependency-patches-20260918T065520Z-aj_74aqy/dependency-changes.patch#L1)

- 区分补丁结果、历史分诊和待验收边界。
  [依赖告警分诊-2026-09-18.md:86](../../docs/依赖告警分诊-2026-09-18.md#L86)

- 核对局部验证报告、实际命令和保留证据。
  [补丁证据 README.md:1](../../docs/验收证据/dependency-patches-20260918T065520Z-aj_74aqy/README.md#L1)

- 复核未发布候选的说明和后续门禁。
  [v0.6.1.md:1](../../docs/releases/v0.6.1.md#L1)

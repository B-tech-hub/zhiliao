---
title: R2 官方源迁移与候选身份更新
type: chore
created: 2026-09-27
status: done
baseline_commit: dd59aee09034d740960894899aa89eb15c80f9fb
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="用户已批准修改与局部验证，构建和 R2 实测除外">

## Intent

两次 R2 候选构建在 npm ci 失败。用户转述网络对照表明镜像站 TLS 失败、官方源可达；锁文件含 820 个镜像站地址。只迁移下载源，重新固定可复核的候选输入。

## Boundaries & Constraints

**Always:** 单 Agent；只改 resolved 地址，版本、依赖关系、integrity 及业务源码保持；旧候选和失败证据保留；同步当前操作入口。

**Ask First:** 构建、安装依赖、R2 实测、完整门禁、推送或发布。

**Never:** 不操作正式实例，不改 Clash，不升级依赖，不覆盖历史结果，不把局部验证写成构建成功。

</frozen-after-approval>

## Code Map

- `package-lock.json`：820 个 npmmirror 地址、49 个官方地址，原路径形如 `@alloc/quick-lru/-/quick-lru-5.2.0.tgz`。
- `docs/验收证据/0.6.1-baseline-2026-09-23/candidate-inputs.json` 和 `candidate-identity.json`：旧 272 文件清单和身份，只读保留。
- 同目录 `r2/prepare-workspace.ps1`：逐文件校验后复制，增加候选目录参数；`r2/compare.py manifest` 复用文件集合与哈希检查。
- 同目录 `sheet-dry-run.ps1`：操作单桩函数干跑，需从操作单选择正确身份。
- 临时目录 `zhiliao-r2-061-20260927-a`、`-b`：原 build.log 和资源前后记录只读，归档副本并记录哈希，不复制凭据。

## Tasks & Acceptance

**Execution:**
- [x] `package-lock.json`：仅替换 820 个 resolved 主机名。
- [x] `docs/验收证据/0.6.1-registry-2026-09-27/`：新清单、身份、变更比对、失败归档及局部证据。
- [x] 旧证据目录内 `r2/prepare-workspace.ps1`、`sheet-dry-run.ps1`：显式候选路径与局部验证，保持旧默认路径语义。
- [x] `docs/R2出口与恢复操作单-2026-09-23.md`、候选核对表、收口计划、发布草稿、执行清单、文档索引、CHANGELOG：区分旧失败与新候选待构建。

**Acceptance Criteria:**
- Given 原锁文件，When 对比新文件，Then 恰好 820 个 resolved 改为官方主机，除此之外结构与字节片段不变。
- Given 旧清单，When 生成新清单，Then 仍为 272 个输入且仅锁文件哈希变化；旧清单、身份、失败日志字节不变。
- Given 新清单，When 准备独立临时目录并运行 manifest 校验，Then 文件集合及哈希全匹配；旧清单针对新锁文件明确拒绝，重复目录拒绝。
- Given 当前操作单，When 桩函数干跑，Then 使用新镜像标签及来源标签，保留原步骤与四项反例；无真实 Docker 调用。

## Spec Change Log

## Design Notes

用户本轮明确批准准备修改与局部验证，沿用授权执行，不重复申请技能审批。用户明确单 Agent，替代技能内子 Agent 步骤。迁移不改变架构，不新增 ADR，不推进 Sprint Story。

## Verification

结构化锁文件比对、旧新 272 文件校验、准备脚本正反例、操作单干跑、版本检查、链接/编码及 git diff 检查。仅局部验证，不下载依赖；不能代替 Docker 安装或官方包下载实测。真实模型调用为零。

## Suggested Review Order

- 先看范围、新身份与尚未执行的验收：[README.md:3](../../docs/验收证据/0.6.1-registry-2026-09-27/README.md#L3)
- 确认当前运行入口显式选择新候选：[R2出口与恢复操作单-2026-09-23.md:7](../../docs/R2出口与恢复操作单-2026-09-23.md#L7)
- 核对目录参数与旧清单保护：[prepare-workspace.ps1:1](../../docs/验收证据/0.6.1-baseline-2026-09-23/r2/prepare-workspace.ps1#L1)
- 确认依赖变化仅限下载地址：[package-lock.json:1](../../package-lock.json#L1)
- 复核版本、哈希和失败归档：[check-local.py:1](../../docs/验收证据/0.6.1-registry-2026-09-27/check-local.py#L1)
- 查看审查修正与验证边界：[review-r2-official-registry.md:1](review-r2-official-registry.md#L1)

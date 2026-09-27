---
title: '0.6.0 → 0.6.1 隔离升级与回退彩排'
type: 'chore'
created: '2026-09-27'
status: 'done'
baseline_commit: 'ca2d6bd778521c2e71741da10353efbeaadf5d80'
review_loop_iteration: 0
context:
  - '{project-root}/docs/0.6.1收口与R2验收计划-2026-09-23.md'
  - '{project-root}/docs/备份与恢复.md'
  - '{project-root}/docs/R2出口与恢复操作单-2026-09-23.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 0.6.1 发布门禁里，「0.6.0 → 0.6.1 升级」和「升级失败后的回退」都还没有验收。R2 只证明了 0.6.1 自己备份、自己恢复这条路，计划 §4 已写明不能拿它代替。

**Approach:** 在隔离环境里模拟真实用户的升级路径。先用已发布的 `ghcr.io/b-tech-hub/zhiliao:0.6.0` 生成合成数据，并按产品备份入口做一份升级前配对快照；再沿用同一套卷，把镜像换成 R2 已通过的候选 `zhiliao-r2:0.6.1-0a2819f37699`，核对数据与读取。最后按手册做回退：用 0.6.0 镜像和升级前快照在新目标上恢复，并核对结果。

## Boundaries & Constraints

**Always:** 保持单 Agent；只使用合成数据和既有 fixture 样本，真实模型预算为 0。新建唯一的 project 和专用卷，数据步骤一律 `network_mode: none`。正式实例只做前后身份与挂载的只读核对。每一步记录时间、退出码、镜像 ID 和状态 JSON，最终归档到 `docs/验收证据/upgrade-060-061-<run>/`，不收录 env 或密码。任何一步失败立即停止，保留现场和卷。

**Ask First:** 需要重新构建镜像、修改产品源码、开放端口或进行浏览器验证、第二次执行同一 run、删除任何卷或旧资源时，都要先问。0.6.0 端的 seed 如果因 0.6.0 的已知缺陷失败（例如读取 HEIC UUID JPEG），先停下来报告，不自行改断言绕过。

**Never:** 不碰 `./data/db` 或正式容器；不推送、不打 tag、不发布；不跑全量门禁；回退步骤不采用「已迁移的数据库直接交给 0.6.0 镜像」这种做法，只把它作为观测项记录；不把本轮结果写成异地恢复、独立 Linux、arm64 或 RC 已通过。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 就地升级 | 0.6.0 生成的卷（含 HEIC/JPEG 配对、回收站、会话与来源）换成 0.6.1 镜像启动 | 迁移表与升级前一致或只有追加；笔记、主题、标签、摘要、时间、锁字段、会话/来源和图片哈希与升级前状态一致；0.6.0 上传的 HEIC 展示图 HTTP 200，字节一致；关键词搜索命中 | 任一项不一致即停止，保留卷 |
| 升级后写入 | 升级后的实例 | 新建专用笔记和图片，重启后仍在，Markdown 生成 | 同上 |
| 回退 | 升级前快照只读复制到空卷，用 0.6.0 镜像启动 | `integrity_check` 通过；状态与升级前一致；升级后新写入的内容不存在（符合预期） | 同上 |

</frozen-after-approval>

## Code Map

- `src/db/migrations.ts` -- 内嵌 SQL 迁移，只允许追加。`git diff v0.6.0..HEAD -- src/db/` 为空，也就是说预期本次升级不带 schema 变化。这正是要实测确认的点。
- `docs/验收证据/0.6.1-baseline-2026-09-23/r2/` -- 复用 `fixture.cjs`（seed/断言，第 6–8 行限定了 `R2_ROLE` 和 `R2_RUN` 格式，需要复制后扩展出 `upgrade`/`rollback` 角色和 run 格式）、`inspect.cjs`/`compare.py`（状态导出与比对）、`compose.yml`（network none、卷模板，镜像由 `R2_IMAGE` 注入）以及 `fixtures/`（HEIC/PNG 样本）。旧目录只读。
- `docs/验收证据/r2-061-20260927-d/run-stage.ps1` -- 分阶段包装与 transcript 写法的参照，复制后使用，不重放旧 run。
- `docs/验收证据/r2-061-20260927-d/image.json` -- 候选镜像身份，revision 为 `51f0a54b…`。本轮沿用 R2 通过的同一个镜像 `f262652592dd`，不重新构建。
- 本机镜像：`ghcr.io/b-tech-hub/zhiliao:0.6.0` 的 ID 为 `9d74721d9de5`，执行前要记录它的 RepoDigests。
- `docs/备份与恢复.md:116,258-270` -- 「按快照版本选镜像」和「升级失败要用升级前镜像加快照回退」这两条规则，本轮回退步骤照此执行。
- `README.md:200-204`、`docs/部署手册-tailscale.md §8.2` -- 用户侧升级步骤（改 `image:`、pull、up），本轮在隔离 project 里按同样顺序模拟。

## Tasks & Acceptance

**Execution:**
- [x] `docs/验收证据/upgrade-060-061-<run>/` -- 复制并扩展 fixture/inspect/compose/run-stage，新增 `old`（0.6.0 → 0.6.1 同卷）和 `rollback`（0.6.0 空卷恢复）两个角色；记录资源和正式实例的前置快照 -- 让步骤可复现、边界可审计
- [x] 同一目录 -- 0.6.0 seed → 产品备份 → 固化快照 → 导出升级前状态 → 换 0.6.1 启动 → 状态比对、HEIC 读取、搜索 → 新写入 → 重启核对 -- 验证就地升级
- [x] 同一目录 -- 快照只读复制到空卷 → 0.6.0 启动 → `integrity_check` 与状态比对 -- 验证回退
- [x] 同一目录 -- 停止实例、保留卷；归档哈希、凭据扫描、正式实例前后比对 -- 保护边界
- [x] `docs/0.6.1收口与R2验收计划-2026-09-23.md`、`docs/备份与恢复.md`、`docs/releases/v0.6.1.md`、`docs/产品规划/开源发布范围与执行清单-2026-09-13.md`、`docs/README.md`、`CHANGELOG.md` -- 如实同步结果，然后在本地提交 -- 满足文档同步规则

**Acceptance Criteria:**
- Given 本轮结束，when 核对证据，then 每个步骤都有时间、退出码和原始输出；只有矩阵全部实际通过，才能记为「0.6.0→0.6.1 升级/回退本机范围通过」。
- Given 任一步失败，when 收尾，then 停止继续验收、不重试，保留卷和日志，文档写明失败点。
- Given 保护核对，when 前后比对，then 正式实例、旧证据目录和升级前快照的哈希都不变，公开归档中没有凭据。

## Design Notes

回退只认「升级前快照 + 旧镜像 + 新目标」这一条路。原因是手册已规定不能只降级镜像；而且就算 schema 没变，0.6.0 也可能写入 0.6.1 的数据形态（例如 HEIC 路径），会造成混淆。「0.6.0 直接打开升级后的卷」如果要做，只能作为可选观测项，不计入通过判定。

## Verification

**Commands:**
- `git diff v0.6.0..<候选 SHA> -- src/db/` -- expected：输出为空，证明没有 schema 迁移变化
- 本轮 run-stage 各阶段 -- expected：退出码 0，`compare` 输出 0 差异

**Manual checks:**
- 在归档 README 中逐项对照 I/O 矩阵，标出通过或失败，并写明未覆盖的范围。

## 执行结果

run `u061-20260927-a` 六个阶段一次通过：就地升级、升级后写入与重启、按手册回退都已验证。回退后 HEIC 展示图返回 400，这是 0.6.0 自身的缺陷，只作记录。[运行记录](../../docs/验收证据/upgrade-060-061-20260927-a/README.md)、[单 Agent 审查](review-0-6-1-upgrade-rollback-rehearsal.md)。

## Suggested Review Order

**结论与边界**

- 先看结论、观测项和未覆盖范围
  [`README.md:1`](../../docs/验收证据/upgrade-060-061-20260927-a/README.md#L1)

**升级与回退判定**

- 用版本号、迁移前缀和业务表比对来判定通过
  [`compare.py:29`](../../docs/验收证据/upgrade-060-061-20260927-a/tools/compare.py#L29)
- 同卷换镜像，模拟用户改 image 后执行 up
  [`run.ps1:103`](../../docs/验收证据/upgrade-060-061-20260927-a/tools/run.ps1#L103)
- 回退只走「升级前快照 + 0.6.0 + 空卷」
  [`run.ps1:116`](../../docs/验收证据/upgrade-060-061-20260927-a/tools/run.ps1#L116)
- 0.6.1 严格校验 0.6.0 上传图片的字节
  [`fixture.cjs:124`](../../docs/验收证据/upgrade-060-061-20260927-a/tools/fixture.cjs#L124)
- 回退侧的图片状态只记录，升级后写入必须不存在
  [`fixture.cjs:145`](../../docs/验收证据/upgrade-060-061-20260927-a/tools/fixture.cjs#L145)

**文档同步**

- 发布说明提醒：回退后 HEIC 暂时无法显示
  [`v0.6.1.md:59`](../../docs/releases/v0.6.1.md#L59)

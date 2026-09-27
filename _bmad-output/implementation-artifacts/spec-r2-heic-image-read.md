---
title: R2 HEIC 展示图读取兼容修复计划
type: bugfix
created: 2026-09-27
status: done
baseline_commit: 51f0a54b9878b0f1c1df548f976a2ec7bb17f19b
review_loop_iteration: 0
---

## 当前理解

R2 run c 的构建、Markdown 与 ZIP 往返已通过，恢复后的 HEIC JPEG 读取返回 400。上传接口使用带连字符的 UUID，读取接口只接受字母数字文件名；文件和配对快照实际完整。[运行证据](../../docs/验收证据/r2-061-20260927-c/README.md)已归档，九卷和三个停止容器保留。

## 计划与影响范围

1. `src/app/api/images/[filename]/route.ts`：兼容现有字母数字 id 及规范 UUID 文件名，继续限定 png/jpg/gif/webp；不改写或重命名已有图片，不放开任意路径。
2. `tests/api/images.test.ts`：通过真实读取 Route Handler 验证已入库 UUID JPEG 与旧普通 id 正常返回，检查响应 MIME/字节；非法路径、非法扩展名、查无记录、磁盘缺图继续按契约拒绝。适当复用真实合成 HEIC 上传链路，不只测试一段正则。
3. 同步图片测试指南、发布草稿、R2 操作单、执行清单与本次缺陷证据；生成新的候选清单、身份及标签，保留 run a/b/c 原记录。
4. 只执行相关回归与定向检查；修复候选准备完成后，再确认一次构建和新的隔离 R2，不重跑旧 run、不更改旧结果。

## 风险与验收标准

- 放宽名称必须保留完整格式边界，斜杠、反斜杠、路径跳转、编码绕过和非展示扩展名仍拒绝。
- 只改变今后上传的 id 不能修复已有 UUID 图片，因此读取侧必须兼容历史数据。
- Given 已入库、在磁盘的 UUID JPEG，When 经过真实图片读取接口，Then 返回 200、正确 MIME 和相同字节。
- Given 旧普通 id 或非法/缺失图片，When 请求读取，Then 旧成功和拒绝契约保持。
- Given 新候选，When 获准执行 R2，Then 实际 HEIC 展示图可读，完成此前未执行的恢复后比对、重启持久化及浏览器步骤后才判断 R2。

## 授权边界

用户已确认上述修复计划，批准接口修改、真实接口回归、局部验证和新候选及文档准备。本轮不构建、不启动或重跑 R2、不操作正式实例、不推送或发布；模型预算零与单 Agent 约束保持。技能的子 Agent 步骤由当前 Agent 顺序完成，遵循用户明确的单 Agent 要求。准备修复的授权不自动等于新候选的重验证授权。

## Code Map

- `src/app/api/uploads/route.ts`：HEIC 使用 `crypto.randomUUID()`，保留 JPEG 与 HEIC 配对；无需改上传命名。
- `src/app/api/images/[filename]/route.ts`：在数据库和磁盘读取前校验名称，兼容两类服务端 id。
- `tests/setup.ts`、`tests/helpers/db.ts`：内存数据库和业务清理，临时上传目录隔离测试。
- `docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixtures/`：复用 MIT 合成图片，不使用用户照片。
- `docs/验收证据/0.6.1-registry-2026-09-27/`、`docs/验收证据/r2-061-20260927-c/`：历史身份与失败证据只读。

## Tasks & Acceptance

- [x] `tests/api/images.test.ts`：先复现 UUID 读取失败，覆盖真实上传与读取、旧名称、非法输入和两种 404。
- [x] `src/app/api/images/[filename]/route.ts`：最小兼容修复，局部回归转绿，执行定向检查。
- [x] `docs/验收证据/0.6.1-heic-read-2026-09-27/`：新清单、身份、证据与局部准备校验。
- [x] 图片指南、备份恢复、R2 操作单、候选范围、发布草稿、执行清单、文档索引及 CHANGELOG：同步修复和未执行范围。

Given 新候选准备完毕，When 复核清单和操作单，Then 修复输入匹配新身份、旧证据不变，且未声明新构建或 R2 通过。后续运行验收要求保留在上方，不属于本轮执行。

## Verification

32 项真实 Route Handler 回归：修复前 4 项失败，修复后全部通过。定向 ESLint、局部 TypeScript、版本与格式检查通过；276 项准备复制哈希、三份 env 镜像、旧身份与已有目录拒绝通过。操作单 14 块桩函数干跑及四项反例通过；95 个历史证据文件保持。

结果与命令见[准备记录](../../docs/验收证据/0.6.1-heic-read-2026-09-27/README.md)，单 Agent [审查记录](review-r2-heic-image-read.md)。修复与准备完成不表示 R2 完成；新构建、HTTP/浏览器、恢复后完整比对及重启持久化待下一阶段批准。

## Suggested Review Order

- 读取边界：兼容已有 UUID，继续限定展示格式。
  [route.ts:8](../../src/app/api/images/[filename]/route.ts#L8)
- 新旧身份与验证边界：新候选未构建，旧失败保留。
  [README.md:13](../../docs/验收证据/0.6.1-heic-read-2026-09-27/README.md#L13)
- 后续执行入口：显式新候选与新 run，待批准。
  [操作单:9](../../docs/R2出口与恢复操作单-2026-09-23.md#L9)
- 回归：历史图片与真实上传链路均能抓到旧错误。
  [images.test.ts:50](../../tests/api/images.test.ts#L50)

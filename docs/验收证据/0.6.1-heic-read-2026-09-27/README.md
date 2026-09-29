# R2 HEIC 展示图读取修复与候选准备

日期：2026-09-27。读取兼容修复和局部验证完成，**新候选未构建，run d 未执行，R2 仍未通过，0.6.1 未发布**。本次授权仅覆盖修复、局部验证和候选准备，单 Agent 执行；没有操作正式实例或 run c 的停止容器、九卷与源包，也未推送或发布。

## 问题与修复

[run c](../r2-061-20260927-c/README.md) 在恢复后读取 `e03aab43-df51-41a6-a409-ba143c5984e7.jpg` 时返回 400。HEIC 上传使用 `crypto.randomUUID()`，读取接口却只允许字母数字 id。数据库、JPEG 和 HEIC 原件完整，不需要改库、改名或重新上传。

本次只修改 [图片读取接口](../../../src/app/api/images/[filename]/route.ts) 的名称校验和注释：兼容普通字母数字 id 及 `8-4-4-4-12` 分组的小写十六进制 UUID，展示格式仍仅限 png/jpg/gif/webp。完整名称校验后仍需查到数据库记录和磁盘文件。HEIC 原件继续通过导出或完整备份保存，不开放为展示接口格式。上传转换、依赖及数据库结构没有改动，沿用 ADR-0014/0024。

## 新候选身份

| 项目 | 值 |
|---|---|
| 来源提交 | `51f0a54b9878b0f1c1df548f976a2ec7bb17f19b` 加本轮读取修复与测试输入 |
| 清单 | [candidate-inputs.json](candidate-inputs.json)，276 个文件 |
| 清单 SHA-256 | `0a2819f376993fafa61b27f57a9a978ff7ef1c7635d88e8485bee7c0655c7baf` |
| 预定本地标签 | `zhiliao-r2:0.6.1-0a2819f37699` |
| 构建状态 | `prepared-not-built`，image ID 为 null；不是已有镜像或发布 digest |
| 目标平台与运行标记 | linux/amd64；建议 `061-20260927-d`，尚未执行，跨日需改新标记 |

[身份 JSON](candidate-identity.json) 与[输入差异](input-comparison.json)记录：旧 272 项中仅图片读取接口改变，新增接口测试、两张合成图片和样本说明，其余 271 项保持，包括 `package-lock.json`。新增样本与历史样本逐字节相同；复制到 tests 下以便随候选上下文一起准备。

输入仍按工作区真实字节复制；旧 `tests/config/demo-compose-wrapper.test.ts` 的 CRLF 和被忽略的 `next-env.d.ts` 均保留，不能用 Git SHA 代替清单复现。没有重新生成锁文件或调整版本、依赖、integrity。

## 旧身份与失败证据

- 原候选清单：`73198e52de5f3b01a8cf7e9c06ef6769a2880d96b206ee2be519c0e0456b316c`；run a/b 的 npm ci 失败原文见[官方源迁移记录](../0.6.1-registry-2026-09-27/README.md)。
- 官方源候选清单：`225d7f540276242ed323269bdfc331c679b5e301843949a2f9928954a27168b3`；run c 实际镜像为 `sha256:90683fa43f261bcde5cbecd9ecfd7938784b8da989df67f3bd7c7dc8a063d2d9`。构建与 Markdown/ZIP 已通过，恢复后图片 400 及未完成的后续步骤按原记录保留。
- [historical-hashes.json](historical-hashes.json) 固定三个历史目录的 95 个文件，局部检查同时比对工作区字节和相对来源提交的差异。这保护原始证据，不表示重新检查了容器或卷状态。

## 局部验证

| 检查 | 结果 |
|---|---|
| 修复前真实接口回归 | 32 项中 4 项失败、28 项通过；UUID 读取错误返回 400，[原始日志](regression-red.log.txt) |
| 最小修复后 | 32/32 通过，[日志](regression-green.log.txt) |
| 最终测试输入 | 样本从历史 docs 原样复制到 tests 后，32/32 通过，[日志](regression-final.log.txt) |
| 回归覆盖 | 已有 UUID JPEG、新 HEIC 真实上传→JPEG 读取、普通 id、MIME/长度/字节、原件保留、非法路径/编码/扩展名、两种 404 |
| ESLint | 修改接口和新测试两个文件通过，[日志](lint.log.txt) |
| 局部类型检查 | 以新接口测试及其真实导入链为入口，保留 strict、无 emit，通过；[配置](tsconfig.local.json)、[日志](types.log.txt) |
| 准备目录 | 276 项复制后 manifest 通过，三份 env 指向同一新标签；已有目录和旧身份被拒，临时副本清理，[报告](preparation-check.json) |
| 操作单干跑 | 14 块，57 次桩 docker、7 次桩 compare，4 项反例通过；真实 Docker 调用为 0，[最终身份日志](sheet-final.log.txt) |
| 版本 | 保持 0.6.1，[日志](version.log.txt) |
| 清单与文档 | 输入哈希、95 个历史文件、新增链接与 UTF-8/LF 检查通过，[报告](local-check.json) |
| 单 Agent 审查 | [审查记录](../../../_bmad-output/implementation-artifacts/review-r2-heic-image-read.md)，本轮无剩余修复阻断 |

测试直接调用真实 Route Handler、内存数据库和临时上传目录，未启动 HTTP 服务、浏览器或容器。真实 HEIC 是 MIT 合成 96×64 图，未使用用户图片或模型。Vitest 日志中的 Vite 未来 configLoader 兼容提示是既有配置警告，未影响本轮结果；不在本修复中调整工具配置。空的 lint/类型日志表示命令成功且无诊断，退出码记录见 [validation.json](validation.json)。原始日志按字节保留，不做换行转换。

收尾审查修正了清单中继承自迁移阶段的 `change` 说明，最终哈希与标签以上表为准；输入文件字节未再次变化，准备复制与操作单干跑已按最终身份复核。`sheet.log.txt` 保留初次局部干跑输出，最终记录为 `sheet-final.log.txt`。局部文档检查也曾拒绝报告临时占位文件的 CRLF，已改为 LF 后通过。

局部复核命令，不构建或调用 Docker：

```powershell
py -3 docs/验收证据/0.6.1-heic-read-2026-09-27/check-local.py
powershell -NoProfile -ExecutionPolicy Bypass -File docs/验收证据/0.6.1-heic-read-2026-09-27/check-preparation.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File docs/验收证据/0.6.1-baseline-2026-09-23/sheet-dry-run.ps1
```

## 后续确认的范围

[R2 操作单](../../R2出口与恢复操作单-2026-09-23.md)已选本目录和新的 run d。下一阶段建议确认一次新候选构建，成功后执行既定隔离 R2：恢复后图片 HTTP 读取、完整状态比对、重启持久化及浏览器步骤均需实际完成。失败继续停止留证，不覆盖或重跑 c。当前局部回归不能把这些项目记为通过。

完整发布门禁、无缓存安装、独立 Linux、双架构、旧版升级与 RC 等原要求保持；本次不提出推送或发布。

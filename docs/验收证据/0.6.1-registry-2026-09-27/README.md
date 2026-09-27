# R2 官方源迁移与候选更新（2026-09-27）

当前接续：用户随后确认一次构建与 R2。run c 已构建成功，R2 在恢复后的 HEIC 展示图 HTTP 400 处失败，见[运行记录](../r2-061-20260927-c/README.md)。0.6.1 未发布。本目录的清单、身份 JSON 与局部验证文件保留迁移准备时的原始字节；其中 prepared-not-built 是当时状态，运行状态以新目录为准。

下文保留迁移准备阶段的结果与授权范围，当阶段未执行构建、Docker、浏览器或模型调用。

## 修改与候选身份

`package-lock.json` 仅将 820 个 `https://registry.npmmirror.com/` 地址改为 `https://registry.npmjs.org/`，原路径保持。此前 49 个官方地址保留，当前 869 个 resolved 均为官方源。没有重新解析依赖，包版本、依赖关系、integrity 及其余字段完全一致。

| 项目 | 准备阶段值（运行状态见上方接续） |
|---|---|
| 来源提交 | `dd59aee09034d740960894899aa89eb15c80f9fb` 加本轮锁文件差异；仍有旧清单已记录的工作区字节特征 |
| 输入 | [candidate-inputs.json](candidate-inputs.json)，仍为 272 个文件，仅锁文件条目变化，其他 271 个文件字节不变 |
| 新清单 SHA-256 | `225d7f540276242ed323269bdfc331c679b5e301843949a2f9928954a27168b3` |
| 本地镜像标签 | `zhiliao-r2:0.6.1-225d7f540276`，仅预定名称，未构建 |
| 目标平台 | `linux/amd64`，未执行平台验收 |
| 旧清单 SHA-256 | `73198e52de5f3b01a8cf7e9c06ef6769a2880d96b206ee2be519c0e0456b316c`，原目录字节不改 |

完整身份见 [candidate-identity.json](candidate-identity.json)，锁文件结构和条目比对见 [lock-comparison.json](lock-comparison.json)。旧清单、身份、B1/R1 证据继续保留在[原目录](../0.6.1-baseline-2026-09-23/README.md)。迁移不改变业务代码，旧局部回归仅按原覆盖范围复用，不追认新镜像通过。

清单采用工作区字节，不是仅凭 Git SHA 的全新检出：`tests/config/demo-compose-wrapper.test.ts` 保持既有 CRLF，`next-env.d.ts` 保持既有被忽略文件，详见原目录的提交字节对照。新清单、身份文件采用 UTF-8/LF，后续不得把旧身份或环境文件复制到新 run。

## 两次失败与原始证据

run `061-20260927-a`、`061-20260927-b` 均在 Dockerfile 的 `RUN npm ci` 退出 1，错误为 `Exit handler never called!`，没有构建出 R2 镜像。原 build.log 按字节复制成 `.log.txt`，避免被仓库日志忽略规则排除；资源前后快照也按字节归档。清单与哈希见 [failed-builds.json](failed-builds.json)，原临时目录未修改。transcript 仅记录哈希、仍留在原目录，不归档可能包含运行参数的全文。

- [run a 构建日志](failed-builds/a/build.log.txt)
- [run b 构建日志](failed-builds/b/build.log.txt)

原始日志的 Dockerfile 摘录含四处行尾空格，首次暂存检查据此报错。为保留原字节，`failed-builds/.gitattributes` 仅对 `*.log.txt` 禁止文本转换并关闭空白检查；业务文件和其他文档的格式规则保持。修正后的最终只读核对记录为 `local-final-check.json`。

已保存资源记录显示，两轮正式容器 ID、启动时间、重启次数及所记录的卷列表前后相同。该记录过滤了 R2 卷，不能独立证明没有 R2 残留；“已清理 R2 容器和卷”来自用户转述的上一轮收尾，本轮不调用 Docker 复查。

网络原因来自用户转述 Claude 的对照：镜像站直连及系统代理 TLS 失败，官方源两种方式正常。本轮不重复网络探测，不把旧 npm 错误文本本身当成 TLS 根因证据，也不保证新构建必然成功。

## 局部验证

本次验证限定为锁文件结构、文件字节、参数接线与文档。准备脚本只复制文件和生成隔离凭据；操作单干跑用桩函数，不启动 Docker、不安装依赖、不创建数据卷。结果如下：

| 检查 | 结果与证据 |
|---|---|
| 锁文件与清单 | 820 处精确地址替换，其他 JSON 字段相同；272 个输入中仅锁文件变化。`check-local.py` 可重新只读核对，结果记录为 `local-check.json` |
| 准备脚本 | [preparation-check.json](preparation-check.json)：复制后 manifest 通过，三份 env 镜像相同，旧身份/已有目录/坏清单均拒绝；临时目录已清理 |
| 操作单干跑 | [sheet-check.json](sheet-check.json)：14 块、57 次桩 docker 调用、7 次桩 compare 调用、4 项原反例通过 |
| 审查修正 | 未解析的候选目录参数现在明确拒绝，防止静默回落旧身份；[sheet-final-check.json](sheet-final-check.json)记录新增反例及修正后的原矩阵通过 |
| 版本与格式 | `npm run check:version` 通过，应用仍为 0.6.1；`git diff --check` 通过；变更文件 UTF-8/LF、新增链接及 JSON 可解析 |
| 单 Agent 审查 | [审查记录](../../../_bmad-output/implementation-artifacts/review-r2-official-registry.md)：本轮没有剩余阻断，实际下载/构建留待批准 |

可在仓库根目录复核以下局部检查，不调用 Docker：

```powershell
py -3 docs/验收证据/0.6.1-registry-2026-09-27/check-local.py
powershell -NoProfile -ExecutionPolicy Bypass -File docs/验收证据/0.6.1-baseline-2026-09-23/sheet-dry-run.ps1
npm run check:version
git diff --check
```

准备脚本首个局部试验 RunId 因多一个连字符被拒绝，未创建目录；随后合法标记验证通过。原 a、b 构建失败和本次局部输入错误分别记录，不把它们算成同一轮运行。

## 后续执行入口

按[更新后的 R2 操作单](../../R2出口与恢复操作单-2026-09-23.md)显式选择本目录：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File docs/验收证据/0.6.1-baseline-2026-09-23/r2/prepare-workspace.ps1 -RunId 061-20260927-c -CandidateDirectory "docs/验收证据/0.6.1-registry-2026-09-27"
```

实际执行使用当天的新 run；目录存在即拒绝。省略 `-CandidateDirectory` 仍选择旧清单，并会因当前锁文件变化而拒绝；这是历史身份保护，不应绕过。

该输入已获准构建并进入 R2，实际 image ID 与失败点见上方运行记录。以下保留准备时的约束：仅构建一次输入，记录实际 image ID；成功再进入既定 R2 矩阵。失败保留现场，不自动连续重试。准备时标签不是已有镜像；当前虽已本机构建，仍不是 GHCR 发布 digest；完整发布门禁、双架构、升级恢复、无缓存安装及 RC 等要求保留。

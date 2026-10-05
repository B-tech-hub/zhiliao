# R3 main 新增 high：独立调查证据

日期：2026-09-30。结论与处理方案见[调查报告](../../R3主线新增high依赖调查-2026-09-30.md)。本目录是新时点查询，不改写 [M 原归档](../r3-gate4-main-061-36647162597/README.md)与 [F 原归档](../r3-gate4-final-061-36585198727/README.md)。

**结果：开发依赖 `jsdom@29.1.1 → undici@7.29.0` 对应新增 high；两次审计分别为 33 moderate + 1 high、33 moderate + 0 high。** 一个包汇总 10 条公告，其中两条 high 为 GHSA-rfgv-xxqx-mfg5、GHSA-w293-vg96-wgc3。官方修复为 7.29.1，本轮未更新依赖。

## 查询范围与身份

在执行前已向用户说明：仅对与 C/M 同 tree 的 `package.json`、`package-lock.json` 仓库外原字节副本串行查询全依赖与排除开发依赖两种口径；不安装、不修复、不运行生命周期脚本，不触发 CI 或发布。

本机为 Windows、Node 22.19.0、npm 10.9.3；旧 F/M CI 为 Ubuntu、Node 22.23.2、npm 10.9.8。本地 HEAD=C `41cf296d1d1ccc38d1b2f1b3335cc5b8ac4a4b81`，tree `d0f16de6459461315c0b0274a8a0f44bc483e84d`；旧 M 归档证明 M `2ae66f5f3df6b0e7afa3bfa09bf601b18ea96a11` 使用相同 tree。本轮没有更新本地 refs 或访问 GitHub 写接口。

锁文件 SHA-256：`ec7fc3bd5aae1c8cec50723eb69678bfc360c998b154d4d9c6d723a0cfe1564a`。查询时间 UTC 00:00:31–00:00:40。实际命令、绝对临时路径、时间与退出码完整保存在 `*.command.json`；命令语义如下，两个命令均另指定专用临时 npm cache。

```powershell
npm.cmd audit --json --package-lock-only --include=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=20000
npm.cmd audit --json --package-lock-only --omit=dev --include=optional --include=peer --ignore-scripts --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=20000
```

两次退出码均为 1，原因是漏洞告警，JSON 正常、stderr 为空；不是安装或查询失败。`metadata.dependencies` 描述锁文件树规模，不是实际生产镜像包清单。本轮没有执行第三次审计、漏洞载荷、应用测试、构建、Docker 操作或远端 workflow。

## 文件索引

| 文件 | 说明 |
|---|---|
| `input-identity.json` | 本地 HEAD/tree/refs/index、工具版本和 package/lock 原字节与 Git blob 核对。 |
| `audit-all.stdout.json`、`audit-production.stdout.json` | 两次 npm 原始 stdout 字节；对应 command/stderr 文件保留元数据和错误流。 |
| `audit-summary.json` | 从原始报告提取计数与完整 Undici via 列表。 |
| `GHSA-rfgv-xxqx-mfg5.json`、`GHSA-w293-vg96-wgc3.json` | GitHub Advisory API 原始响应，含公布时间、CVE、触发条件、分支影响范围与修复。 |
| `undici-7.29.1.json` | npm 官方 registry 精确修复版元数据；只读查询，没有下载 tarball 或安装。 |
| `node-22.23.2-undici.json` | Node v22.23.2 上游源码的内置 Undici package 元数据，版本为 6.28.0；不是实际镜像运行输出。 |
| `source-queries.json` | 上述四个官方 GET 的 URL、时间、字节数与 SHA-256。 |
| `dependency-inventory.json`、`installed-versions.json` | 锁文件父链/dev 标志与本机已安装版本。 |
| `static-searches.json`、`static-inputs.json` | 源码、测试、jsdom 及旧 CI 摘录；源码指纹只证明读取对象，不代表执行验证。 |
| `preservation-before.json`、`audit-preservation.json` | 审计前 2006 份已有文件指纹，以及两次审计后全部保持的核对。 |
| `closeout-checks.json` | 文档归档后的允许变更、旧证据/依赖/refs/index 与规格冻结块保留核对。 |
| `harness/` | 本轮实际使用的取证脚本副本；`.txt` 仅供审阅，不注册到产品测试。 |
| `files.sha256.json` | 新归档逐文件字节数与 SHA-256，排除清单自身。 |

两条 high 公告公布时间均位于 F/M 安装之间，结合相同 tree 与新审计能够解释计数变化；旧 CI 没有原始审计响应体，不能把本目录报告视为旧 CI 当时的详细返回。Node 内置 6.28.0 仍落入 WebSocket 公告范围，npm 锁条目更新不会替换该副本；生产镜像身份与调用路径仍须按报告边界解释。

规格原 baseline、冻结块与 `in-progress` 保持，未同步 Story/Sprint。仅新增调查资料并同步当前文档入口，旧 F/M 和更早失败保留原字节；没有依赖改动、提交、推送、完整门禁重跑或发布。

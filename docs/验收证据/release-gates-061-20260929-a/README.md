# v0.6.1 最终候选门禁：2026-09-29

**结论：门禁 3 的四条完整命令通过。** 最终全量测试为 858 项通过、26 项按原开关跳过，构建含 lint/严格类型检查成功。首轮失败与修正后的结果分别保留，不代表 RC 或正式发布通过。

## 输入与范围

- 执行基线：`6e79059ff825bb2f0ae5c76d6cb818e6da497d04`，验证时叠加四处未提交修正；完整差异见 [final-source.patch](final-source.patch)。验证后已保存为本地源码提交 `75eeb32b1943c7e54c32e20b416bc7fb8a61f178`，[提交核对](source-commit.json)记录 275 项最终源码输入与提交的对应关系：274 项字节相同，1 项仅为现有 Git 属性规定的 CRLF/LF 转换，已双向复现原始字节。本轮新建的规格、文档与验收工具不计入应用构建源码清单。
- 最终源码清单：[candidate-inputs.json](candidate-inputs.json)，275 项，SHA-256 `0c3dd6fecf14eb53218e85e061ad51737b612e886e5114243320cf49495c1d10`。
- 与旧 276 项清单相比，只改变 `eslint.config.mjs` 和三份测试；`next-env.d.ts` 从可复现源码输入中排除，由 Next.js 生成并单独记录。生成结果指向 `.next/types/routes.d.ts`，见 [next-env.generated.txt](next-env.generated.txt)；[输入核对](input-check.json)确认构建未改写 275 项源码输入。
- [gate-inputs.json](gate-inputs.json)另外记录隔离副本全部 1583 个已跟踪文件，包括测试实际读取的文档、Compose 和 CI 配置；不把源码清单当作全部验证输入。
- [existing-changes.patch](existing-changes.patch)保存本轮开始时的两处已有改动。ESLint 的 `docs/**` 排除已收窄至 `docs/验收证据/**/*.cjs`；模块 mock 修正保留原断言。
- 旧清单、旧镜像 `sha256:f262652592dd2bd32d00aae44f60d4c98caa2c89ca0942254f77918f57aacb4a` 和历史 R1/R2、升级回退、TipTap 证据保持原身份。应用源码、依赖和运行配置未改。

## 运行方式

用户明确批准完整门禁后，单 Agent 在系统临时目录创建独立副本，复制当前已跟踪文件与本机依赖；不带正式环境文件、正式数据或旧构建目录，不在原工作树运行 Next 构建。

环境为 Windows x64、Node.js `22.19.0`、npm `10.9.3`。测试使用 `--maxWorkers=1 --no-file-parallelism`，启用 `CI=1` 和 `REQUIRE_DOCKER_COMPOSE=1`。构建通过 Next.js 已有的 `CIRCLE_NODE_TOTAL=2` 计算单 worker，不改产品构建配置。宿主模型变量不透传，数据库、上传和 Markdown 路径均指向本轮临时目录。

执行工具见 [tools/gates.py](tools/gates.py)，每阶段的命令、环境、起止时间、退出码与原始 stdout/stderr 分别保存在 `commands/`。复制本机依赖不属于无缓存安装证据。

## 已完成的局部验证

- Demo 进程辅助测试：1 文件、2 项通过。
- 两处改动的定向 ESLint：通过。
- 默认版本校验及 `v0.6.1-rc1` 干跑：通过，未创建任何 tag。
- 首轮失败修正后的 4 文件回归：41 项通过，含实际编辑器 26 项。

## 完整门禁

| 命令 | 结果 |
|---|---|
| `npm run check:design` | 通过，检查 148 个源码文件，0.422 秒 |
| `npm run lint` | 通过，5.312 秒 |
| `npm test -- --maxWorkers=1 --no-file-parallelism` | 64 文件通过、3 文件跳过；858 项通过、26 项跳过，77.750 秒 |
| `npm run build` | 通过，105.969 秒，未跳过 lint 或类型检查 |

四条最终命令均绑定同一份 `0c3dd6fe…` 清单，详见 [汇总](summary.json)、[全量报告](test-final-results.json)和 `commands/*-final.json`、[build.json](commands/build.json)。752 个已安装依赖版本与锁文件相同；123 个未安装条目均为可选依赖，见 [版本核对](installed-versions.json)。未重新运行安全审计。

26 项跳过来自既有显式开关：`notes-corpus-acceptance` 23 项需要外部语料目录，T0/T1 共 3 项需要真实 Embedding 验收开关。本轮未开启这些专项，仍按原语料和真实模型证据范围复用；Compose 与安装预览检查实际执行，没有因缺环境跳过。

## 首轮失败与最小修正

[首轮全量](test-results.json)为 855 项通过、3 项失败、26 项跳过；[原样局部复跑](diagnose-before-results.json)稳定重现两个观测错误，编辑器原代码与原时限通过。

| 失败 | 证据与修正 |
|---|---|
| 设置页 Demo 参数为 undefined | `SettingsPage()` 返回 React 元素，不执行 mock 子组件；改为直接检查返回元素的 `props.llm.baseUrl`，继续要求空字符串，产品代码不变 |
| HTTP 探针的“一字节”断言失败 | `/api/import`、`/api/uploads` 各被探测两次，旧测试按路径累加；改为检查五个独立请求的路径、声明长度和实际一字节，保持所有状态码断言 |
| Mermaid 开启时首次加载超过 5 秒 | 原样局部复跑、修正后局部回归及最终全量均通过；未改编辑器、时限或安全断言。首轮发生在新复制依赖的首次运行，具体冷启动耗时来源未定位，保留为一次未稳定复现的时序现象 |

初始清单 `e0ae2374…` 与最终清单分开保存：[initial-candidate-inputs.json](initial-candidate-inputs.json)、[initial-candidate-identity.json](initial-candidate-identity.json)。失败日志未覆盖。

## 告警与保护

- 构建仍报告 libheif 动态依赖、package.json 命名导入和 jose Edge Runtime 告警，与旧 run d 构建记录同类；它们未导致本次命令失败，也未在本任务中静默修改。
- 测试保留 Vite 配置兼容、React `flushSync` 与 mock Link 的 `prefetch` 提示；供应商失败日志来自对应降级测试。
- [保护核对](protection-check.json)记录原工作树生成声明、旧证据与正式容器身份/启动时间/挂载的前后结果。隔离副本和构建产物保留在本轮临时目录，未启动应用服务。
- 首次保护比对把 Docker `Mounts` 数组顺序变化记作差异，原结果见 [protection-raw-order.json](protection-raw-order.json)。按 `Destination` 排序后，各挂载完整字段和容器 ID、启动时间、重启次数均相同；前后原始快照保留，未改写成相同字节。
- 首次补丁复现检查继承用户目录中的另一 Git 仓库，`git apply` 静默跳过四文件，哈希检查将其检出。独立初始化临时仓库后四文件逐字节复现通过；[初次结果](artifact-check-initial.json)和[最终检查](artifact-check.json)分别保留。
- 首次提交绑定按原始字节比较，检出 `tests/config/demo-compose-wrapper.test.ts` 的 47 个 CRLF 在 Git 中为 LF；[原始失败](artifact-check-before-eol.json)及[原始绑定](source-commit-before-eol.json)保留。确认正文完全相同、Git 属性为 `text=auto eol=lf`，并从提交的 LF 字节还原验证时的 CRLF 后，SHA-256 与原始清单一致。最终绑定单列该差异及两种哈希，不改工作树文件或已执行门禁的输入清单；这一文件不在四文件源码补丁内。

## 发布边界

本轮负责门禁 3。无缓存获取、独立 Linux、双架构运行与 manifest、RC 冒烟、异地恢复和正式发布属于门禁 4–6，仍需各自证据。本轮不构建或推送 Docker 镜像，不创建 tag/Release，不重跑已覆盖浏览器与恢复矩阵。

---
title: 'Story 2-2 隔离 Demo 部署并限制资源'
type: 'feature'
created: '2026-09-10'
status: 'in-review'
baseline_commit: 'f213761b795cc020be2122e27301fe4a7c5cf7a0'
context:
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/epic-2-context.md'
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/spec-2-1-server-demo-boundary.md'
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/planning-artifacts/epics-github-install-distribution-demo.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/Issue执行计划-2026-08-29.md'
---

## Intent

为公开体验准备一个与正式实例可并行运行的 Docker Demo。Demo 使用独立 Compose project、网络、命名卷和凭据，不读取正式 `.env`、目录或卷；模型调用固定到容器内 mock LLM。已批准采用固定摘要的 Nginx 入口发布本机 3210，app/mockllm 仅连接 isolated 业务内网。三个服务具备 CPU、内存、进程数、只读文件系统和日志限制，入口限制实际请求体；目标主机还需验证网络阻断及业务卷配额。当前发布基线仍为 v0.6.0，该应用镜像不含本轮补丁；候选验收使用独立本地镜像，公开部署前必须另行发布并固定新 digest。

## 已批准的排期调整

2026-09-13：用户已批准[开源发布优先范围调整](../planning-artifacts/sprint-change-proposal-2026-09-12-open-source-first.md)。当前开源交付与免费自托管反馈先行，本 Story 剩余目标部署验收后移且仍未完成；Story 2.3 继续等待本 Story 全部原验收与审查。原 8 条 AC、任务勾选、复审行动项、状态、baseline_commit 和冻结块均保持。本次仅同步排期，不新增运行通过证据。

## Boundaries & Constraints

**Always**

- 保留本机 3210 入口和 `demo_db`、`demo_uploads`、`demo_notes` 三个独立命名卷；由 ingress 发布 `127.0.0.1:3210:8080` 并固定转发 app:3000。
- Compose 文件不引用 `env_file`、正式路径、正式卷或固定 `container_name`；通过 project name 和显式网络确保可并行运行。
- app/mockllm 仅连接 isolated 的 `demo_net`，均不发布宿主机端口。ingress 连接入口网和业务网；app 可访问 ingress 是已批准的网络例外，入口不提供任意目标代理，模型调用仍只访问 mockllm。
- 资源限制使用 Docker Compose 可识别的服务级字段；磁盘配额若不能由 Compose 跨版本可靠保证，必须在文档中明确由宿主机/卷配额补充，不能声称已由 YAML 单独保证。

**Never**

- 不修改正式 `docker-compose.yml` 的数据挂载、端口或环境变量语义。
- 不在 Demo 中放入真实 API Key、真实模型地址或正式会话密钥。
- 不承诺仅凭 Compose YAML 就实现所有宿主机级磁盘隔离；不使用会破坏 Windows Docker Desktop 兼容性的 bind mount 作为 Demo 数据卷。

## Acceptance Criteria

- Given 正式实例已使用默认 Compose project 和正式目录，When 启动 Demo，Then Demo 使用独立 project 名、独立网络和三个独立 named volume，且正式目录/卷内容不出现在 Demo 容器挂载中。
- Given Demo Compose、`nginx/demo.conf` 与独立 `demo.env` 被复制到另一目录，When 执行 `docker compose --env-file demo.env -p zhiliao-demo -f docker-compose.demo.yml config`，Then 配置成功解析且未读取正式 `.env`，仅 ingress 发布 `127.0.0.1:3210`，app/mockllm 无宿主机端口发布。
- Given Demo 已启动，When 检查应用环境和网络，Then `DEMO_MODE=1`、`LLM_BASE_URL` 指向 `http://mockllm:8787/v1`，应用与 mock LLM 只在 Demo 网络通信，且不存在访问正式服务的网络别名。
- Given Demo 容器受到持续请求或异常日志，When 检查配置并执行隔离运行验收，Then 三服务均有 CPU、内存、进程数和日志轮转上限；Nginx 对超限请求返回 413，业务卷容量由目标存储层限制并有触发证据。
- Given Demo 容器尝试访问 `169.254.169.254`、`169.254.170.2` 或常见 RFC1918 内网段，When 在目标主机执行隔离对照探测，Then 这些地址被明确阻断；模型出站依赖仅保留 mock LLM，不访问公网模型服务。
- Given 未设置独立 Demo 会话密钥，When 启动 Compose，Then 配置拒绝启动并提示设置 `DEMO_SESSION_SECRET`；设置后密钥通过环境变量注入且不写入仓库文件。
- Given 复验指定了端口且宿主机存在其他实例，When 运行验收工具，Then 端口参数实际应用；已有同名资源阻止启动，清理仅处理本次运行标识匹配的资源，检查或清理失败均返回非零。
- Given 通过 Nginx 入口进行 SSE 复验，When 登录并请求只读对话，Then 观察到首个正文、多个接收批次、done 和主动中断后健康；探针超时与 Nginx 代理空闲超时分别留证，不相互代替。

## Tasks

- [x] 更新 `docker-compose.demo.yml`：独立网络、资源/日志限制和独立密钥变量；保持固定镜像、端口声明和命名卷。
- [x] 完成 `docker-compose.demo.yml` 的实际入口及宿主机网络隔离，并在 Next.js 前实现请求体限制；Nginx 入口负责实际请求体限制，app/mockllm 使用 isolated 内网。
- [x] 增加 Compose 配置级测试或脚本，验证 project/网络/卷、端口、环境变量、限制字段与禁止的正式路径/固定密钥。
- [x] 同步 `README.md`、`README.en.md`、`docs/首次使用与故障排查.md` 中 Demo 的启动、密钥、资源和网络边界说明。
- [x] 更新 `sprint-status.yaml`，记录 Story 2.2 的实现状态与验证证据。

### 2026-09-10 收尾任务

- [x] `tests/api/demo-boundary.test.ts`：补齐请求体长度边界、正常请求和正式模式回归；测试导出写入独立临时目录。
- [x] `tests/config/demo-compose.test.ts`、`tests/config/demo-compose-cli.test.ts`：用真正的 Docker Compose 配置解析验证独立环境文件、正式 `.env` 污染与缺失密钥，不启动容器。
- [x] `tests/docs/first-use-guide.test.ts`：同步带独立环境文件及 project 名的停止命令，避免旧文档断言阻止正确配置。
- [x] `README.md`、`README.en.md`、`docs/首次使用与故障排查.md`：区分当前源码补丁和已发布 v0.6.0 镜像的能力，并记录公网部署前的剩余验收。
- [x] `docker-compose.demo.verify.yml`：准备仅发布本机 3322 端口的候选镜像验收覆盖；`.dockerignore` 与 `.gitignore` 排除独立 Demo 密钥及其副本，构建排除本地数据与协作产物。
- [x] 本规格与 `sprint-status.yaml`：记录本轮局部验证结果、关闭有证据支持的审查项；未通过运行验收前保持待审查状态。
- [x] 构建包含补丁的候选镜像并执行运行隔离验收，保留失败及已通过的资源触发证据；空 DELETE 修复后再次构建并完成容器内 HTTP 复核。
- [x] 清理本次验收容器、网络、三个数据卷及临时凭据，保留脱敏证据和本地候选镜像。
- [ ] 完成目标主机隔离、业务卷配额及固定新应用镜像发布验收。

### 本次已确认的本地收尾任务

- [x] 修复 `scripts/verify-demo-runtime.ps1`，保留 PowerShell 入口；用项目已有 Node.js 实现可测试的 HTTP、SSE 和 Docker 验收逻辑。
- [x] 更新 `docker-compose.demo.verify.yml`，使验收端口参数实际生效，为容器、网络、卷增加本次运行标识。
- [x] 在 `tests/config/` 补启动失败、检查失败、资源冲突、清理失败与流式超时的局部回归，不启动 Docker 容器。
- [x] 更新本规格、Sprint、验收记录、文档索引、README 和 `docs/adr/0026-demo-ingress-isolation.md`；保留旧失败记录和新成功记录的适用范围。
- [x] 记录受影响文件的局部测试与检查结果；保持 `in-review`，保留目标主机、业务卷配额、代理空闲超时和补丁镜像发布门槛。
- [x] 用户确认后复用现有候选，通过 PowerShell 入口执行真实隔离 HTTP/SSE 验收并清理本次资源；新 JSON 单独归档，保留两份历史证据。
- [x] A1：新增本机网络探针、专用代理上游、300 秒读写时限工具及 9 项局部回归；A1 当时未执行真实 A2。
- [x] A2：修复验收工具的同步阻塞、正向对照和代理判定问题，补齐两文件 27 项局部回归。
- [x] A2：复用现有候选完成本机网络 20 项验收并清理控制资源；保留历史失败记录。
- [x] A2：执行四个真实代理场景并留证；长心跳通过，三项时限实测约 285 秒，保留未通过结论。
- [x] A2：只读核对虚拟机与宿主机计时，回收此前保留的 Demo 资源及临时凭据，同步相关文档。
- [x] A2：用户选择第 1 项后临时切到 Hyper-V 时钟源并完成两段 20 秒对照；计时仍未达标，按门槛跳过代理复验，已恢复 `tsc`、清理探针并留证。
- [x] A2：另行获准临时测试 `acpi_pm`，两段计时仍失败，已恢复 `tsc` 并清理；随后只读比较原始/普通单调时钟和 `adjtimex` 参数，将问题收敛到内核补偿层。
- [x] A2：获准仅用 `ADJ_TICK` 临时校正 tick；读回 10000 后又被外部回写，两段计时仍失败，未进入代理复验。已恢复实际起始值 10424、保持 `tsc`，清理执行脚本并归档证据。
- [x] A2：按批准范围完成有界内核跟踪及清理；只读对照通过，捕获 chronyd 的 6 条成功调参调用，两段实际采集合计 27.106 秒，保留准备失败与对照未完成记录。
- [x] A2：管理员预检核实根命名空间中的 chronyd PID、exe、父进程及启动标识；两次预检原样存证，辅助脚本已清理。
- [x] A2：另行获准受控重启一次 WSL 并恢复 Docker/Ubuntu；根通道可连续重连，chronyd 活动配置已核实。两段正常计时通过 1%，无需暂停或校正；原四个代理场景全部复验通过，专用资源和辅助文件已清理。

### 本轮 B1/B2 接续（B2 本机范围已完成）

- [x] 核对目标：用户选择本机 Windows Docker Desktop，现阶段仅本机体验和验收；保持单 Agent。
- [x] 完善 [B1/B2 实施方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md#b1-b2-windows-local)：Desktop 普通命名卷硬配额未落实，原 XFS 方案转为条件性参考；本机验收不关闭原 Story 剩余门槛。
- [x] 在现有 PowerShell/Node 运行入口增加 `-IncludeNetwork` / `--include-network`，异步等待既有网络探针及控制资源清理，核对来源和独立报告后再清理 Demo。
- [x] 完成入口接线的 52 项局部回归、一次本机 HTTP/SSE 与 20 项网络对照，以及归属清理、保留范围核对和文档同步。

用户已确认的 B2 入口接线、局部回归及一次真实本机验收和清理均已完成，结果见下方验证记录。B1 硬配额、实际正式服务隔离、公网及发布仍独立保留；原始基线和下方冻结块保留，按已确认方案继续使用 `in-review` / `review`，仅关闭本轮覆盖的本机子任务。

## Spec Change Log

- 2026-09-16 复审修正：运行时验收新增三服务网络集合、Demo 环境变量、CPU/内存/PID、只读根、能力降权、禁止提权和日志轮转断言；网络报告改为精确校验 4 条允许路径、4 条控制正向路径及 12 条固定阻断路径。Nginx 公共代理头下沉到 server 层，覆盖导入和上传 location；构建上下文补充通用密钥/凭据文件排除，CI 强制执行真实 Compose 解析测试。局部 51 项配置/运行回归通过；目标主机隔离、业务卷硬配额、HTTPS 与 0.6.1 镜像发布仍未完成。

- 2026-09-12 B2 完成：新增可选网络阶段，统一等待、失败退出与证据关联；三文件 52 项局部回归通过。19:48–19:49 在当前 Desktop 完成一次 HTTP/SSE 与 20 项网络对照，两组临时资源均已清理；既有 7 个容器、8 个卷、7 个网络元数据和结果文档同步前的 73 个文件未变。本机网络行动项按实际覆盖范围收窄，B1、实际正式服务、公网 HTTPS 与新镜像发布仍未完成；不改变冻结块、基线及 Story/Sprint 状态。

- 2026-09-12 B2 授权：用户对本机方案回复“确认”，执行范围为统一网络选项、失败与清理回归、一次本机 HTTP/SSE 和 20 项网络对照及文档同步。单 Agent 本地实施，不启用 Skill 默认的子 Agent、自动提交或全 Story 完成流程；B1 与公网/发布门槛继续保留。

- 2026-09-12 方案阶段：维护者确认目标为 Windows Docker Desktop、先仅本机体验和验收。只读复核 Engine 28.4.0、Compose 2.39.4、ext4 数据盘及 Ubuntu 与 Windows 相同的 Engine ID；8 个既有卷为普通 local 卷。原生 Linux/XFS 配额方案不适用于当前已核实环境，当时保留硬配额缺口，补齐 B2 统一网络选项的待确认方案；随后用户单独确认实施，见上方授权与完成记录。现有未提交修改、冻结块、A2 成功/失败证据及待发布边界均保留。

- 2026-09-12 17:22–17:49：用户单独确认后执行一次 WSL 关闭与恢复，Docker Engine 仍为 28.4.0，原两个发行版恢复。根 shell 两次重连、chronyd PID 305 的身份和活动 PHC 配置均核实；两段正常计时最大偏差约 0.589% / 0.029%，直接复验原四场景。三个空闲超时为 298.662 / 298.645 / 298.541 秒，长心跳 417.985 秒正常 done，全部通过；没有暂停 chronyd 或写时钟参数。专用资源及 10 个辅助文件已清理，7 个既有容器和文档同步前的 68 个文件未变。首次停止状态误判与根 PID 汇总解析错误原样留证，复核另存；Story/Sprint 继续为 `in-review` / `review`，B1/B2、HTTPS、配额和发布仍待完成。

- 2026-09-12 16:12–16:18：用户确认管理员维护方案后执行预检，核实 chronyd 根命名空间身份。首轮辅助脚本错误地用 `exit` 结束不会自动重建的调试 shell，后续连接无输出；维护停在恢复通道前提，未暂停进程、写入时钟或复验代理。两次原始预检及归因、清理记录已归档；受控 WSL/Engine 重启另列待批准方案，原维护授权继续有效，保持 `in-review` / `review`。

- 2026-09-12 14:33–14:56：用户确认有界内核跟踪后执行。首次准备因 Python 追加打开方式失败；随后按进程名匹配对照未成功，2.097 秒内停止并清理。修正为同源原始时钟时间窗唯一匹配后，25.010 秒内捕获 chronyd（内核 PID 308）6 次成功调参；实际采集累计 27.106 秒。7 个既有容器元数据和成功采集前的 58 个文件未变，实例、事件和执行脚本已清理。只读补充记录 PHC0 及命名空间限制；后续管理员受控维护另列待确认方案，未启停服务或写时钟参数，保持 `in-review` / `review`。

- 2026-09-12 13:48–13:49：用户批准临时 tick 校正后执行；实际起始值 10424 校正为 10000 后，两段结束已被回写为 10424、10426，最大偏差仍为 3.689% / 4.206%。按门槛跳过代理复验，恢复起始 10424 并读回，时钟源保持 `tsc`。7 个既有容器元数据及维护开始前的 55 个文件未变，执行脚本留存源码后删除。后续最多 30 秒的调参调用跟踪另列待确认方案，尚未写入跟踪配置；保持 `in-review` / `review`。
- 2026-09-12 12:53–12:59：用户批准 `acpi_pm` 对照后执行，两段最大偏差仍为 4.738% / 4.710%，按门槛跳过代理复验，已恢复 `tsc`、清理并保留失败 JSON。维护期间 7 个既有容器元数据和 53 个文件未变。后续只读诊断显示原始时钟误差小于 0.005%、普通单调时钟偏快约 4.64%–4.66%，同期 tick 为 10462–10467 微秒；该次诊断未修改参数。当时补充临时校正 tick 的待确认方案，随后获批执行，结果见上条；保持 `in-review` / `review`。
- 2026-09-12 12:36–12:37：用户选择第 1 项并要求继续，已批准并执行一次 `tsc` → `hyperv_clocksource_tsc_page` 临时维护。两段计时的最大偏差仍为 4.976% 和 4.725%，未通过 1% 前提，未重跑代理长时场景；已在 `finally` 中恢复 `tsc` 并清理。维护期间 7 个既有容器元数据与 52 个保留文件未变，原始失败 JSON 保留。下一轮 `acpi_pm` 对照仅为待确认建议，未实施；状态继续为 `in-review` / `review`。
- 2026-09-12 A2 结果：本机网络 20 项通过；代理长心跳 399.369 秒正常结束，三种超时日志匹配但空闲时长约 285 秒，未达到 295–330 秒标准。时钟对照显示虚拟机计时偏快约 5%，不放宽容差或改写失败记录。A2 控制资源及此前保留的 Demo 已清理；7 个既有容器元数据和 26 个保留文件未变化。保持 `in-review` / `review`，保留三项代理时限、B1/B2、HTTPS 和发布门槛。
- 2026-09-12 A2 接续：用户已明确要求继续 A2，沿用现有候选、工作区与单 Agent 约定。调查发现此前运行已留下失败 JSON 及带标识的保留容器；本轮先修正验收工具的同步阻塞、缺少有效网络对照和代理判定缺陷，补局部回归后执行实际网络/300 秒时限场景并回收验收资源。BMAD 模板的并行审查、回退重做、自动提交及完成步骤与既有批准范围冲突，继续按项目规则单 Agent 审查、保留既有修改和原始基线；仅以实际证据关闭 A2 子项，不自动进入 B、发布或 Story 2.3。
- 2026-09-11 17:46：用户同意基于本机调查继续准备隔离与配额方案，已补 [剩余验收实施方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md)。建议先实施本机网络及 300 秒代理时限工具；三个卷的建议硬上限为 512 MiB / 1 GiB / 256 MiB，持久配额依赖具备条件的 Linux Engine 存储层。本轮未实施新工具或更改宿主机存储，未新增验收通过结论。
- 2026-09-12：完成 A1。本机网络工具、无业务代理上游、300 秒读写时限工具和两组局部回归已加入；9 项新增测试通过，新增脚本 ESLint 通过。A2 真实网络与超时验收、目标主机卷配额、HTTPS 和新镜像发布仍待用户分别确认。
- 2026-09-11 15:57：用户已确认复用候选执行本机隔离验收（含 SSE）及清理；新工具真实运行通过。关闭本机 SSE 首段正文、分批、done 和主动中断验收项，单列仍未验证的 Nginx 300 秒代理空闲超时。保留工作区修改；Story/Sprint 继续为 `in-review` / `review`，不以本机成功执行流程模板的自动完成或提交步骤。
- 2026-09-11：用户确认本地收尾计划：修复复验脚本、补局部回归和 SSE 验收入口、统一证据与规格并补 ADR。保留全部既有工作区修改和原始基线；按用户要求单 Agent 执行，不采用 BMAD 的并行审查或回退重做。已有运行证据按实际覆盖范围复用，容器运行、重构建、全量门禁和正式发布仍须分别确认。
- 2026-09-11：修正规格中的旧端口归属与“只可访问 mockllm”表述，采用已批准的 Nginx/isolated 拓扑及 ingress 互通例外；固定 v0.6.0 明确为当前发布基线，不作为补丁已发布的证据。长期决策记录于 ADR-0026；保留三业务卷、正式 Compose、已有源码和历史失败记录。
- 2026-09-10：用户确认继续收尾本 Story。原规格 `done` 与 Sprint `review`、未关闭的审查项冲突，恢复执行状态并沿用原规格及原始基线，不另建重复 Story。用户已确认保留工作区既有修改；按项目规则由单 Agent 执行。
- 2026-09-10：本机 v0.6.0 镜像标签的源码版本为 `d22ce2b2ad19d460a67d73b2ca83abda224a883a`，早于 Story 2.1/2.2。保留固定镜像约束；当前源码的局部测试不作为该镜像已有服务端防护的证据，镜像构建、部署验收及发布另行确认。
- 2026-09-10：默认 project 固定为 `zhiliao-demo`，网络名随 project 派生，避免不同验收 project 共用同名网络；移除不能拦截数字 IP 的 `extra_hosts`。原网络阻断验收标准保留，不以静态配置代替宿主机运行证据。
- 2026-09-11：按用户确认增加固定摘要 Nginx 入口；入口发布 3210 并执行 200 MiB 实际请求体限制，app/mockllm 仅加入启用 `gateway_mode_ipv4=isolated` 的 Demo 内网。
- 2026-09-10：发现独立密钥文件 `demo.env` 不在 Docker 构建排除列表，补齐密钥副本、本地数据与协作产物排除；增加本地候选镜像覆盖，不修改正式 Compose 或已发布镜像标签。
- 2026-09-10：用户已确认本地候选镜像构建、隔离 Docker 验收和本次资源清理。两次构建通过，运行验收未通过：内部网络未实际发布端口、宿主机网桥对照服务可达、超大声明不能及时返回 413。修复空 DELETE 误返回 411 后，容器内 HTTP 17 项通过、1 项失败。继续保持 `in-review` / `review`。
- 2026-09-10（历史状态）：当时拟增加固定 Nginx 入口和 isolated 内网，端口归属变更待确认；23:55 完成专用资源及临时凭据清理。该方案已于 9 月 11 日获批并实施，当前验收标准已同步。

## Code Map

- `docs/Story-2.2-剩余验收实施方案-2026-09-11.md#b1-b2-windows-local`：已确认的 Desktop/本机范围、B1 能力限制，以及已完成的 B2 接线、验收标准和结果；后续存储与公网工作仍独立保留。
- `docker-compose.demo.yml`：当前 Demo ingress/app/mockllm、3210 端口声明、三 named volume；入口与业务容器分离，业务容器不直接发布端口。
- `docker-compose.demo.verify.yml`：候选镜像、可覆盖的本机验收端口与容器/网络/卷运行标识。
- `scripts/verify-demo-runtime.ps1`、`scripts/verify-demo-runtime.mjs`：PowerShell 入口、独立配置副本、Docker 生命周期、可选 SSE/网络阶段、失败退出与脱敏证据；网络结果须与本轮来源和独立报告一致。
- `scripts/demo-http-probes.mjs`：真实 HTTP 请求头探针和 SSE 首块、分批、结束、中断及超时检查。
- `scripts/verify-demo-network.mjs`：宿主机正向对照、元数据/RFC1918 目标探针及不可达归因；不把 ECONNREFUSED 当作隔离通过。
- `scripts/verify-demo-proxy-timeouts.mjs`、`docker-compose.demo.proxy-verify.yml`、`nginx/demo-proxy.conf`、`scripts/fixtures/demo-proxy-upstream.mjs`：四种代理空闲场景、固定 300 秒配置、日志归因和脱敏证据。
- `tests/config/demo-runtime.test.ts`、`tests/config/demo-http-probes.test.ts`：Docker 命令夹具与本机 HTTP 夹具，覆盖网络异步顺序、报告缺失/不一致、检查与清理失败、证据冲突和 PowerShell 参数透传，不启动真实容器。
- `tests/config/demo-network.test.ts`、`tests/config/demo-proxy-timeouts.test.ts`：A1 工具参数、失败分类、预算和清理局部回归，不启动真实容器。
- `docs/adr/0026-demo-ingress-isolation.md`：已批准的三容器拓扑、网络例外及验收/发布边界。
- `docker-compose.yml`：正式实例配置，只读参照；不得改变正式 bind mount、3000 端口或正式环境变量。
- `Dockerfile`：镜像内置 `/data/db`、`/data/uploads`、`/data/notes` 和固定 v0.6.0 运行约定；Demo 复用，不改镜像构建。
- `src/lib/auth.ts`：启动时要求 `SESSION_SECRET` 至少 16 字符；Compose 应通过独立变量映射满足该约束。
- `src/app/api/uploads/route.ts`、`src/app/api/import/route.ts`：应用层已有 20 MB 图片、200 MB 导入限制；Compose/反向代理限制需与之对齐并在文档中区分层级。
- `docs/首次使用与故障排查.md`：已有 Docker Demo 端口、独立卷和重置说明；需同步独立密钥与资源边界。
- `README.md`、`README.en.md`：公开 Demo 启动入口；需说明 `-p zhiliao-demo`、`DEMO_SESSION_SECRET`、不读取正式配置及清理命令。
- 只读证据：Story 2.1 已固定 Demo mock LLM 和服务端 403 边界；本 Story 只处理部署隔离与宿主机资源保护。

## Verification

### 2026-09-12 B2 本机统一验收

- 19:44：`npx --no-install vitest run tests/config/demo-runtime.test.ts tests/config/demo-network.test.ts tests/docs/first-use-guide.test.ts` 三文件 52 项通过。Node.js 语法、PowerShell 语法及参数透传检查通过，保留 PowerShell 5.1 所需的 UTF-8 BOM。
- [执行前基线](../../docs/验收证据/story-2-2-b2-environment-2026-09-12T11-47-41Z.json)：Docker context 为 `desktop-linux`，Engine 28.4.0、Compose 2.39.4-desktop.1；候选与固定 Nginx 镜像、3322 端口、既有资源和 73 个保留文件已核对。
- [运行报告](../../docs/验收证据/story-2-2-runtime-b2-2026-09-12T11-48-30Z.json)：19:48:30–19:49:16 通过 PowerShell 的 `-Port 3322 -IncludeSse -IncludeNetwork` 执行一次，另以 `-EvidencePath` 固定独立报告路径，退出码 0。三服务健康，入口 `127.0.0.1:3322`，健康 200，超限请求仅发送 1 字节正文即于 2 毫秒返回 413；Nginx 语法通过。
- SSE 首个正文 84 毫秒、10 批正文、236 毫秒正常 done；主动中断后健康 200。[独立网络报告](../../docs/验收证据/story-2-2-runtime-b2-2026-09-12T11-48-30Z-network.json)记录当前同一轮 Demo 的 4 条必要互通、4 个有效正向对照及 12 条负向路径全部通过，负向均为 `ENETUNREACH`。总报告已关联网络路径及 SHA-256，并核对 project、Engine 版本、候选镜像、来源运行标识和输入哈希。
- [保留核对](../../docs/验收证据/story-2-2-b2-preservation-2026-09-12T11-50-40Z.json)：Demo 与网络控制资源均为 `removed`，既有 7 个容器、8 个卷、7 个网络元数据一致，运行前 73 个文件哈希未变。该核对发生在结果文档同步之前；没有读取或校验正式业务数据内容。
- 本轮复用现有候选和固定 Nginx，没有构建、拉取、发布、全量门禁、配额触发或 300 秒代理复验。源码/配置哈希只关联验收输入；实际正式服务、B1 业务卷硬配额、公网 HTTPS 和新固定应用镜像仍未完成，Story/Sprint 保持 `in-review` / `review`。
- 20:09 文档收尾：`tests/docs/first-use-guide.test.ts` 6 项通过；16 个本轮文件的 UTF-8/LF、相关相对链接与新增范围锚点、42 份 JSON 和 Story/Sprint YAML 解析均通过，8 项运行输入哈希及网络报告哈希一致。按用户要求完成单 Agent 自审，未发现本轮新增阻断项；实施前 73 个文件中仅批准范围内的 12 个发生变化，其余 61 个、原始基线及冻结块保持原样。`git diff --check` 通过，完整门禁未运行。

### 2026-09-12 B1/B2 目标环境与方案核对

- [本机预检](../../docs/验收证据/story-2-2-b1-b2-preflight-2026-09-12T11-15-29Z.json)记录当前 Engine、Compose、ext4 挂载和候选镜像；其中 Ubuntu 查询因 WSL 参数解析失真未成功，不作为完整通过证据。
- [目标确认后复核](../../docs/验收证据/story-2-2-b1-b2-target-2026-09-12T11-18-44Z.json)改用 `wsl --exec`，确认两侧客户端指向同一 Engine，Ubuntu 未安装 XFS 配额工具；8 个既有卷均为 `local` 且无额外驱动选项。当前结论是“未落实并验证 Demo 独立硬配额”，不据此推断底层不存在任何其他限额。
- 用户在此规划阶段已选择本机 Windows Docker Desktop、先仅本机体验和验收；B2 脚本修改、局部回归及一次真实本机验收当时尚待确认，随后单独获批并完成，见上节。硬配额、实际正式网络、公网 HTTPS 和新固定镜像仍未完成。
- 规划阶段文档局部回归：19:29 执行 `tests/docs/first-use-guide.test.ts`，6 项通过；该时点未执行运行工具回归、容器验收或全量门禁。

### 2026-09-12 重启后 A2 代理复验

- [首次恢复尝试](../../docs/验收证据/story-2-2-wsl-recovery-2026-09-12T09-05-03-097Z.json)保留失败：Docker 正常停止后，助手脚本误判关闭后的状态查询而提前恢复，没有执行 WSL shutdown。[修正后恢复](../../docs/验收证据/story-2-2-wsl-recovery-2026-09-12T09-22-02-992Z.json)为 `restored`，实际一次关闭 WSL 后恢复原两个发行版和 Engine，7 个容器及 64 个文件未变。
- [根通道原始预检](../../docs/验收证据/story-2-2-root-channel-2026-09-12T09-31-24-902Z.json)两次命令均完成，仅 PID 汇总正则遗漏提示符前缀而返回失败；[只读复核](../../docs/验收证据/story-2-2-root-channel-audit-2026-09-12T09-33-17-334Z.json)确认同一根 shell PID 1895 可连续重连，当前 chronyd PID 305、版本 4.1、活动参考为 Hyper-V `/dev/ptp0`。原 JSON 不覆盖，未向根 shell 发送 exit。
- [两段正常计时](../../docs/验收证据/story-2-2-normal-clock-2026-09-12T09-35-59-307Z.json)均满足 1% 门槛；原始与普通单调时钟同时比较，端点选择最小 RTT 并计算误差上下界。本轮无需暂停 chronyd、校正 tick 或启动恢复看门狗。
- [新代理证据](../../docs/验收证据/story-2-2-proxy-timeouts-2026-09-12T09-42-14-119Z.json)为 `passed`：静默响应 298.662 秒、SSE 空闲 298.645 秒、发送阻塞 298.541 秒，均匹配日志；长心跳 417.985 秒、7 次事件、正常 done。原 300 秒配置、295–330 秒容差、450 秒预算和 32 MiB 上限未变。
- [运行汇总](../../docs/验收证据/story-2-2-post-restart-a2-2026-09-12T09-42-13-440Z.json)与[清理记录](../../docs/验收证据/story-2-2-post-restart-cleanup-2026-09-12-a2.json)确认同一新启动周期内只运行一次四场景，14 段只读监测均在 1% 内；2 个容器、1 个网络及临时配置已清理，10 个辅助文件已在源码存证后删除，7 个既有容器和文档同步前的 68 个文件未变。
- 网络 20 项保留为重启前环境的成功证据，不推断重启后全部路径或最终主机已通过；本次成功也不证明长期计时已修复。B1/B2、业务卷配额、HTTPS、完整门禁和补丁镜像发布保持待完成，Story/Sprint 不改为 done。

- 文档收尾：18:04 局部回归 6 项通过；9 份文件 UTF-8/LF、288 个相对链接、12 处相关锚点引用、36 份 JSON 解析及存证源码哈希均通过。其余 59 个保留文件、原始基线和冻结块未变；`git diff --check` 通过，完整门禁未运行。

### 2026-09-12 chronyd 管理员预检

- [维护记录](../../docs/验收证据/story-2-2-chronyd-maintenance-2026-09-12T08-47-30-618Z.json)为 `preflight_failed`。首次管理员连接取得内核 PID 308、`/usr/sbin/chronyd`、PPid 1、`start_ticks=49` 和根 PID 命名空间；活动配置与目标二进制版本仍未核实。
- 首轮调试输出含少量 NUL，被辅助脚本错误地按 UTF-16LE 解码；原始 JSON 原样保留，记录中另存恢复的可读文本及解码限制。脚本末尾 `exit` 结束了根调试 shell，随后一次 20 秒连接无输出；已结合本机 WSL 2.5.10 对应源码核对退出行为。
- 控制与恢复通道前提未通过，`SIGSTOP/SIGCONT`、tick 写入、两段计时、恢复看门狗及代理复验全部未运行。没有重启 WSL、Engine 或服务；时钟源仍为 `tsc`。
- 两份预检 JSON 和执行源码已归档，4 个临时辅助文件已核对哈希后删除。51 个保留文件哈希一致；7 个既有容器的 ID、名称、停止状态及退出码与历史记录一致，其他元数据仅作为当前快照，不扩大比较结论。
- 该时点的[受控重启方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md#a2-wsl-channel-recovery)随后单独获批并执行，结果见上节；没有对同一 chronyd 临时维护范围重复请求授权。该次初始预检本身未关闭任何代理门槛。
- 16:53 文档回归 6 项通过；9 份文件 UTF-8/LF、255 个相对链接、5 处本轮锚点引用、28 份 JSON 解析、8 份 JavaScript 与 3 份 Python 存证源码哈希均通过，51 个保留文件及冻结块未变；`git diff --check` 通过，未重跑容器验收或全量门禁。

### 2026-09-12 有界内核跟踪

- [成功采集 JSON](../../docs/验收证据/story-2-2-tick-trace-2026-09-12T06-55-37-663Z.json)为 `completed` / `captured`：只读对照模式位 0、入口 tick=0、返回 0，事件位于同源原始时钟调用窗中；内核 PID 42098 对应 Ubuntu PID 5563，实际名称为 `<...>`。
- 6 条目标调用均来自内核 PID 308、名称 chronyd，模式位 `0x4002 = ADJ_TICK | ADJ_FREQUENCY`；tick 五次为 10324、一次为 10322，全部配对返回 0。本轮没有写时钟参数或执行代理复验。
- 14:33 准备失败时未启用事件；14:45 对照未完成时约 2.097 秒内停止；随后成功采集 25.010 秒，累计 27.106 秒。三份 JSON 保留各自历史状态，见[验收记录](../../docs/Demo部署隔离验收-2026-09-10.md)。
- 成功采集观察到 13 组入口/返回，缓冲统计未报丢失；未保存探针自身总漏记计数，结论限定于已捕获调用。两个事件、私有实例和执行脚本已清理；全局跟踪状态、7 个既有容器元数据及维护前的 58 个文件保持原样。
- [只读归因补充](../../docs/验收证据/story-2-2-chrony-attribution-2026-09-12T07-45-32-076Z.json)记录 PHC0、约 3.3% 频率补偿及 PID 命名空间限制。该时点 PID 308 的 exe/活动配置尚未核实，管理员调试 shell 尚未启动；默认系统配置不作为目标配置依据。受控暂停与复验[方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md#a2-chronyd-maintenance)随后获批，预检结果见上节，三个代理时限继续保留。
- 16:03–16:05 文档收尾：`tests/docs/first-use-guide.test.ts` 的 6 项全部通过，无跳过；8 份 Markdown 的 246 个相对链接及两个新增锚点、9 份文档/状态文件的 UTF-8/LF、25 份 JSON 解析、6 份维护源码和 3 份 Python 源码哈希均通过。排除本次文档/状态同步，其余 49 个保留文件哈希一致；成功跟踪 JSON、冻结块和原始基线未变。`git diff --check` 通过，未重跑容器验收或全量门禁。

### 2026-09-12 tick 临时校正与外部回写

- [tick 维护 JSON](../../docs/验收证据/story-2-2-tick-maintenance-2026-09-12T05-48-48-326Z.json)为 `failed`：仅使用 `ADJ_TICK (0x4000)` 将实际起始值 10424 临时改为 10000，返回成功且读回一致；第 1 段结束为 10424、第 2 段结束为 10426，证明一次校正随后被外部调整覆盖。
- 两段 20 秒对照的最大偏差仍为 3.689% / 4.206%，原始时钟接近宿主机；未通过 1% 前提，`proxy.status=not_run`，没有循环覆盖参数或修改原有代理配置、容差与预算。
- `finally` 已用同一模式位恢复实际起始值 10424 并读回，时钟源始终为 `tsc`。本轮共两次写入，分别校正和恢复；其他采样为 `modes=0`。外部 `freq` 变化没有被主动修改或回写，恢复结果不保证参数此后不再变化。
- 使用 Ubuntu 已有 Python，无新增容器、网络或卷；探针已退出，执行脚本按哈希核对后删除，完整源码存于 JSON。维护期间 7 个既有容器元数据及 55 个文件未变，之后才同步文档。
- 该时点尚未定位调参来源，仅准备了私有跟踪方案；随后获批执行，结果见上节。没有仅凭时间服务运行状态指定写入者；三个代理时限继续保留。
- 14:12 文档同步后，仅重跑 `tests/docs/first-use-guide.test.ts`，6 项通过、无跳过。8 份 Markdown 的 227 个相对链接、9 份文档/状态文件的 UTF-8/LF、21 份 JSON 解析及 3 份维护源码哈希均通过；除本次文档/状态同步外，46 个保留文件哈希与维护前一致，最新证据、冻结块和原始基线未变。`git diff --check` 通过，未重复网络/代理运行或全量门禁。

### 2026-09-12 acpi_pm 对照与内核补偿诊断

- [ACPI 维护 JSON](../../docs/验收证据/story-2-2-clock-maintenance-2026-09-12T04-53-42-385Z.json)为 `failed`、退出码 1：时钟源切换成功，两段 20 秒的最大偏差仍为 4.738% / 4.710%。已恢复 `tsc` 并清理容器和执行脚本，维护源码归档；7 个既有容器元数据及维护开始前的 53 个文件未变。
- 代理四场景没有重新运行，`proxy.status=not_run`。原 300 秒配置、295–330 秒容差、450 秒预算及 32 MiB 上限均保留。
- [只读诊断 JSON](../../docs/验收证据/story-2-2-clock-diagnostics-2026-09-12T04-59-16-594Z.json)比较两段各约 10 秒的 Python 系统时钟：原始时钟与宿主机最大误差 0.003710% / 0.004827%，普通单调时钟分别偏快 4.658%–4.665% / 4.633%–4.642%；`adjtimex(modes=0)` 观察到 `tick=10462–10467` 微秒，本机 100 Hz 对应基准 10000 微秒。
- 证据支持内核补偿这一方向，但调参组件尚未确定。该次只读诊断没有修改 `tick`、`freq`、时间服务或系统时间，也不替代 A2 的前置验收与代理时限。当时准备的 `ADJ_TICK` 临时校正方案随后获批执行，结果见上节。

### 2026-09-12 临时时钟维护

- [维护证据](../../docs/验收证据/story-2-2-clock-maintenance-2026-09-12T04-36-26-291Z.json)为 `failed`、退出码 1：`hyperv_clocksource_tsc_page` 切换和读回成功，但两段对照的相对偏差范围仍为 +4.958% 至 +4.976%、+4.707% 至 +4.725%，未达到 1% 前提。使用持续连接采样并计算往返延迟上下界，没有将命令启动开销误当成计时差。
- 按已批准流程跳过四场景长时复验；300 秒配置、295–330 秒容差、450 秒预算和 32 MiB 上限均未修改，三个代理时限继续待验。
- 无网络、无挂载的临时计时容器已按归属清理，`finally` 恢复并读回 `tsc`；两个 WSL 发行版之后分别复核也均为 `tsc`。7 个既有容器元数据及维护开始前记录的 52 个文件未变，之后才同步文档。
- 没有构建、拉取、全量测试、系统重启或发布；当时将后续 `acpi_pm` 临时对照补入[实施方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md)等待确认，随后获批执行的结果见上节。现有代码局部检查按输入未变继续复用。
- 12:46：同步文档后，仅重跑 `tests/docs/first-use-guide.test.ts`，6 项通过、无跳过。执行过的临时维护脚本已按哈希核对后删除，完整源码保存在维护 JSON 中。

### 2026-09-12 A2 本机网络与代理时限

- 局部回归先复现 3 项判定缺陷，修复后 `demo-network.test.ts` 13 项与 `demo-proxy-timeouts.test.ts` 14 项通过。覆盖异步宿主机对照、真实 TCP 拒绝、私网子网冲突、正向对照缺失、四请求并发、SSE 异常结束、心跳 done、发送预算、部分启动失败与归属清理。相关 ESLint 和严格局部 TypeScript 检查通过，未运行全量测试或构建。
- [本机网络证据](../../docs/验收证据/story-2-2-network-2026-09-12T03-38-29-471Z.json)：4 条必要互通、4 个有效正向对照、12 条负向路径全部通过；负向为 `ENETUNREACH` 且无目标路由。3 个私网控制容器、3 个网络和本机临时服务已清理。
- [代理证据](../../docs/验收证据/story-2-2-proxy-timeouts-2026-09-12T03-25-47-619Z.json)：长心跳持续 399.369 秒、7 次事件并正常 done；静默响应、SSE 中途静默和上游停止读取请求体均匹配逐请求超时日志，但宿主机空闲计时为 285.203 / 285.196 / 285.047 秒，三项仍失败。专用 2 个容器、1 个网络及临时配置已清理。
- [时钟对照](../../docs/验收证据/story-2-2-clock-2026-09-12T03-44-50-581Z.json)：宿主机累计单调计时约 20.654 秒，虚拟机约 21.757 秒，当前 clocksource 为 `tsc`。仅证明计时偏差，未修改主机设置，也未把配置或日志成功等同于时限达标。
- [补充清理](../../docs/验收证据/story-2-2-cleanup-2026-09-12-a2.json)：此前保留的 A2 Demo 经 project、运行标识与原始清单核对后，3 个容器、2 个网络、3 个卷及临时凭据目录已删除；原始 `retained` JSON 保持原样。
- [保留范围核对](../../docs/验收证据/story-2-2-preservation-2026-09-12-a2.json)：7 个既有容器的状态、退出码、镜像与挂载/网络元数据不变，26 个保留文件 SHA-256 一致。运行后只补 JSDoc 类型声明；去除新增声明后可恢复报告中的输入哈希，未重复运行重验证。
- 全部剩余门槛关闭前保持 `in-review` / `review`；本轮按既有批准执行单 Agent 审查，不自动提交、标完成或进入 Story 2.3。
- 12:08：代理回归 14 项和文档回归 6 项通过，复用网络 13 项，本轮三文件合计 33 项。当时补充[只读时钟环境](../../docs/验收证据/story-2-2-clock-environment-2026-09-12-a2.json)及[临时维护方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md)，该时点未执行内核时钟源变更；随后获批执行的结果见上节。

### 2026-09-11 本地收尾

- 14:28：复现配置测试中无关 `client` 字面量断言失败；移除手写通过结果断言，改为工具行为回归。
- 14:47：四个 `tests/config/demo-*.test.ts` 文件 35 项通过，无跳过；Docker 流程使用命令夹具，HTTP/SSE 使用本机临时 HTTP 夹具，真实 Compose 仅执行配置解析。
- 15:06：当前 `tests/api/demo-boundary.test.ts` 与 `tests/docs/first-use-guide.test.ts` 共 24 项通过，无跳过。与上述结果合计为六文件 59 项局部证据，来自两次按范围执行，不代表全量测试。
- 15:17：复现并修复 Windows PowerShell 5.1 读取无 BOM 中文脚本导致的解析失败；入口保留 UTF-8 BOM、LF。新增实际 PowerShell 入口回归后，仅重跑受影响的运行验收器测试，16 项通过；本机六文件按各自最新结果合计 60 项，无跳过。
- 两个 Node.js 验收脚本与四个配置测试文件的局部 ESLint 通过；新增两个测试文件及脚本依赖的局部 TypeScript 检查通过。
- Windows 入口回归新增后，受影响测试文件的局部 lint/类型检查再次通过；PowerShell 按文件解析通过。九个脚本/配置/测试/ADR 文件满足 UTF-8、LF，七份相关文档的本地链接均存在；`git diff --check` 通过。
- 对 11 个保留文件核对 SHA-256 均未变化，包含既有业务源码、API 测试、Story 2.1、两份历史运行 JSON、主 Demo/正式 Compose、Dockerfile 和 Nginx 配置。本轮修改集中于已批准的复验工具、候选覆盖、局部测试和相关文档。
- 复用 [9 月 11 日此前运行证据](../../docs/验收证据/story-2-2-runtime-2026-09-11.json)：候选镜像标识与本机一致，已有入口 200、超限 413、三服务健康、Nginx 语法及部分网络阻断记录。该历史记录不包含 SSE 或目标主机完整隔离；新增本机 SSE 证据见下一节。

### 2026-09-11 本机 HTTP/SSE 运行验收

- 15:56–15:57：用户确认后执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-demo-runtime.ps1 -IncludeSse`，退出码 0；[新运行 JSON](../../docs/验收证据/story-2-2-runtime-2026-09-11T07-56-56-279Z-ccefbb73.json) 的 `status=passed`、`cleanup.status=removed`。
- 复用现有候选 `sha256:46f9241b6d2e539ce3a94324c356cf4336f8cf17e0cf59e5b5d920bf9b53769e`；三服务健康、实际入口 `127.0.0.1:3322`、健康接口 200、Nginx 语法通过。超限声明仅发送 1 字节后，9 毫秒内返回 413。
- 经同一 Nginx 入口登录并进行只读对话：首段正文 95 毫秒，10 个正文事件分 10 批接收，254 毫秒正常结束且 `done=true`；主动中断后健康接口为 200。
- 清理前核对所有资源的 project 和运行标识；3 个容器、2 个网络、3 个卷及临时配置均已清理，随后按名称和 project 标签查询无残留。7 个既有容器的 ID、退出码和停止状态不变。
- 报告中的六个配置/脚本哈希与当前文件一致，两份历史 JSON 保持原样。哈希只关联本次输入，不证明候选包含当前全部工作区源码；目标环境、业务卷容量、300 秒代理空闲超时与正式发布继续保留门槛。本次没有构建或运行全量测试。
- 16:05：运行结果同步到文档后，仅重跑受影响的 `tests/docs/first-use-guide.test.ts`，6 项通过、无跳过；其余 54 项按各文件最新结果复用，合计仍为 60 项。代码和运行配置未改动。

### 2026-09-11 本机环境自查

- 16:37：自行检查系统、Docker、既有容器部署标签、卷声明、连接配置及 GitHub Issue #5，结果见 [只读环境记录](../../docs/验收证据/story-2-2-environment-2026-09-11T08-37-01Z.json)。本机为 Windows 11 `10.0.26200`、WSL2 Docker Desktop，Engine `28.4.0`、Compose `2.39.4-desktop.1`。
- 本机 `zhiliao` 由当前仓库主 Compose 创建，挂载正式 `data/db` 和 `data/uploads`；它与 RC、历史冒烟实例均处于停止状态。后续按共用 Engine 的条件准备隔离方案，不启动或修改这些实例。
- Demo 三个 named volume 未配置容量上限，本机已无 Demo 验收卷。所查部署计划、Issue 和连接配置未指定公网主机；这属于部署选择与方案工作，本机版本及共机现状无需再让用户补查。此次为只读调查，不新增运行验收结论，保持 `in-review`。

### 历史验证

剩余场景、拟改文件、容量建议与验收标准另见 [实施方案](../../docs/Story-2.2-剩余验收实施方案-2026-09-11.md)，不以方案完成关闭以下历史记录中保留的目标环境门槛。

- 2026-09-10 22:26：`npm test -- tests/api/demo-boundary.test.ts tests/config/demo-compose.test.ts tests/config/demo-compose-cli.test.ts tests/docs/first-use-guide.test.ts --maxWorkers=1 --no-file-parallelism`，四个文件 29 项通过，无跳过。
- 2026-09-10 22:34：新增候选镜像覆盖及构建排除后，只重跑两个受影响的配置测试文件，7 项通过，无跳过；当时未改动的 API 17 项和文档 6 项沿用前次证据。
- 2026-09-10：空 DELETE 回归先复现失败，修复后 API 18 项及相关 ESLint 通过；截至该轮记录，相关局部用例共 31 项，不代表后来变更文件的当前结果。
- `npx --no-install eslint` 对本轮涉及的五个 TypeScript 文件通过，配置测试修改后再次局部检查通过。
- Compose CLI 测试使用临时假 `.env` 与独立环境文件调用 `config --format json`，验证污染对照、缺失密钥、真实卷名前缀、网络和候选端口覆盖；不会读取真实配置或启动容器。
- 两次候选镜像构建通过，包含构建内 ESLint 和 TypeScript 检查；最新本机镜像 ID 为 `sha256:46f9241b6d2e539ce3a94324c356cf4336f8cf17e0cf59e5b5d920bf9b53769e`。
- 2026-09-10 23:48：最新候选容器内 HTTP 18 项中 17 项通过，含空 DELETE 在内的 12 个受限入口均返回 403；超大声明仅发送 1 字节后等待 5 秒，未收到 413，保留失败。
- 网络对照确认内部网桥的端口发布及宿主机访问隔离未达标。app/mock 对两个云元数据地址及三个私网对照地址的 TCP 探测为 `ENETUNREACH`；CPU/内存/PID cgroup、只读根文件系统和 mock tmpfs 写满限制有通过证据，不能代替目标主机正式网络及业务卷配额验收。
- 2026-09-10 23:55：本轮专用容器、网络、三个数据卷及临时凭据已清理；既有冒烟实例状态不变。未执行全量测试或公网发布。完整证据及下一步方案见 [Demo 部署隔离验收](../../docs/Demo部署隔离验收-2026-09-10.md) 和 [脱敏运行结果](../../docs/验收证据/story-2-2-runtime-2026-09-10.json)。
- 2026-09-11 00:04：运行发现同步到入口文档后，文档局部测试 6 项通过；`git diff --check` 通过。

## Implementation Notes

- `src/middleware.ts` 在 Demo 模式对分块且没有 `Content-Length` 的请求返回 411，对非法声明返回 400，对超过 200 MiB 的声明返回 413；没有正文也会校验已提供的长度。无长度/分块标记的空 DELETE 正常进入权限校验。运行实测证明中间件无法在未收完正文时提前拒绝超大声明，仍需入口按实际接收字节数限制。
- `internal: true` 不能单独满足本 Story；当前由入口网络发布端口，Demo 内网增加 `gateway_mode_ipv4=isolated`，需在目标 Docker Engine 复跑网络验收。

### Review Findings

- [x] [Review][Reliability] Demo 服务依赖关系仅等待容器启动，可能在 app/mockllm 尚未监听时进入失败重启；已为 mockllm 增加探针健康检查，并让 app、ingress 使用 `service_healthy` 条件启动。
- [x] [Review][Security] Nginx 使用 `$proxy_add_x_forwarded_for` 时客户端可伪造首个 `X-Forwarded-For` 地址，绕过登录限流；已改为由入口使用 `$remote_addr` 重建该请求头。
- [x] [Review][Verification] 本机候选的 Nginx 语法、入口 200 和超限 413 已有 9 月 11 日记录，15:57 新增真实 SSE 通过证据；目标环境与代理空闲超时的未覆盖部分集中保留在下方行动项。

- [x] [Review][Patch] 请求体限制仅检查 `Content-Length`，分块请求可绕过：工作区源码现对未知长度返回 411，并补齐分块、非法、超限、空正文及正常路径回归。源码复核关闭；实际字节限制与镜像运行验收单独保留。
- [x] [Review][Patch] Compose 自动读取正式 `.env`：启动和停止命令均显式使用独立 `demo.env`；真实 CLI 测试证明假正式 `.env` 不参与插值，独立文件缺密钥时不会从正式文件补读。
- [x] [Review][Patch] 测试缺少请求体和配置污染场景：新增 API 边界及真实 Compose 对照测试，并修复文档测试中的旧命令；相应用例通过，证据见上文。
- [x] [Review][Patch] 真实空 DELETE 被 Next.js 包装为空流后误返回 411：依据 HTTP/1 长度/分块标记判断，API 回归及最新候选 HTTP 复核均通过，两条入口均返回预期 403。
- [x] [Review][Patch] 复验工具缺少失败断言、就绪等待、实际端口应用与归属清理；已补齐并通过 Docker 命令夹具及 HTTP/SSE 局部回归，15:57 真实成功路径及清理也已通过。

## Suggested Review Order

**部署边界**

- 先看 Demo 网络与密钥入口
  [`docker-compose.demo.yml:10`](../../docker-compose.demo.yml#L10)

- 检查数据卷与只读文件系统
  [`docker-compose.demo.yml:26`](../../docker-compose.demo.yml#L26)

- 检查资源与日志上限
  [`docker-compose.demo.yml:31`](../../docker-compose.demo.yml#L31)

**请求保护**

- 检查应用层请求体拒绝
  [`middleware.ts:8`](../../src/middleware.ts#L8)

**验证与文档**

- 查看隔离配置静态断言
  [`demo-compose.test.ts:8`](../../tests/config/demo-compose.test.ts#L8)

- 查看公开启动与配额说明
  [`README.md:49`](../../README.md#L49)

<frozen-after-approval>
用户已确认：在保留现有未提交修改的前提下继续实施 Story 2.2。
</frozen-after-approval>
### 2026-09-11 复审新增行动项

- [x] [Review][Verification] 最新三容器运行记录已归档；复验工具的非零失败退出、端口与运行标识、配置快照、健康等待、可选 SSE 及归属清理已有局部行为回归。15:57 新版工具的真实容器验收及清理通过。
- [ ] [Review][Deployment] B2 已在重启后的当前 Desktop 验证本机 20 项网络路径，覆盖必要互通、两个元数据地址、RFC1918 对照地址及宿主机对照；独立对照不替代实际正式服务。实际正式网络隔离、其他目标 Engine 及公网 HTTPS/入口信任链仍待专项验收，本项仅收窄未覆盖范围，不整体关闭。
- [ ] [Review][Deployment] `demo_db`、`demo_uploads`、`demo_notes` named volume 未设置磁盘容量配额；需由宿主机或 Docker 存储层明确配置后，才能关闭资源隔离验收。
- [ ] [Review][Deployment] Demo 发布配置仍引用不含本轮服务端补丁的 `ghcr.io/b-tech-hub/zhiliao:0.6.0`；需发布并固定包含 Story 2.1/2.2 补丁的新应用镜像 digest，再复核正式启动路径。
- [x] [Review][Verification] 15:57 通过 Nginx 入口完成真实 SSE 首段正文、分批、done 和主动中断验收，取消后健康接口 200；新 JSON 单独留证。
- [x] [Review][Verification] A2 重启后专用长心跳持续 417.985 秒、7 次事件并正常 done，无超时日志，证明持续有数据的连接可以超过 300 秒；旧 399.369 秒成功记录保留。
- [x] [Review][Verification] A2 三个 300 秒代理时限在受控重启后的正常环境复验通过：空闲时长 298.662 / 298.645 / 298.541 秒，逐请求读取/发送超时日志匹配。两段计时均满足 1%，本轮未暂停 chronyd 或写时钟参数；295–330 秒容差、450 秒预算、32 MiB 上限均保持原样。旧约 285 秒失败与各次诊断记录保留，不据此宣称长期计时已修复。
- [x] [Review][Decision] app 与 ingress 共用 `demo_net`，app 可访问 `ingress:8080`。这是 Nginx 反向代理访问 app 的必要条件，已在文档中明确为架构例外；入口仍只固定转发到 app，不提供任意目标代理。
- [x] [Review][Decision] 主 Demo 端口默认绑定所有宿主机接口（`3210:8080`），存在局域网误暴露风险；已改为 `127.0.0.1:3210:8080`，并同步 README 与首次使用文档。

## Suggested Review Order

本次 A2 接续的审查入口；Story 仍保持待审查。

- 核对验收来源、有效对照与本次资源边界
  [verify-demo-network.mjs:180](../../scripts/verify-demo-network.mjs#L180)

- 确认超时、拒绝连接和无路由的判定差异
  [verify-demo-network.mjs:14](../../scripts/verify-demo-network.mjs#L14)

- 检查逐请求日志、SSE 结束方式与时限标准
  [verify-demo-proxy-timeouts.mjs:25](../../scripts/verify-demo-proxy-timeouts.mjs#L25)

- 核对异步调用与清理前的资源归属
  [demo-verification-utils.mjs:18](../../scripts/demo-verification-utils.mjs#L18)

- 查看历史网络对照与重启后代理复验的实际证据
  [Demo部署隔离验收-2026-09-10.md:6](../../docs/Demo部署隔离验收-2026-09-10.md#L6)

- 复核回归覆盖与失败退出
  [demo-network.test.ts:1](../../tests/config/demo-network.test.ts#L1)

- 复核代理并发、心跳与清理行为
  [demo-proxy-timeouts.test.ts:1](../../tests/config/demo-proxy-timeouts.test.ts#L1)

### Review Findings (本轮 CR：服务端安全边界)

- [x] [Review][Patch] Demo 请求体限制只检查声明的 `Content-Length`，无长度/错误分帧或实际正文超限时仍可能绕过 200 MiB 上限；已拒绝不明确的 HTTP 分帧，并由 Nginx 入口对实际请求体执行 200 MiB 上限。[`src/middleware.ts:8-27`](../../src/middleware.ts#L8)
- [x] [Review][Patch] `Content-Length` 与 `Transfer-Encoding` 同时出现时未拒绝歧义分帧；现已返回 400，避免 chunked 请求超过声明长度或形成请求走私边界。[`src/middleware.ts:8-13`](../../src/middleware.ts#L8)
- [x] [Review][Patch] 请求体检查先于高风险路由的 Demo 403 守卫，畸形或超限请求可能返回 400/411/413 而不是统一 403；已补充分帧边界回归，明确高风险路由仍由路由级 Demo 守卫拒绝。[`src/middleware.ts:26-33`](../../src/middleware.ts#L26)
- [x] [Review][Patch] 高风险 API 测试只断言 403，没有验证合法输入被拒绝前不产生数据库、文件、队列或外部调用副作用；已增加备份、配置删除的副作用前置断言。[`tests/api/demo-boundary.test.ts:136-185`](../../tests/api/demo-boundary.test.ts#L136)
- [x] [Review][Patch] 设置页内部 mock 地址的防泄漏改动没有页面级回归测试；已抽取客户端接入点映射并增加 Demo/正式模式回归。[`src/app/(app)/settings/page.tsx:7-35`](../../src/app/(app)/settings/page.tsx#L7)
- [x] [Review][Defer] 基线已有的 `settings/features`、`settings/corrections`、`review`、`suggestions/generate`、`trash/purge` 及笔记删除路由未统一 Demo 守卫；这些问题未由本轮 Story 2.2 改动引入，延后到 Demo 能力边界专项复核。[`src/app/api/settings/features/route.ts:16-31`](../../src/app/api/settings/features/route.ts#L16)

审查备注：本轮目标按开源交付与免费自托管安全边界判定，不以收费、营收或商业转化作为验收条件。验收审计层本轮超时，未据此推断通过。

### Review Findings (本轮 CR：Compose/Nginx 部署配置)

- [ ] [Review][Patch] Demo 的 app 与 mockllm 仍使用可变的 `ghcr.io/b-tech-hub/zhiliao:0.6.0` tag，无法保证源码补丁与运行镜像一致；应在发布前固定包含补丁的新镜像 digest，并在启动/证据中校验。[`docker-compose.demo.yml:45,85`](../../docker-compose.demo.yml#L45)
- [ ] [Review][Patch] Demo 三个命名业务卷没有容量或 inode 配额；合法上传、SQLite WAL 和 Markdown 导出可耗尽 Docker/宿主存储并影响同机服务；应补充宿主机/存储层配额和可执行的超限验收。[`docker-compose.demo.yml:110-113`](../../docker-compose.demo.yml#L110)
- [ ] [Review][Patch] `ingress_net` 未声明 `internal` 或其他出站限制，入口容器被攻破后仍可能外传 Demo 数据；应明确入口网络的最小出站策略并加入运行时验证。[`docker-compose.demo.yml:121-122`](../../docker-compose.demo.yml#L121)
- [ ] [Review][Patch] app/mockllm 未在 Compose 中强制非 root、丢弃 Linux capabilities 和 `no-new-privileges`，安全性依赖镜像内部 `USER`；应在编排层固定运行身份与权限边界。[`docker-compose.demo.yml:44-108`](../../docker-compose.demo.yml#L44)
- [ ] [Review][Patch] Nginx 对所有路径关闭缓冲并允许 200 MiB/300 秒请求，但没有连接数、请求速率或按路径限制；并发慢请求可耗尽入口连接和 app 资源。[`nginx/demo.conf:17-31`](../../nginx/demo.conf#L17)
- [ ] [Review][Patch] 构建上下文未排除 `.npmrc`、证书私钥和云凭据等常见秘密；`build: .` 可能把宿主敏感文件送入 builder/cache；应扩展 `.dockerignore` 或改用最小显式上下文。[`.dockerignore:8-31`](../../.dockerignore#L8)
- [ ] [Review][Patch] README 的 Demo 启动命令只有 Unix `printf`/`openssl`，当前维护目标 Windows Docker Desktop 缺少等价 PowerShell 路径，用户可能退回旧命令并误读 `.env`。[`README.md:48-55`](../../README.md#L48)
- [ ] [Review][Patch] Compose CLI 真实解析测试在 Docker 不可用时整体 `skip`，静态测试无法证明环境文件、网络插值和挂载可启动；应将发布/候选验证设为不可跳过的外部门禁，并保留实际 `docker compose config` 结果。[`tests/config/demo-compose-cli.test.ts:8-14`](../../tests/config/demo-compose-cli.test.ts#L8)
- [ ] [Review][Patch] 网络隔离和 Nginx 代理时限测试主要使用 Docker/request 夹具或合成上游，没有覆盖正式 Demo Compose 经真实 ingress 的运行时网络、SSE 和请求体行为；应保留单元夹具并增加目标 Engine 最小实测。[`tests/config/demo-network.test.ts:13-66`](../../tests/config/demo-network.test.ts#L13)
- [ ] [Review][Decision] 端口冲突、`DEMO_SESSION_SECRET` 最小长度、入口出网策略和卷配额的具体实现依赖维护者选择目标环境与资源预算；当前规格只保留“必须限制并验证”，未指定统一跨平台实现。[`docker-compose.demo.yml:14-15`](../../docker-compose.demo.yml#L14)

审查备注：本组同样只按开源发布、免费自托管和 Demo 安全隔离判定；未将收费、营收或商业转化列为问题。

## Suggested Review Order

本轮 B2 本机范围已完成；按入口、证据与回归顺序审查。

**入口与结果判定**

- 先核对 HTTP/SSE、网络阶段与 Demo 清理顺序
  [verify-demo-runtime.mjs:215](../../scripts/verify-demo-runtime.mjs#L215)

- 核对完整网络结果、来源匹配与独立证据哈希
  [verify-demo-runtime.mjs:76](../../scripts/verify-demo-runtime.mjs#L76)

**实际证据与入口兼容**

- 查看本机覆盖、资源保留核对与未完成门槛
  [Demo部署隔离验收-2026-09-10.md:47](../../docs/Demo部署隔离验收-2026-09-10.md#L47)

- 核对 PowerShell 参数透传及 Node 退出码
  [verify-demo-runtime.ps1:31](../../scripts/verify-demo-runtime.ps1#L31)

- 复核异步等待、报告异常、失败清理与参数回归
  [demo-runtime.test.ts:219](../../tests/config/demo-runtime.test.ts#L219)

### Review Findings (2026-09-16 复审)

- [x] [Review][Patch] 运行时验收原先只检查资源名称和端口，未阻止网络集合、环境变量或资源/安全/日志限制被削弱；现已在 `validateConfig` 中精确断言三服务边界和限制字段，并补充夹具回归。[`verify-demo-runtime.mjs:41`](../../scripts/verify-demo-runtime.mjs#L41)
- [x] [Review][Patch] 网络报告原先只要求 20 条唯一通过项，可能漏掉固定目标；现已精确断言允许、控制正向及 metadata/RFC1918 阻断矩阵。[`verify-demo-runtime.mjs:111`](../../scripts/verify-demo-runtime.mjs#L111)
- [x] [Review][Patch] 导入/上传 location 未继承完整转发头；现已将公共头配置提升到 server 层。[`demo.conf:31`](../../nginx/demo.conf#L31)
- [x] [Review][Patch] 构建上下文未排除通用 secret/credential 文件，CI 真实 Compose 测试也可静默跳过；现已扩展 `.dockerignore` 并在 CI 设置 `REQUIRE_DOCKER_COMPOSE=1`。[`.dockerignore:12`](../../.dockerignore#L12)
- [x] [Review][Verification] 代理心跳夹具的短时测试偶发少发一个事件；已扩大局部夹具窗口并复跑 125 项配置/运行测试。[`demo-proxy-timeouts.test.ts:182`](../../tests/config/demo-proxy-timeouts.test.ts#L182)
- [ ] [Review][Defer] 真实超限流式请求、候选镜像 provenance、目标主机隔离、业务卷硬配额、HTTPS 与固定 0.6.1 digest 仍需外部环境和发布授权；已写入 `deferred-work.md`，不以本轮局部回归替代。

## Suggested Review Order (2026-09-16)

**运行时边界**

- 先看 Compose 资源与网络守卫
  [`verify-demo-runtime.mjs:41`](../../scripts/verify-demo-runtime.mjs#L41)

- 再看固定网络目标矩阵
  [`verify-demo-runtime.mjs:111`](../../scripts/verify-demo-runtime.mjs#L111)

**入口与构建安全**

- 核对 location 继承的转发头
  [`demo.conf:31`](../../nginx/demo.conf#L31)

- 核对构建上下文与 CI 强制门禁
  [`.dockerignore:12`](../../.dockerignore#L12)
  [`ci.yml:30`](../../.github/workflows/ci.yml#L30)

**验证证据**

- 查看新增矩阵、限制和夹具回归
  [`demo-runtime.test.ts:219`](../../tests/config/demo-runtime.test.ts#L219)

- 查看剩余外部部署延期项
  [`deferred-work.md:16`](../../_bmad-output/implementation-artifacts/deferred-work.md#L16)

### Review Findings (2026-09-16 运行时实现组 CR)

- [ ] [Review][Patch] Compose 的 `DEMO_PASSWORD` 与 `DEMO_SESSION_SECRET` 会被宿主同名环境变量覆盖；2026-09-19 已确认采用包装脚本清理宿主 `DEMO_*`/`COMPOSE_*` 后再执行 compose。[`docker-compose.demo.yml:58-61`](../../docker-compose.demo.yml#L58)
- [ ] [Review][Patch] 验收脚本超时或输出超限时只终止直接子进程，未保证 Windows 下 Docker/Compose 子进程树退出；可能遗留容器、网络、卷和临时凭据目录。[`scripts/demo-verification-utils.mjs:18-45`](../../scripts/demo-verification-utils.mjs#L18)
- [ ] [Review][Patch] 运行时和代理验收没有处理 Ctrl+C、SIGTERM 或终端关闭后的清理；长时场景中断后不会可靠执行 `down` 或写入 recovery 信息。[`scripts/verify-demo-runtime.mjs:272-305`](../../scripts/verify-demo-runtime.mjs#L272)
- [ ] [Review][Patch] 代理时限验收对 `nginx/demo.conf` 直接读取工作区文件，而 Compose 使用的是临时快照；运行期间文件变化会造成输入哈希、实际配置与报告不一致。[`scripts/verify-demo-proxy-timeouts.mjs:191-203`](../../scripts/verify-demo-proxy-timeouts.mjs#L191)
- [ ] [Review][Patch] `.dockerignore` 未覆盖通用 `*.env` 文件名；`config.env`、`prod.env` 等文件仍可能进入 `COPY . .` 的构建上下文。[`.dockerignore:10-20`](../../.dockerignore#L10)
- [ ] [Review][Patch] 代理时限验收并发运行四个最长 300 秒场景，共享单个受限 Nginx 和上游进程；资源争用会改变超时观测，导致误报或掩盖单场景问题。[`scripts/verify-demo-proxy-timeouts.mjs:233-247`](../../scripts/verify-demo-proxy-timeouts.mjs#L233)
- [ ] [Review][Patch] `/api/uploads` 的 25 MiB Nginx location 只有字符串配置断言，没有真实入口请求验证；位置匹配或 `proxy_pass` 失效时现有测试仍可能通过。[`nginx/demo.conf:44-47`](../../nginx/demo.conf#L44)
- [ ] [Review][Patch] 设置页内部 mock 接入点的保护只由 helper 单测覆盖，没有渲染 `SettingsPage` 并断言传给 `SettingsPanel` 的实际 props；页面回退为内部地址时现有测试不会失败。[`src/app/(app)/settings/page.tsx:22-36`](../../src/app/(app)/settings/page.tsx#L22)
- [ ] [Review][Patch] 候选 Compose 的健康检查、依赖顺序和只读/tmpfs 约束在常规测试中没有真实启动验证，运行脚本还要求外部预先构建本地镜像；错误的探针或镜像启动配置可能只在手工验收时暴露。[`tests/config/demo-compose-cli.test.ts:8-16`](../../tests/config/demo-compose-cli.test.ts#L8)

### Review Findings (2026-09-19 CR)
本轮已按用户选择「Apply every patch」落地。原 Story 验收（目标主机隔离、业务卷配额、0.6.1 digest/HTTPS）仍未完成，状态保持 in-review，不进入 2.3。


- [x] [Review][Patch] 采用包装脚本清理宿主 `DEMO_*`/`COMPOSE_*` 后再执行 compose（2026-09-19 已选方案 1）。README 启动命令未清理宿主变量；`demo-compose-cli` 测试会先删除这些变量，测不到污染路径。[`docker-compose.demo.yml:58`](../../docker-compose.demo.yml#L58)

- [x] [Review][Patch] 入口声称用 `$remote_addr` 重建 `X-Forwarded-For`，实现仍是 `$proxy_add_x_forwarded_for`；登录限流取该头第一个地址，客户端可伪造 IP 绕过 15 分钟 10 次失败限制。静态测试还把错误写法锁死。[`nginx/demo.conf:38`](../../nginx/demo.conf#L38)

- [x] [Review][Patch] 超限探针只向 `/api/import` 发送 `200MiB+1` 的 `Content-Length` 和 1 字节正文，8m 默认上限、200m 导入上限和中间件 200m 都会返回 413，无法证明导入 location 真的生效。[`scripts/demo-http-probes.mjs:27`](../../scripts/demo-http-probes.mjs#L27)

- [x] [Review][Patch] `.dockerignore` 仍未覆盖通用 `*.env`；`config.env`、`prod.env` 等可进入 `COPY . .` 构建上下文。[`.dockerignore:10`](../../.dockerignore#L10)

- [x] [Review][Patch] 验收脚本超时或输出超限时只 `kill` 直接子进程，Windows 下 Docker/Compose 进程树可能残留容器、网络、卷和临时凭据目录。[`scripts/demo-verification-utils.mjs:24`](../../scripts/demo-verification-utils.mjs#L24)

- [x] [Review][Patch] 运行时和代理验收未处理 Ctrl+C / SIGTERM / 终端关闭，长时场景中断后不会可靠 `down` 或写入 recovery。[`scripts/verify-demo-runtime.mjs:272`](../../scripts/verify-demo-runtime.mjs#L272)

- [x] [Review][Patch] 代理时限验收并发跑四个最长 300 秒场景，共享同一受限 Nginx 和上游，资源争用会扭曲超时观测。[`scripts/verify-demo-proxy-timeouts.mjs:233`](../../scripts/verify-demo-proxy-timeouts.mjs#L233)

- [x] [Review][Patch] `/api/uploads` 的 25 MiB location 只有配置字符串断言，没有真实入口请求；匹配失败时现有测试仍可通过。[`nginx/demo.conf:44`](../../nginx/demo.conf#L44)

- [x] [Review][Patch] 设置页 mock 接入点保护只测了 helper，没有渲染 `SettingsPage` 并断言传给 `SettingsPanel` 的 props。[`src/app/(app)/settings/page.tsx:22`](../../src/app/(app)/settings/page.tsx#L22)

- [x] [Review][Patch] 候选 Compose 的健康检查、依赖顺序和只读/tmpfs 在常规测试中没有真实启动验证，运行脚本还要求外部预先构建本地镜像。[`tests/config/demo-compose-cli.test.ts:8`](../../tests/config/demo-compose-cli.test.ts#L8)

- [x] [Review][Defer] 应用镜像仍指向未发布的 `0.6.1` tag，未固定 digest；Nginx 已钉摘要。公开部署前必须发布并固定。[`docker-compose.demo.yml:47`](../../docker-compose.demo.yml#L47) — deferred, pre-existing

- [x] [Review][Defer] `demo_net` 只设置 `gateway_mode_ipv4: isolated`，未声明 IPv6 等价隔离；目标主机正式网络、业务卷硬配额和 HTTPS 仍待专项验收。[`docker-compose.demo.yml:133`](../../docker-compose.demo.yml#L133) — deferred, pre-existing

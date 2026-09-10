---
title: 'Story 1.3 首次使用与故障排查教程'
type: 'chore'
created: '2026-09-10'
status: 'done'
baseline_commit: '59e4d9b9c37f1e82419c43b26e52e8661dd1a777'
review_loop_iteration: 0
context:
  - 'D:/ClaudeProjects/ai_acknowladge/README.md'
  - 'D:/ClaudeProjects/ai_acknowladge/README.en.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/README.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/部署手册-tailscale.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/手机快捷记录.md'
  - 'D:/ClaudeProjects/ai_acknowladge/docs/备份与恢复.md'
  - 'D:/ClaudeProjects/ai_acknowladge/_bmad-output/implementation-artifacts/epic-1-context.md'

<frozen-after-approval reason="人类确认后的意图不可由代理自行修改">

## Intent

**Problem:** 现有安装和部署资料分散在 README、Tailscale 手册、手机快捷记录与备份恢复文档中；首次用户虽然能找到安装命令，却没有一个只需阅读即可完成“登录到搜索”的连续路径，也缺少按症状执行的故障下一步。

**Approach:** 新增一份面向首次使用者的聚合教程，给出安装完成后的最短主流程，并用链接复用已有专项文档。同步中英文 README 与文档索引入口，明确 AI 未配置时的降级行为、实例隔离和密钥禁忌，不新增产品内向导或运行时能力。

## Boundaries & Constraints

**Always:** 使用已验证的 v0.6.0 安装/运行入口；主流程必须包含登录、新建普通文本笔记、等待 AI 整理、打开主题和搜索；每个故障项给出可执行下一步或明确停止条件；说明 Demo、正式实例、测试实例的数据/卷/环境文件隔离；链接现有部署、手机快捷记录、备份恢复文档；不要求真实 API Key 才能完成首条笔记。

**Ask First:** 若现有命令、端口、环境变量或页面文案与已发布 v0.6.0 基线冲突，暂停并请人确认，不自行改动运行时或安装路径。

**Never:** 不实现交互式首次使用向导；不新增安装器、数据库、页面或 API；不把手机真实设备、蜂窝网络连续 7 日验收写成已完成事实；不在文档中写入真实密码、Token、API Key 或正式数据路径之外的秘密。

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| HAPPY_PATH | 已按 v0.6.0 启动并能打开登录页 | 用户按教程完成登录、首条普通文本笔记、AI 整理、主题查看和搜索 | 每一步有成功判据 |
| AI_NOT_CONFIGURED | 笔记已保存但没有文本模型 | 明确说明笔记仍可用、状态为“待整理”，并指向设置入口 | 不把“待整理”描述为保存失败 |
| TASK_WAITING | 笔记长期处于整理中或失败 | 用户可检查 AI 服务/任务状态并按现有入口重试 | 超时后给出停止条件和日志/设置检查 |
| DEPLOYMENT_ERROR | 端口冲突、权限错误、HTTPS 不受信任或蜂窝网络不可达 | 按症状给出命令、检查项和恢复路径 | 无法排除时明确停止，不建议触碰正式数据 |

</frozen-after-approval>

## Code Map

- `docs/首次使用与故障排查.md` -- 新增聚合教程；承载最短首用路径、状态判据、故障表、隔离与安全边界，并链接专项文档。
- `README.md:25-40` -- 现有一键体验和首条笔记示例；增加中文教程入口，保持 v0.6.0 命令与 Demo 说明一致。
- `README.en.md:44-58` -- 英文快速体验入口；增加教程链接或等价的英文导航，不扩写未验证承诺。
- `docs/README.md:26-34` -- 专项文档索引；加入教程条目并说明其面向首次使用者。
- `docs/部署手册-tailscale.md:242-290,504-577` -- 已有登录、AI 配置和按症状 FAQ；只复用链接与术语，不复制或改变命令。
- `docs/手机快捷记录.md` -- 手机入口的前置条件与失败处理；教程只链接，不把真实手机验收写成完成。
- `docs/备份与恢复.md` -- 数据出口和恢复边界；教程链接备份入口，不重述危险恢复命令。

## Tasks & Acceptance

**Execution:**
- [x] `docs/首次使用与故障排查.md` -- 编写首次使用聚合教程、故障排查矩阵、隔离/密钥禁忌和专项文档链接 -- 让首次用户不需要维护者口头说明即可完成闭环。
- [x] `README.md`, `README.en.md` -- 在快速体验/部署导航处加入教程入口，并保持中英文版本号、端口和能力边界一致 -- 确保 GitHub 首屏可发现。
- [x] `docs/README.md` -- 增加教程索引条目 -- 保持专项文档可追溯。
- [x] `docs/首次使用与故障排查.md`, `tests/docs/first-use-guide.test.ts` -- 检查主流程和每个故障场景的链接、命令及停止条件 -- 防止文档入口断链或给出危险恢复建议。

**Acceptance Criteria:**
- Given 用户已按 v0.6.0 安装并打开登录页，when 只阅读首次使用教程，then 能完成登录、新建普通文本笔记、确认保存、查看 AI 整理状态、打开主题并完成一次搜索。
- Given AI 未配置或整理任务等待，when 用户按教程处理，then 知道笔记仍被保留、下一步检查位置和何时停止，不会误删正文或重建正式数据。
- Given 端口冲突、权限错误、HTTPS 不受信任或蜂窝网络不可达，when 用户查找对应症状，then 获得可执行检查/恢复步骤或明确停止条件。
- Given 用户准备使用 Demo、正式实例或测试实例，when 阅读安全边界，then 能区分数据、卷、环境文件和密码/密钥，且教程不包含真实秘密。
- Given README 与文档索引已更新，when 从中英文 README 或 `docs/README.md` 导航，then 教程链接有效并指向同一受支持版本边界。

## Design Notes

教程按“先完成一次，再理解配置，最后排错”的顺序组织：首屏只保留成功判据和下一步，复杂部署、手机捕获、备份恢复分别链接专项文档。故障项采用“症状 → 检查 → 修复 → 停止条件”四段式，避免泛化为“操作失败”。

## Verification

**Commands:**
- `rg -n --encoding UTF8 '首次使用与故障排查|docs/首次使用与故障排查.md' README.md README.en.md docs/README.md` -- expected: 三个入口均出现且路径一致。
- `rg -n --encoding UTF8 'localhost:3000|v0.6.0|APP_PASSWORD|SESSION_SECRET|capture:write|API Key' docs/首次使用与故障排查.md` -- expected: 关键命令、版本和安全词条存在且无真实秘密。
- `npm test -- tests/docs/first-use-guide.test.ts` -- expected: 教程契约测试 6/6 通过，覆盖主流程、AI 降级、部署故障、隔离边界、入口链接和版本约束。

**Manual checks (if no CLI):**
- 从 README 中文、英文和文档索引分别打开教程，逐段核对主流程、故障链接、停止条件和专项文档链接。

## Suggested Review Order

**首次使用主流程**

- 先看聚合教程如何把安装后的用户带入完整闭环。
  [首次使用与故障排查.md:13](../../docs/首次使用与故障排查.md#L13)

- 核对 AI 降级与任务等待是否保留正文并给出停止条件。
  [首次使用与故障排查.md:50](../../docs/首次使用与故障排查.md#L50)

**部署边界与排错**

- 检查端口、权限、HTTPS、蜂窝网络和实例隔离的可执行路径。
  [首次使用与故障排查.md:68](../../docs/首次使用与故障排查.md#L68)

- 检查安全边界、命名卷和备份入口是否避免误操作正式数据。
  [首次使用与故障排查.md:79](../../docs/首次使用与故障排查.md#L79)

**入口与验证**

- 核对中文 README 首屏是否能发现教程及固定版本入口。
  [README.md:25](../../README.md#L25)

- 核对英文 README 的教程导航与 Docker 版本边界。
  [README.en.md:43](../../README.en.md#L43)

- 核对文档索引是否把教程放在部署专项入口旁。
  [docs/README.md:26](../../docs/README.md#L26)

- 最后运行契约测试确认入口链接和关键部署约束未漂移。
  [first-use-guide.test.ts:56](../../tests/docs/first-use-guide.test.ts#L56)

### Review Findings

- [x] [Review][Patch] 故障表中的端口冲突和任务日志命令使用裸 `docker compose`，Windows 正式实例照抄后会绕过 `docker-compose.win.yml` 命名卷覆盖，可能触发 WAL 错误或操作错误实例 [docs/首次使用与故障排查.md:63,72-74]
- [x] [Review][Patch] 教程契约测试只验证文案和链接，不执行 README/英文 README 的安装命令；无法捕获英文 Windows 路径缺少 override 文件的问题 [tests/docs/first-use-guide.test.ts:1-84]
- [x] [Review][Patch] 冒烟证据未验证未配置 AI 时“待整理”降级状态、正文不被覆盖及首条笔记主题/搜索闭环，Story 验收证据覆盖不足 [scripts/smoke-fresh-install.ps1:184-224; docs/首次使用与故障排查.md:29-48]

---
title: '公开语料隔离验收：100 条笔记与 20 张导图'
type: 'chore'
created: '2026-09-21'
status: 'done'
baseline_commit: '0179c8dfc5aa021865a7b2020df7bfa161f03ec4'
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="用户直接要求从网上收集 100 条笔记与 20 张思维导图来测">

## Intent

**Problem:** 当前只有导图来源候选，缺少落盘样本与实际结果。

**Approach:** 收集公开资料，在本地隔离目录完成笔记导入检索出口检查，以及现有手写转写路径的导图识别实验。

## Boundaries & Constraints

**Always:** 单 Agent、顺序执行；来源 URL、版本、哈希、图片尺寸和处理方式可追溯。公开笔记与图片不计入真实使用门槛。模型仅接收本轮公开图片，每张一次、最多 20 次、不自动重试。原始图片与转写结果只保存在被忽略的 `data-public-eval/`。使用现有配置，密钥只在进程内读取，不写入报告。局部测试复用现有产品函数，数据库为内存库；不启动 worker。

**Ask First:** 额外模型调用、换供应商、产品缺陷修复、构建、全量测试、浏览器或发布。

**Never:** 改正式数据或 `.env*`；将公开图片当作用户真实样图；将识别文本当作已实现导图直接编辑；修改 Sprint 或解冻新功能。

## I/O & Edge-Case Matrix

| 场景 | 输入 | 结果 | 失败处理 |
|---|---|---|---|
| 笔记 | 100 条不同公开正文 | 导入、正文保真、检索、重复导入、出口记录 | 保留原始结果 |
| 导图 | 20 张不同公开导图，至少 7 张压缩处理 | 来源与尺寸齐全，每张一次现有转写 | 下载失败换来源；调用失败不重试 |
| 结构 | 图中节点、层级、连线 | 与原图核对，记录可用、要修或不可用 | 不以合法 JSON 代替内容正确 |
| 隔离 | 独立目录与内存库 | 不写正式库，不泄露密钥 | 发现越界停止 |

</frozen-after-approval>

## Code Map

- `src/lib/import.ts`：`importZipFile`，关闭 AI 导入公开 Markdown。
- `src/lib/search.ts`：关键词搜索与 FTS；不代表真实向量检索。
- `src/lib/ai/handwriting.ts`：`transcribeHandwriting`，保留现有提示词、JSON 解析和追加语义。
- `src/lib/vision-images.ts`：最长边 1600、WebP 及字节限制，密集导图可能损失小字号。
- `src/lib/llm-config.ts`：显式视觉模型名，地址与密钥可回落文本配置。
- `tests/setup.ts`：内存库与假模型配置；实验单独注入现有视觉配置。
- `tests/lib/notes-corpus-acceptance.test.ts`：130 篇历史固定问题不可套用本次 100 篇，不修改其断言。

## Tasks & Acceptance

**Execution:**
- [x] `data-public-eval/`：来源登记、下载、去重、压缩、局部验收与逐图结果。
- [x] `.gitignore`：仅追加实验目录忽略规则，保留已有修改。
- [x] `docs/公开语料与导图实验-2026-09-21.md`：记录数量、范围、结果、局限及下一步。
- [x] `docs/README.md`、PRD 样本来源清单：同步实验入口和样本现状。

**Acceptance Criteria:**
- Given 公开来源，when 收集完成，then 恰好 100 条不同笔记、20 张不同原图具有来源和哈希。
- Given 内存库，when 执行局部验收，then 导入、重复导入、检索、正文保真和数据出口有独立结果。
- Given 现有视觉配置，when 顺序转写，then 每张保留成功或失败，调用总数不超过 20；内容质量另行核对。

## Spec Change Log

- 2026-09-23：完成 100 篇笔记的内存库验收和 20 张导图各一次转写。正式库 `vision_model` 现为「42」，与 9 月 22 日批复记下的模型名不一致，未改配置。
- 2026-09-23 审查：更正「超过 Sharp 默认可读上限」。那 6 张只是超过 3000 万像素，低于 Sharp 默认上限 268402689。验收改为锁住全部跳过、检索 20 条和逐图结论。冻结块未改。

## Design Notes

**2026-09-22 产品负责人批复**：模型预算与发送范围批准，20 张公开图各 1 次、失败不重试、总数不超过 20；只发本轮公开图片，不含用户真实图，真实图另批。视觉模型用现有配置，正式库 settings 表只读探测后注入（当前为 gemini-3.1-flash-lite-preview，环境变量中无视觉配置），密钥不写入报告。

已知样本局限，报告的「局限」一节必须写明：20 张导图全部来自 SSHeRun/CS-Xmind-Note，全是计算机专业课，没有数学，对不上 PRD 检索原句，也看不了跨领域泛化；全部为软件直出超大图，长边 2162 至 19961 像素，现有管道压到 1600 后最大一张缩至 8%，小字必然丢失。至少 7 张的压缩或拍照处理尚未做，属本轮执行内容。结果只说明现有转写管道的起点，不能判定 FR-7 可行或不可行，FR-7 主判据仍是用户的三四张真实图。

执行后记：上文「尚未做」只保留批复当时的缺口。7 张拍照模拟已完成，编号 01、02、03、04、05、06、11。07、08、09、10、12、14 超过 3000 万像素，转写用了已留存副本，并没有超过 Sharp 默认上限。

## Verification

只运行 `npx vitest run --config data-public-eval/vitest.acceptance.mts` 与文件检查；不跑完整发布门禁。账本已有调用记录时不得再次请求模型。用户本轮直接执行指令覆盖 skill 的重复审批与远程只读限制，单 Agent 约束覆盖默认子 Agent 分工。测试语料不替代 PRD 的真实使用基线，网上样本不能解除冻结。

## Suggested Review Order

**实验结论**

- 公开样本不能判定 FR-7
  [`实验报告:5`](../../docs/公开语料与导图实验-2026-09-21.md#L5)

- 六张图未超默认上限
  [`实验报告:36`](../../docs/公开语料与导图实验-2026-09-21.md#L36)

- 04 有正文但无节点
  [`实验报告:52`](../../docs/公开语料与导图实验-2026-09-21.md#L52)

**验收断言**

- 重复导入必须全部跳过
  [`acceptance.test.ts:157`](../../data-public-eval/acceptance.test.ts#L157)

- 副本按三千万像素选取
  [`acceptance.test.ts:244`](../../data-public-eval/acceptance.test.ts#L244)

- 失败类型被断言锁住
  [`acceptance.test.ts:329`](../../data-public-eval/acceptance.test.ts#L329)

**文档同步**

- 索引指向本次实验
  [`README.md:42`](../../docs/README.md#L42)

- 清单改记实际目录
  [`可行性实验样本来源.md:20`](../planning-artifacts/prds/prd-知了-2026-09-19/可行性实验样本来源.md#L20)

**规格收口**

- 审查更正记入变更
  [`spec-public-corpus-mindmap-eval.md:64`](./spec-public-corpus-mindmap-eval.md#L64)

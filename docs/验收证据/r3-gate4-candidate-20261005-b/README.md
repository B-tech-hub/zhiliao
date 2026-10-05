# R3 阶段 B：固定依赖补丁与 Mermaid 候选

日期：2026-10-05。本材料为新候选的输入，不是该候选 CI 结果。**本地阶段 A 已完成；本候选完整 PR CI 待验证，门禁 4–6 仍未关闭。**

## 精确范围

以 S=`8bde2debb5960a8fc31dd5b912dc7d31d4463b55` 为唯一父提交，保留其 Undici 7.29.1、Markdown 导出隔离和现有 CI。仅加入 R=`1ad51b31f8d97eecfc8e3061e1a5698cf367578c` 的 Mermaid 懒加载收敛及三份测试修正，和已经验收的三记录九字段锁补丁；另新增本目录八份精选材料，共 13 路径。不整包合并共享分支，不修改其他源码、测试断言或 workflow。

锁文件 SHA-256：`4432a15f29eeedba0c43971afe93dc8f26e59106b2eae2ede40ee05b5a0744ba`。brace-expansion 两条分别为 1.1.21 / 5.0.12，DOMPurify 为 3.4.16。完整来源和复用时点见 [input-identity.json](input-identity.json)，实际提交与 tree 保存在仓库外执行记录，不写入自身输入。

## 已有验证与历史原件

- e 批四文件 ESLint、f 批 34 项测试、g 批 DOMPurify 三场景均复用，不在本机重复运行。
- [offline-checks.json](offline-checks.json) 是 2026-10-04 i 批的 2 个正向、22 个负向结果原件，不是本批产品测试。
- [lock-applied.json](lock-applied.json) 是 i 批三记录九字段落地原件；主安装未刷新，成绩属于固定 c 隔离组合。
- [audit-all.json](audit-all.json) 为 g 批原始报告，仍是 **5 high / 33 moderate / 0 low / 0 critical**。
- [audit-production.json](audit-production.json) 为 h 批唯一生产审计原始报告，**0 high / 0 low / 0 critical / 33 moderate**。两份报告采集时点不同；本批不重新审计，不以相同计数证明新时点公告身份一致。
- h 批因两项 TipTap 的 effects/fixAvailable 摘要归属重排而 STOP，原失败不撤销。i 只对固定原件的两包两字段精确重排离线放行，未知差异仍拒绝；不泛化忽略 effects。

## 真实风险与批准边界

braces 的 GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 仍是真实漏洞，不是误报或已经修复。五个开发依赖 high 的 [精确例外](exception.json) 截止仍为 `2026-10-18T00:00:00Z`，不自动续期，生产侧不豁免。新候选前的 [官方字段复核](official-fields.json) 只证明所记时点的公告和版本信息，不是新 npm audit，也不是完整 HTTP 原件；官方修复、依赖、配置、调用输入或生产适用性变化会提前使例外失效。

本阶段仅批准独立 checkout、一次提交、一次普通推送、一次 PR #13 标题/说明更新及自动完整 CI。首次失败停止，不 rerun、强推或补提交。正常完成后仍观察到推送起至少 600 秒；有限窗口无重复不能保证未来永不重复。

新候选及实际 PR checkout 必须独立核对，不能沿用 S 的旧成功结果。本轮不合并 main、不打 tag、不操作 GHCR、不发布 Release、不接触正式数据。锁层生产审计不能替代最终镜像、运行时、原生双架构无缓存分发、manifest/digest 和匿名安装验收；门禁 4–6、Story/Sprint 保持。

# TipTap 官方回补与图片往返修复证据

日期：2026-09-19。对应[实施结果](../../TipTap残余风险调查-2026-09-19.md#tiptap-patch-result)与[获批规格](../../../_bmad-output/implementation-artifacts/spec-r1-tiptap-residual-risk.md)。用户先批准 core 回补及局部验证，后明确追加图片往返最小修复；全程单 Agent。

最终 4 个测试文件 **49/49 通过，无跳过**：helper 12、实际编辑器 26、数学 3、Mermaid 8。目标 lint、局部类型和版本校验通过。全量/生产审计仍为 **32 moderate、0 high、0 critical**，全部关联公告范围未反映官方 v2 回补的同一 GHSA。

| 文件 | 内容 |
|---|---|
| `baseline-meta.json`、`workspace-before.json` | 执行前 HEAD、索引及工作区文件哈希，不包含正文或凭据 |
| `implementation.diff` | 本轮 package/lock/编辑器源码差异，不混入既有改动；新增测试直接见仓库 tests |
| `lock-review.json` | 临时副本只变更 core，875 个依赖包加根条目共 876 条保持 |
| `installed-before.json`、`dependency-check.json` | 752 个已安装包版本、原生文件与官方产物哈希、31 条 core 消费关系、审计归因 |
| `helper-before.report.json`、`helper-after.report.json` | 同一 helper 回归旧版 8 失败/4 通过，回补后 12 通过 |
| `editor-before.report.json` | 最初组件测试报告，含定位图片的测试选择器问题；不能将这 16 项失败均当作产品缺陷 |
| `editor-before-corrected.report.json` | 修正选择器后，旧版 16 通过/4 失败，确认两类图片往返缺陷 |
| `targeted-after.report.json`、`targeted-final.report.json` | 首次修复后 47 项通过；自审补仅宽度场景后最终 49 项通过，组件从 20 增至 26 |
| `targeted-lint.report.json`、`component-lint-final.report.json` | 3 文件初次 lint 和最后仅类型标注变化的组件测试复查 |
| `review-lint.report.json`、`commands/review-types.*` | 自审新增用例后的最终组件测试 lint 与局部类型检查 |
| `commands/` | 各命令时间、参数、退出码及原始 stdout/stderr；审计 JSON 是对应 stdout.log |
| `harness/` | 复用的隔离命令包装器、局部 TypeScript 配置、变更前真实编辑器源码 |
| `summary.json` | 机器汇总、授权范围及测试工具问题说明 |
| `review.md`、`verification.json` | 单 Agent 自审、验收矩阵及工作区保留核对 |
| `artifact-manifest.json` | 证据文件 SHA-256，不含清单自身 |

## 复验与解释

原命令在 `commands/*.json` 中。包装器清除模型、鉴权与数据目录环境变量，设置内存库和本轮临时目录，安装脚本始终禁用。需要跨机复验时，将 `harness/run-step.py.txt` 复制到新的隔离临时目录并改为 `.py`，替换工具和工作区绝对路径，不向正式数据目录运行。

最终测试命令等价于：

```powershell
node node_modules/vitest/vitest.mjs run tests/lib/tiptap-security.test.ts tests/components/markdown-editor-security.test.tsx tests/lib/math.test.ts tests/lib/mermaid.test.ts --maxWorkers=1
```

组件测试使用真实编辑器及扩展，只替换 Mermaid SVG 绘图器、固定 jsdom 拖放落点并禁止 fetch。它验证解析、事务、序列化、NodeView 集成与正文保真，不代表原生剪贴板、视觉布局或完整 Mermaid SVG 安全验收。helper 用 JSON 自有 `__proto__`、惰性标记和空事件属性验证 DOMSerializer，没有执行事件载荷。

局部类型检查从 3 个变更源码/测试文件及导入展开，使用仓库 compilerOptions，关闭 incremental，明确 typeRoots；不是全仓库类型检查。初次临时配置未生成、随后缺少临时目录的 Node 类型发现路径，均保留失败日志。它还检出测试中缺少 `HTMLImageElement` 类型参数，已修正；该类型标注不改变已通过的测试运行逻辑，随后类型检查和该文件 lint 通过。

Vite 关于未来 native config loader 不支持 `__dirname` 的既有提示保留，未抑制。两次依赖审计退出 1 源于 moderate 告警，JSON 正常；回补判据为实际版本/产物哈希和行为回归，不是扫描数字清零。

没有 build、全量测试、Docker、真实浏览器、模型或恢复/发布。应用版本仍为 0.6.1，新候选和 R1/R2 原门禁继续保留；先前已经丢失的图片属性不会自动恢复。

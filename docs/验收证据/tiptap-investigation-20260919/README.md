# TipTap v2 回补调查证据

对应[调查与方案](../../TipTap残余风险调查-2026-09-19.md)。本目录是只读调查证据，不是实施或运行验收。

| 文件 | 内容 |
|---|---|
| `summary.json` | UTC 时间、HEAD、13 个现有文件哈希、候选包校验、31 条 core 消费约束及执行边界 |
| `core-2.27.3.registry.json` | 官方精确版本元数据原始响应，含 tarball URL、integrity 与 gitHead |
| `mergeAttributes-2.27.3.ts.txt` | 校验 tarball 后读取的完整 helper 源码 |
| `mergeAttributes-source.diff.txt` | 已安装 2.27.2 与官方 2.27.3 的 helper 源码差异 |
| `dist-index.js.excerpt.txt`、`dist-index.cjs.excerpt.txt` | ESM/CJS 实际发布产物中的 helper 片段；完整产物哈希记在 summary |
| `upstream-fix-commit.json` | 公告引用的官方修复提交原始响应 |
| `core-2.27.3.advisory.json` | 只提交 core 2.27.3 的 npm Advisory Bulk 原始响应，仍命中公告 |
| `artifact-manifest.json` | 本目录文件 SHA-256，不包含自身 |
| `verification.json` | 现有文件保留、材料格式及链接检查 |

tarball 只在内存中解包读取，未解压到 node_modules、未安装或执行。其 SHA-512/SHA-1 均核对 registry；不是签名或 provenance 验证。再次核查可按 registry 内 URL 获取同一 tarball，复算 integrity 并核对上述源码及产物哈希。

官方补丁为 `__proto__` 定义自有数据属性；这与直接删除该键不同。应用回归应验证正常原型及没有继承 DOM 属性，不能只检查自有键数量。

Bulk 查询请求为 `{"@tiptap/core":["2.27.3"]}`，发往 `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`。它证明公告对候选版本的匹配，不是新的全量/生产审计，也不能预测整棵依赖树的精确告警数量。

采集时两次工具问题均发生在有效证据生成前：PowerShell 管道默认编码导致中文目录名失败；随后错误地给 npm 使用 GitHub 专用 Accept 导致 HTTP 406。改用 Unicode 路径及通用 JSON Accept 后成功。没有改变产品代码、依赖或网络权限。

本轮不执行产品测试、build、全量测试、Docker、真实浏览器或恢复；实际编辑器可达性是源码分析结论，运行证明留待批准后的定向回归。

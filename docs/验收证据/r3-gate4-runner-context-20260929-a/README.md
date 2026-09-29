# Release 四处 runner.temp 上下文错误：本地修复证据

**四处上下文错误已本地修复，最终 64 项定向回归、actionlint 和 Bash 初始化对照通过。** 用户先要求调查与最小计划，随后确认本地实施和局部验证。本轮保持单 Agent；未提交、推送、触发远端 CI、构建镜像或发布，门禁 4–6 仍未关闭。

## 身份与证据边界

- 本轮 HEAD：`321f770b523773e3f93a56dcf4fd2b1f78213ca5`，分支 `candidate/0.6.1-baseline`。修复是该 HEAD 上的未提交工作树变化，不把这个 SHA 称为修复提交。
- 原规格 baseline 保持 `549f45200081f9c50b3d658e4c8d1a7c695bde04`，冻结块原样保留；规格继续 `in-progress`，只完成 V 后本地修复子任务。
- [V 归档](../r3-gate4-v-061-36567105695/README.md)的 PR CI `36567105695`、878/28 及 Release `36567100870` 的零 job 失败保持原义。旧 P/V 归档和全部既有证据均未覆盖。
- [inputs.json](inputs.json)记录当前工作流、测试、工具和文档的输入哈希；[preservation.json](preservation.json)记录与实施前 1696 文件快照的比较，以及旧证据、HEAD、暂存区和冻结块保留检查。新证据只属于本轮局部验证。

## 实施与串行自审

1. 删除 build 的 `EVIDENCE` 和 install 的 `EVIDENCE`、`DOCKER_HOST`、`DOCKER_CONFIG` 四个 job 级非法表达式。
2. 各 job 的首个 Bash 步骤使用 `$RUNNER_TEMP` 生成路径，通过 `printf '%s\n'` 追加到 `$GITHUB_ENV`。值从下一步骤生效，初始化只写变量，不创建目录；原匿名配置、daemon 空存储、归属检查和清理步骤保留。
3. 两个始终执行的 artifact 上传步骤使用合法的 step 级 `${{ runner.temp }}/gate4-build/` 和 `${{ runner.temp }}/gate4-install/`。自审发现，如果仍依赖初始化写入的 `env.EVIDENCE`，初始化失败时路径可能成为 `/`；固定上传目录补上这一失败分支。
4. 配置测试守卫 workflow/job env 的已知上下文限制、首步骤初始化、匿名路径、清理及固定上传目录。该守卫不宣称是完整 Actions 表达式解析器。

语义对照确认，其余工作流结构与原文件相同，包括 tag 过滤、权限、双架构顺序、无缓存设置、目录不存在检查、daemon 归属和 Release 依赖。检查输出见 [workflow-delta.txt](workflow-delta.txt)。本轮由同一 Agent 从上下文可用性、删除后的消费者、初始化与上传失败路径、验证覆盖四个方向串行自审，不称为独立多 Agent 审查。

## 局部验证

| 检查 | 结果与原始记录 |
|---|---|
| actionlint 旧文件对照 | 退出 1，准确报原 81、206、207、208 行四处非法 `runner` 上下文；[输出](actionlint-before.txt) |
| 新回归对旧工作流 | 21 通过、4 失败、0 跳过；四个失败均对应非法 job env 或缺少初始化；[首次报告](tests-before.json) |
| 首轮修复 | 两文件 64 通过、0 失败、0 跳过；[报告](tests-initial.json)，不与最终成绩相加 |
| 自审补固定上传目录后 | 两文件重新验证，64 通过、0 失败、0 跳过，其中 gate4 25 项、release-version 39 项；[最终报告](tests-after.json) |
| actionlint 最终文件 | 退出 0，无诊断；[输出](actionlint-after.txt)、[命令及退出码](checks.json) |
| Bash 初始化片段 | 两份语法检查和六个环境对照通过：空目录、已有目录、缺失 `RUNNER_TEMP`；含空格路径值正确，原环境条目和目录内容保持，缺失变量返回 1；[结果](bash-init.json) |
| 目标 ESLint 与差异 | 修改的测试文件 ESLint 和 `git diff --check` 均退出 0；[命令](checks.json) |
| 文档与保留检查 | UTF-8、LF、中文注释 GB2312 可编码及本地链接目标检查；既有证据全部保留，详见 [preservation.json](preservation.json) |

本机 Node.js `v22.19.0`。Vitest 沿用仓库配置，以一个 worker 串行运行，未加载正式 `.env`；版本测试中的定向 TypeScript 检查不运行 Next build。Vite 提示既有 `__dirname` 配置在未来 native loader 下不受支持，本轮未修改配置或屏蔽提示。

```bash
node node_modules/vitest/vitest.mjs run tests/config/release-gate4.test.ts tests/config/release-version.test.ts --maxWorkers=1 --no-file-parallelism --reporter=json --outputFile=<新临时目录>/tests-after.json
node node_modules/eslint/bin/eslint.js tests/config/release-gate4.test.ts
actionlint -shellcheck= -pyflakes= -no-color .github/workflows/release.yml
git diff --check
```

actionlint 为官方 [v1.7.7](https://github.com/rhysd/actionlint/releases/tag/v1.7.7) 的 Windows amd64 包；下载 ZIP 的 SHA-256 为 `7f12f1801bca3d480d67aaf7774f4c2a6359a3ca8eebe382c95c10c9704aa731`，与该版本 checksums 一致，二进制哈希和版本见 [tool.json](tool.json)。工具只放在系统临时目录，不加入项目依赖。`-shellcheck=`、`-pyflakes=` 关闭这两个未安装的外部检查器，Actions 表达式上下文校验保持启用；Bash 语法与初始化执行另行验证，不宣称完整 ShellCheck 或 Python 检查通过。

[initializers.json](initializers.json)保存从实际工作流解析出的两个片段，[verify-initializers.py](verify-initializers.py)保存本轮对照方法。复验时先将两者复制到新临时目录，再在 Windows/WSL 环境执行脚本；不要在本归档目录直接重跑。脚本只执行初始化片段，读取 `$GITHUB_ENV` 产生的键值并与预期比较，没有启动 Docker 或模拟完整 GitHub runner。真实 GitHub 对环境文件的消费与 Release 运行仍须后续远端验证。

## 后续

修复文件、文档及旧 V 归档仍在本地。下一次提交与候选推送须按实际新差异形成确认单，包含自动完整 CI；RC tag、GHCR、双架构构建/安装及 Release 仍单独安排。旧 CI 成功不归到修复后的新输入，本地校验成功也不代表分发验收完成。

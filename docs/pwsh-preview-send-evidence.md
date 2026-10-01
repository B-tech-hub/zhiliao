# pwsh 预览父进程发送证据

本文件适用于诊断候选 e：`hosted-warm-v3-send-evidence`，计划分支 `diagnostics/0.6.1-pwsh-hosted-warm-e`，唯一父提交 `4c5c3c8fd6ca54c3a40ec7ae55b1bb7a1afb2091`。本地准备阶段尚无候选提交、tree 或远端 run。

## 证据语义

`sequence` 是排序结果，`module-queued` 是 worker 收集通知，`module-start` 是开始通知。它们均不能替代父进程发送顺序。仅 `send-begin` 记录父进程即将调用内建 `ForksPoolWorker.prototype.send` 的顺序；`send-end` 的 `returned` 仅指原方法同步返回，不保证子进程已收到或执行通过。

仅采集带 `__vitest_worker_request__: true` 的 `run` 请求。字段为 sample、protocol、parent_pid、worker_id、files、从 1 开始的 sequence 和字符串格式的 monotonic_ns。开始和结束记录必须配对，字段相符，时间不倒退，文件覆盖与本单元报告一致，无重复。第一个请求的首文件必须为预览目标。缺证、发送异常或实际反序均停止，不回退采用排序或通知。

## 生命周期和固定输入

reporter 初始化时包装已导出的同一个内建 forks 类；非 run 消息原样转发。保留 this、全部参数、返回值和原异常；每个符合接口的调用至多转发一次，证据开始写入失败时不发送。重复安装、接口不符、写入失败均停止。原发送抛错与写入失败并发时保留原发送首因。正常 onTestRunEnd 恢复原方法后记录 run-end；异常中断缺少恢复记录，收口拒绝。恢复时如所有者变化，拒绝覆盖他人的方法。

固定 Vitest 4.1.11；`dist/chunks/cli-api.CnMVyzaz.js` SHA256 为 `a236001d048380e2c67d05423fc9ea3f26b07ee019ba8d6e622082f29d49102e`。该 experimental 导出随版本可能改变，不能升级后直接复用。新 observer 的哈希写入记录器 coreHashes，全目录输入清单继续覆盖其余源码和依赖。

同步证据 I/O 会有采集开销。本候选没有增加启动屏障、延迟、自定义 pool 或 worker 数量调整，不保证目标首先发送。原 69 文件、914 总测试、886 通过/28 跳过、11 个预览测试、10/15 秒预算、进程退出、输入指纹、实际负载及首错停止要求保持。

## 本地验收与边界

2026-10-01：12 个离线场景全部通过；一次内建 forks 冒烟通过，两个微型文件、最多两个 worker、30 秒上限，实际约 3.92 秒。未调用 pwsh 或业务测试，未安装或复制依赖。此结果只证明本地采集接线和判据，不证明托管环境时序或原超时根因。

旧 d run 36832254300 的 L3 仍失败，真实发送顺序未知，不重判、不跨批拼接。提交、推送、完整八单元实验、合并及发布须另行授权。门禁 4–6 仍未关闭。

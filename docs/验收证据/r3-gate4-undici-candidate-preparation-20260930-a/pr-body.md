将 jsdom 的间接开发依赖 Undici 从 7.29.0 更新到 7.29.1，处理 WebSocket 拒绝服务与 BalancedPool TLS 选项丢失两条高危公告。仅修改锁文件的 version、resolved、integrity 三字段；补充 main 合并、漏洞调查和补丁验证的追溯资料，相关文档同步。

修复后的全依赖与排除开发依赖审计均为 33 moderate、0 high、0 critical。隔离副本的 8 份 jsdom 测试首次 95 通过、1 次正文同步超时；失败场景在新旧版本限定对照中各 2 项通过，原 5 秒时限和断言未改，首次失败与未定原因保留。

本 PR 的完整 CI 待运行；旧 main CI 通过属于旧锁文件，不能作为新补丁成绩。Node 内置 Undici 未随 npm 包更新，实际 RC 运行时仍需核对；本 PR 不包含合并、镜像或版本发布。

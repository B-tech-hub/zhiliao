# 升级与回退彩排审查（单 Agent）

按用户规则，多 Agent 默认关闭，所以规格要求的三个审查层（Blind Hunter、Edge Case Hunter、Verification Gap）都由当前 Agent 依次完成，没有启动子 Agent。审查对象是基线 `ca2d6bd778521c2e71741da10353efbeaadf5d80` 之后的全部改动：`docs/验收证据/upgrade-060-061-20260927-a/` 以及六份同步文档。

| 发现 | 分诊 | 处理 |
|---|---|---|
| 回退后 HEIC 400 被归为「0.6.0 已知缺陷」，但本轮没有在 0.6.0 源实例上直接验证 | patch | 已在归档 README 写明 v0.6.0 图片路由的文件名正则（`route.ts:11`），证明 0.6.0 无法读取自己生成的 UUID 展示图 |
| 调查阶段对正式容器执行过 `docker exec zhiliao true`，与「只读核对」的约束不符 | patch | 已在归档 README 披露；前后资源记录一致，没有造成状态变化 |
| 升级状态快照是在 readback（含登录）之后才采集的，登录可能写入数据 | reject | inspect 只比较业务表，登录写入不在这些表中；比对也已通过 |
| `fixture.cjs` 的 readback 调用了两次 `readSeed()` | reject | 只影响写法，不影响结果；工具已经执行过，为了保持归档与运行包逐字节一致，不做修改 |
| 没有做「0.6.0 直接打开升级后的卷」的反向降级观测 | reject | 规格已定为可选观测项，归档 README 已写明未执行 |
| 仅覆盖 0.6.0 起点、小规模数据、本机 amd64 | defer 已有 | 归档与各文档都已写明「未覆盖范围」，不重复写入 deferred-work |

结论：没有 intent_gap 或 bad_spec，无需回退重做。两项 patch 已处理完毕。矩阵的三行都有实际通过的运行证据：`upgrade: passed`、`check-persist`、两次 `rollback: passed`。

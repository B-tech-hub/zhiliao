# 图片接口回归样本

`pattern.png` 与 `pattern.heic` 是 96×64 合成几何图，按仓库 MIT 许可使用，无真实用户照片。原样复制自 `docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixtures/`，生成方法见该目录的 `generate.py` 与 README。HEIC 是实际 HEVC 编码，测试使用真实上传转换接口。

| 文件 | SHA-256 |
|---|---|
| pattern.png | `336badf78b5da96ffde16ff3459d0460d9a55d040884bedb8e7fb2c2088c6b07` |
| pattern.heic | `fdf0daeaa1c7fb66bd466cb382e7cc9627454676b0974c9e1f27e51dfb6beae9` |

样本放入 tests 以随候选输入一起复制，避免接口回归依赖候选上下文之外的文档目录；历史 R2 样本原字节不改。

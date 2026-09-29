# R2 合成图片

`pattern.png` 和 `pattern.heic` 是本仓库生成的 96×64 几何图，随仓库 MIT 许可提供，没有真实照片或外部素材。HEIC 是实际 HEVC 编码图片，不是只带文件头的模拟数据。

生成工具为隔离的 `pillow-heif==1.1.1` 与 `Pillow==11.3.0`，未修改项目依赖：

```powershell
uv run --no-project --no-cache --with pillow-heif==1.1.1 --with Pillow==11.3.0 python docs/验收证据/0.6.1-baseline-2026-09-23/r2/fixtures/generate.py
```

准备阶段已用项目现有 `heic-convert` 转为 JPEG，再由 Sharp 读取到 96×64；结果见 `decode.json`，预览为 `pattern-preview.jpg`。这只证明样本在宿主依赖下可解码，候选容器里的上传、转换、导出与恢复仍待执行。实测必须上传 `pattern.heic`，不能用预生成 JPEG 替代容器转换。

| 文件 | SHA-256 |
|---|---|
| pattern.png | `336badf78b5da96ffde16ff3459d0460d9a55d040884bedb8e7fb2c2088c6b07` |
| pattern.heic | `fdf0daeaa1c7fb66bd466cb382e7cc9627454676b0974c9e1f27e51dfb6beae9` |

重新生成时编码器可能带来二进制变化，验收以本次已留存文件和上表哈希为准。

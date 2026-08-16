// 图像生成：OpenAI 兼容的 POST {base}/images/generations（同步返回）。
//
// 只做这一种形态。DashScope 那类「提交任务 → 轮询 task_id → 下载」的异步接口
// 手上没有可实测的 Key，而没真验过的适配器不该发——健康检查潜伏四个版本
// 那次的教训就是「对外宣传过的特性必须真的验一次」。取舍详见 ADR-0011。

import { getImageConfig } from "@/lib/llm-config";
import { sniffImageMime } from "@/lib/uploads";

export class ImageGenError extends Error {}

// 单张图的大小上限。生成的图普遍在 1~3MB，10MB 足够，同时挡住异常响应撑爆内存
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface GeneratedImage {
  buf: Buffer;
  mime: string;
}

// data[0] 的两种形态：直接给 base64，或给一个短期有效的下载地址
interface ImageDatum {
  url?: string;
  b64_json?: string;
}

/* 把响应里的图取成字节。url 形态必须当场下载——各家的图床地址普遍
   一小时内失效，只存 URL 的话笔记里的图过一阵就全变成裂图。 */
async function toBuffer(datum: ImageDatum, signal: AbortSignal): Promise<Buffer> {
  if (typeof datum.b64_json === "string" && datum.b64_json) {
    const buf = Buffer.from(datum.b64_json, "base64");
    if (buf.byteLength === 0) throw new ImageGenError("图像数据为空（b64_json 解码结果为 0 字节）");
    return buf;
  }
  if (typeof datum.url === "string" && datum.url) {
    const res = await fetch(datum.url, { signal }).catch((e) => {
      throw new ImageGenError(`下载生成的图片失败：${e?.message ?? e}`);
    });
    if (!res.ok) throw new ImageGenError(`下载生成的图片失败 HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new ImageGenError(`生成的图片过大（${Math.round(buf.byteLength / 1024 / 1024)}MB）`);
    }
    return buf;
  }
  throw new ImageGenError("响应中既没有 b64_json 也没有 url，接入点可能不兼容 OpenAI 图像接口");
}

export async function generateImage(
  prompt: string,
  opts?: { signal?: AbortSignal },
): Promise<GeneratedImage> {
  const cfg = getImageConfig();
  if (!cfg.model) {
    throw new ImageGenError("未配置图像模型名，AI 生图未启用");
  }
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new ImageGenError("图像生成缺少接入点或 API Key");
  }

  // 生图普遍比对话慢得多，超时单独给，默认 3 分钟
  const timeout = Number(process.env.IMAGE_TIMEOUT_MS) || 180000;
  const signals = [AbortSignal.timeout(timeout), ...(opts?.signal ? [opts.signal] : [])];
  const signal = AbortSignal.any(signals);

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    // 不发 size：各家支持的尺寸枚举互不相同，猜错就是一个 400，
    // 交给供应商用自己的默认值最稳
    body: JSON.stringify({ model: cfg.model, prompt, n: 1 }),
    signal,
  }).catch((e) => {
    throw new ImageGenError(`网络错误：${e?.message ?? e}`);
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImageGenError(`图像生成失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => {
    throw new ImageGenError("图像生成响应不是合法 JSON");
  });
  const datum = (data as { data?: ImageDatum[] })?.data?.[0];
  if (!datum) {
    throw new ImageGenError("图像生成响应缺少 data 字段");
  }

  const buf = await toBuffer(datum, signal);
  // 类型按魔数判定：回传的 Content-Type 常是 octet-stream，照抄会存出打不开的文件
  const mime = sniffImageMime(buf);
  if (!mime) {
    throw new ImageGenError("返回的数据不是可识别的图片格式（支持 png / jpg / gif / webp）");
  }
  return { buf, mime };
}

/* 图像模型连通性测试（设置页「测试连接」）。
   真的生成一张图——只查配置齐不齐说明不了任何问题，端点路径不对、模型名拼错、
   额度用尽这三种最常见的失败都只有真发一次请求才暴露。因此按钮旁必须写明会计费。
   生成的图不落盘也不入库：测试产物没有价值，存了反倒污染孤儿清扫。 */
export async function testImageConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = getImageConfig();
  if (!cfg.model) {
    return { ok: false, message: "未配置图像模型名，AI 生图未启用" };
  }
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { ok: false, message: "缺少接入点或 API Key：请填写，或先配置好上方文本模型以便回落" };
  }
  try {
    const { buf, mime } = await generateImage("A simple blue circle on a plain white background", {
      signal: AbortSignal.timeout(180000),
    });
    return {
      ok: true,
      message: `连接成功（${cfg.model}，已生成 ${Math.max(1, Math.round(buf.byteLength / 1024))}KB 的 ${mime} 图片，本次调用已计费）`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

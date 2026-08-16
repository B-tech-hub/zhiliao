import { z } from "zod";
import { ImageGenError, generateImage } from "@/lib/image-gen";
import { saveImage } from "@/lib/uploads";
import { ToolError, defineTool } from "./types";

/* 每条用户消息可生成的图片张数上限。
   生图与其余写工具有一处根本不同：它不可撤销，且每次调用都直接花钱。
   轮次上限（8）与单轮调用数上限（20）都管不住跨轮累积——被提示注入策反的
   模型可以分八轮每轮画几张，用户看到的是一串卡片和一张账单。
   取 2 是因为「再画一张试试」是正常用法，「一口气画十张」不是。 */
export const MAX_IMAGES_PER_MESSAGE = 2;

const schema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("图像内容的详细描述：画面主体、风格、构图。写得越具体，出图越接近预期"),
});

/* 不设确认卡片：项目的不变量是「仅删除需确认」，生图不破坏任何数据，
   为它开一个口子会让确认这件事从「数据可能没了」滑向「凡是有代价的都问一句」。
   代价一侧改用张数封顶来管，见 MAX_IMAGES_PER_MESSAGE。 */
export const generateImageTool = defineTool({
  name: "generate_image",
  description:
    "根据文字描述生成一张图片，返回可直接写进笔记的 Markdown 引用。" +
    "生成会消耗用户的付费额度且无法撤销，只在用户明确要求配图或作图时调用，不要主动生成。" +
    "生成后若用户希望留存，用 append_to_note 追加到指定笔记，或用 create_note 新建一条。",
  schema,
  run: async ({ prompt }, ctx) => {
    const budget = ctx.imageBudget;
    if (budget) {
      if (budget.remaining <= 0) {
        return {
          content: `本条消息的生图额度已用完（上限 ${MAX_IMAGES_PER_MESSAGE} 张），本次未执行。如需继续，请让用户在下一条消息里提出。`,
          error: true,
        };
      }
      // 先扣再生成：失败也计数。否则一次出错就能靠重试把额度绕过去，
      // 而每次重试都是一次真实的付费请求
      budget.remaining -= 1;
    }

    try {
      const { buf, mime } = await generateImage(prompt, { signal: ctx.signal });
      const { url } = saveImage(ctx.db, buf, mime);
      const alt = prompt.trim().slice(0, 40);
      return {
        content:
          `已生成图片，Markdown 引用为：![${alt}](${url})\n` +
          `图片尚未存入任何笔记。用户若要留存，用 append_to_note 或 create_note 写入上面这段 Markdown。`,
        summary: `生成图片「${alt}」`,
        image: { url, alt },
      };
    } catch (e) {
      if (e instanceof ImageGenError) throw new ToolError(e.message);
      throw e;
    }
  },
});

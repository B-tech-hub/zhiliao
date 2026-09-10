import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const guide = fs.readFileSync(
  path.resolve(process.cwd(), "docs/首次使用与故障排查.md"),
  "utf8",
);

const documentFiles = ["README.md", "README.en.md", "docs/README.md", "docs/首次使用与故障排查.md"];

function relativeMarkdownTargets(file: string) {
  const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
  return [...source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((target) => !/^(?:[a-z]+:|#|\/\/)/i.test(target))
    .map((target) => target.split("#", 1)[0].split("?", 1)[0])
    .filter(Boolean)
    .map((target) => path.resolve(path.dirname(path.resolve(process.cwd(), file)), target));
}

describe("首次使用与故障排查教程", () => {
  it("覆盖从登录到搜索的主流程", () => {
    expect(guide).toContain("## 最短闭环：从登录到搜索");
    expect(guide).toContain("### 1. 登录");
    expect(guide).toContain("### 2. 新建普通文本笔记");
    expect(guide).toContain("### 3. 等待并确认 AI 整理状态");
    expect(guide).toContain("### 4. 打开主题");
    expect(guide).toContain("### 5. 完成一次搜索");
  });

  it("说明 AI 未配置和任务等待时的可恢复路径", () => {
    expect(guide).toContain("AI_NOT_CONFIGURED（教程内部标签）");
    expect(guide).toContain("TASK_WAITING（教程内部标签）");
    expect(guide).toContain("笔记仍已保存");
    expect(guide).toContain("重新处理");
    expect(guide).toContain("最多先等 **5 分钟**");
    expect(guide).toContain("保存失败，保留编辑内容");
  });

  it("覆盖部署故障与停止条件", () => {
    expect(guide).toContain("端口冲突");
    expect(guide).toContain("权限错误");
    expect(guide).toContain("HTTPS 不受信任");
    expect(guide).toContain("蜂窝网络不可达");
    expect(guide).toContain("停止条件");
  });

  it("链接到专项文档并声明实例隔离", () => {
    expect(guide).toContain("部署手册-tailscale.md");
    expect(guide).toContain("手机快捷记录.md");
    expect(guide).toContain("备份与恢复.md");
    expect(guide).toContain("Demo、正式和测试实例必须使用不同的数据目录、卷、端口与环境文件");
  });

  it("所有四份入口文档中的相对 Markdown 链接都指向存在的目标", () => {
    for (const file of documentFiles) {
      for (const target of relativeMarkdownTargets(file)) {
        expect(fs.existsSync(target), `${file} -> ${target}`).toBe(true);
      }
    }
  });

  it("锁定 v0.6.0、Demo 隔离和 Windows named volume 关键契约", () => {
    const root = process.cwd();
    const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
    const composeDemo = read("docker-compose.demo.yml");
    const composeWin = read("docker-compose.win.yml");
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    expect(guide).toContain("v0.6.0");
    expect(guide).toContain("docker compose logs --tail 50");
    expect(guide).toContain("DEMO_PASSWORD");
    expect(guide).toContain("先停止当前 Demo");
    expect(guide).toContain("named volume");
    expect(composeDemo).toContain("ghcr.io/b-tech-hub/zhiliao:0.6.0");
    expect(composeDemo).toContain("docker compose -f docker-compose.demo.yml down -v");
    expect(composeDemo).toContain("demo_db");
    expect(composeWin).toContain("kb_db:/data/db");
    expect(read("README.en.md")).toContain("docker-compose.win.yml");
    expect(read("README.md")).toContain("docker-compose.win.yml");
    expect(guide).toContain("docker compose -f docker-compose.yml -f docker-compose.win.yml");
    expect(composeWin).toContain("kb_uploads:/data/uploads");
    expect(packageJson.scripts.demo).toBe("node scripts/demo.mjs");
    expect(guide).toContain("源码 Demo 会受当前进程传入的 `APP_PASSWORD`、`PORT` 等环境变量影响");
  });
});

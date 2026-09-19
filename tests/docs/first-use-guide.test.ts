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

  it("区分 v0.6.0 使用教程与当前候选镜像，保留 Demo 和 Windows 数据隔离", () => {
    const root = process.cwd();
    const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
    const composeDemo = read("docker-compose.demo.yml");
    const composeWin = read("docker-compose.win.yml");
    const packageJson = JSON.parse(read("package.json")) as { version: string; scripts: Record<string, string> };

    expect(guide).toContain("v0.6.0");
    expect(guide).toContain("docker compose logs --tail 50");
    expect(guide).toContain("DEMO_PASSWORD");
    expect(guide).toContain("npm run demo:compose -- up -d");
    expect(guide).toContain("先停止当前 Demo");
    expect(guide).toContain("named volume");
    expect(composeDemo).toContain(`ghcr.io/b-tech-hub/zhiliao:${packageJson.version}`);
    expect(composeDemo).toContain("docker compose --env-file demo.env -p zhiliao-demo -f docker-compose.demo.yml down -v");
    expect(composeDemo).toContain("demo_db");
    expect(composeWin).toContain("kb_db:/data/db");
    expect(read("README.en.md")).toContain("docker-compose.win.yml");
    expect(read("README.md")).toContain("docker-compose.win.yml");
    expect(guide).toContain("docker compose -f docker-compose.yml -f docker-compose.win.yml");
    expect(composeWin).toContain("kb_uploads:/data/uploads");
    expect(packageJson.scripts.demo).toBe("node scripts/demo.mjs");
    expect(guide).toContain("源码启动器固定 `APP_PASSWORD=demo`");
    expect(guide).toContain("`PORT` 等未固定变量仍可透传");
    expect(guide).not.toContain("源码 Demo 会受当前进程传入的 `APP_PASSWORD`、`PORT` 等环境变量影响");
  });

  it("当前候选文档说明两条固定 mock 接线，并区分局部验证与实际启动", () => {
    for (const file of ["README.md", "README.en.md", "docs/首次使用与故障排查.md"]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source).toContain("DEMO_RUNTIME=local");
      expect(source).toContain("http://127.0.0.1:8787/v1");
      expect(source).toContain("http://mockllm:8787/v1");
      expect(source).toContain("APP_PASSWORD=demo");
      expect(source).toContain("#r1-source-demo");
      expect(source).toContain("v0.6.0");
    }
    expect(guide).toContain("缺省或非法标记均选择容器");
    expect(guide).toContain("已在 Windows 本机受控环境完成实际启动与浏览器验收");
    expect(guide).toContain("v0.6.0 源码 Demo 允许宿主环境覆盖");
    expect(fs.readFileSync(path.resolve(process.cwd(), "README.md"), "utf8"))
      .toContain("v0.6.0 源码启动器允许宿主环境覆盖");
    expect(fs.readFileSync(path.resolve(process.cwd(), "README.en.md"), "utf8"))
      .toContain("The v0.6.0 source launcher allows host values to override Demo defaults.");
  });

  it("旧版源码命令显式隔离 Markdown，并限定宿主和旧数据库的模型影响", () => {
    for (const file of ["README.md", "README.en.md", "docs/首次使用与故障排查.md"]) {
      const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
      const bash = [...source.matchAll(/```bash\n([\s\S]*?)```/g)]
        .map((match) => match[1]).find((block) => block.includes("git clone --branch v0.6.0"));
      expect(bash, file).toBeDefined();
      expect(bash).toContain("NOTES_EXPORT_DIR=./data-demo/notes");
      expect(bash).toContain("unset DEMO_MODE APP_PASSWORD SESSION_SECRET DATABASE_PATH UPLOAD_DIR");
      expect(bash).toContain("for demo_prefix in LLM EMBEDDING VISION IMAGE REASONING");
      expect(bash).toContain('unset "${demo_prefix}_BASE_URL" "${demo_prefix}_API_KEY" "${demo_prefix}_MODEL"');
      expect(bash).toContain("set -e");
      expect(source).toContain("./data/notes");
      expect(source).toContain("v060-source-demo-powershell");
      for (const prefix of ["LLM", "EMBEDDING", "VISION", "IMAGE", "REASONING"]) expect(source).toContain(`${prefix}_*`);
      expect(source).not.toContain("也不会发出任何外部请求");
      expect(source).not.toContain("未覆盖旧版默认数据路径时，演示数据在");
      expect(source).not.toContain("With the default data paths, delete `./data-demo/` to reset.");
    }
    expect(guide).toContain("全新独立目录和专用终端");
    expect(guide).toContain("已有 Demo 数据库中的模型配置");
    expect(guide).toContain("不能把只删除 `data-demo` 写成完整重置");
    const powershell = [...guide.matchAll(/```powershell\n([\s\S]*?)```/g)]
      .map((match) => match[1]).find((block) => block.includes("git clone --branch v0.6.0"));
    expect(powershell).toContain("$env:NOTES_EXPORT_DIR = './data-demo/notes'");
    expect(powershell).toContain("@('LLM', 'EMBEDDING', 'VISION', 'IMAGE', 'REASONING')");
    expect(powershell).toContain('Remove-Item -LiteralPath "Env:$demoKey"');
    expect(powershell).toContain("if ($LASTEXITCODE -ne 0)");
  });
});

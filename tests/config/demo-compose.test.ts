import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";
import { getLlmConfig } from "@/lib/llm-config";

const composePath = path.resolve(process.cwd(), "docker-compose.demo.yml");
const readmePath = path.resolve(process.cwd(), "README.md");
const englishReadmePath = path.resolve(process.cwd(), "README.en.md");
const nginxConfigPath = path.resolve(process.cwd(), "nginx/demo.conf");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Docker Demo 部署隔离", () => {
  const source = fs.readFileSync(composePath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");
  const englishReadme = fs.readFileSync(englishReadmePath, "utf8");
  const nginxConfig = fs.readFileSync(nginxConfigPath, "utf8");
  const compose = YAML.parse(source);
  const app = compose.services.app;
  const mock = compose.services.mockllm;
  const ingress = compose.services.ingress;

  it("实际 Compose 环境不传入宿主运行标记，配置层固定选择容器 mock", () => {
    expect(Array.isArray(app.environment)).toBe(false);
    expect(app.environment.DEMO_MODE).toBe("1");
    // 当前 Compose 依赖缺省容器模式；任何新增运行标记或宿主透传都必须重新审查。
    expect(app.environment).not.toHaveProperty("DEMO_RUNTIME");
    expect(JSON.stringify(app.environment)).not.toMatch(/\$\{?DEMO_RUNTIME\b/);
    vi.stubEnv("DEMO_RUNTIME", "local");
    // 容器只获得 Compose 注入的键，未声明的键不会继承宿主进程中的同名值。
    for (const key of ["DEMO_MODE", "DEMO_RUNTIME", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"]) {
      vi.stubEnv(key, app.environment[key]);
    }
    expect(getLlmConfig()).toMatchObject({ baseUrl: "http://mockllm:8787/v1", apiKey: "demo", model: "mock" });
  });

  it("使用独立网络、命名卷和 3210 端口", () => {
    expect(compose.name).toBe("zhiliao-demo");
    expect(compose.networks.demo_net.internal).toBe(true);
    expect(compose.networks.demo_net.driver_opts["com.docker.network.bridge.gateway_mode_ipv4"]).toBe("isolated");
    expect(compose.networks.ingress_net.internal).toBe(false);
    expect(app.networks).toEqual(["demo_net"]);
    expect(mock.networks).toEqual(["demo_net"]);
    expect(ingress.networks).toEqual(["ingress_net", "demo_net"]);
    expect(ingress.ports).toEqual(["127.0.0.1:3210:8080"]);
    expect(app.ports).toBeUndefined();
    expect(app.volumes).toEqual(["demo_db:/data/db", "demo_uploads:/data/uploads", "demo_notes:/data/notes"]);
    expect(mock.ports).toBeUndefined();
    expect(app.container_name).toBeUndefined();
    expect(app.depends_on).toEqual({ mockllm: { condition: "service_healthy" } });
    expect(ingress.depends_on).toEqual({ app: { condition: "service_healthy" } });
  });

  it("强制 Demo 密钥、mock LLM 和资源日志限制", () => {
    expect(app.environment.SESSION_SECRET).toContain("DEMO_SESSION_SECRET");
    expect(app.environment.LLM_BASE_URL).toBe("http://mockllm:8787/v1");
    expect(app.mem_limit).toBe("768m");
    expect(app.cpus).toBe(1);
    expect(app.pids_limit).toBe(128);
    expect(app.logging.options).toEqual({ "max-size": "10m", "max-file": "3" });
    expect(mock.mem_limit).toBe("256m");
    expect(mock.cpus).toBe(0.5);
    expect(mock.pids_limit).toBe(64);
    expect(mock.logging.options).toEqual({ "max-size": "5m", "max-file": "2" });
    expect(app.read_only).toBe(true);
    expect(mock.read_only).toBe(true);
    expect(ingress.mem_limit).toBe("128m");
    expect(ingress.cpus).toBe(0.25);
    expect(ingress.pids_limit).toBe(64);
    expect(ingress.user).toBe("101:101");
    expect(ingress.cap_drop).toEqual(["ALL"]);
    expect(ingress.security_opt).toEqual(["no-new-privileges:true"]);
    expect(app.user).toBe("node");
    expect(mock.user).toBe("node");
    expect(app.cap_drop).toEqual(["ALL"]);
    expect(mock.cap_drop).toEqual(["ALL"]);
    expect(app.security_opt).toEqual(["no-new-privileges:true"]);
    expect(mock.security_opt).toEqual(["no-new-privileges:true"]);
    expect(app.tmpfs).toEqual(["/tmp:size=64m,noexec,nosuid"]);
    expect(mock.tmpfs).toEqual(["/tmp:size=32m,noexec,nosuid"]);
    expect(ingress.volumes).toEqual(["./nginx/demo.conf:/etc/nginx/nginx.conf:ro"]);
    expect(ingress.tmpfs).toEqual([
      "/tmp:size=16m,uid=101,gid=101,noexec,nosuid",
      "/var/cache/nginx:size=256m,uid=101,gid=101,noexec,nosuid",
    ]);
    expect(nginxConfig).toContain("worker_connections 256;");
    expect(nginxConfig).toContain("limit_conn_zone $binary_remote_addr zone=demo_conn:10m;");
    expect(nginxConfig).toContain("limit_req_zone $demo_req_key zone=demo_req:10m rate=10r/s;");
    expect(nginxConfig).toContain("client_max_body_size 8m;");
    expect(nginxConfig).toContain("location = /api/import");
    expect(nginxConfig).toContain("client_max_body_size 200m;");
    expect(nginxConfig).toContain("location = /api/uploads");
    expect(nginxConfig).toContain("client_max_body_size 25m;");
    expect(nginxConfig).toContain("proxy_request_buffering off;");
    expect(nginxConfig).toContain("proxy_buffering off;");
    expect(nginxConfig).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(nginxConfig).toContain("proxy_pass http://zhiliao_app;");
    expect(app.healthcheck.test[0]).toBe("CMD");
    expect(app.healthcheck.test[1]).toBe("node");
    expect(app.healthcheck.test[3]).toContain("/api/healthz");
    expect(mock.healthcheck.test[0]).toBe("CMD");
  });

  it("仅从规范化路径生成请求限流 key，动态请求和连接限制继续在 server 层生效", () => {
    const requestMap = nginxConfig.match(/map\s+\$uri\s+\$demo_req_key\s*\{([^}]+)\}/);
    expect(requestMap).not.toBeNull();
    if (!requestMap) throw new Error("缺少静态资源限流映射");
    const rules = requestMap[1].replace(/#.*$/gm, "").split(";").map((rule) => rule.trim()).filter(Boolean);
    expect(rules).toEqual(["default $binary_remote_addr", '~^/_next/static/ ""']);
    const serverLimits = nginxConfig.match(/server\s*\{([\s\S]*?)location\b/)?.[1];
    expect(serverLimits).toContain("limit_req zone=demo_req burst=40 nodelay;");
    expect(serverLimits).toContain("limit_conn demo_conn 32;");
    expect(nginxConfig.match(/\blimit_req\s/g)).toHaveLength(1);
    expect(nginxConfig.match(/\blimit_conn\s/g)).toHaveLength(1);
  });

  it.each([
    ["/_next/static/chunks/app/(app)/page.js", true],
    ["/_next/static/css/app.css", true],
    ["/_next/static/media/font.woff2", true],
    ["/", false],
    ["/login", false],
    ["/settings", false],
    ["/api/healthz", false],
    ["/api/import", false],
    ["/api/uploads", false],
    ["/api/example.js", false],
    ["/_next/image", false],
    ["/_next/data/build/page.json", false],
    ["/_next/static", false],
    ["/_next/staticx/chunks/app.js", false],
    ["/_NEXT/static/chunks/app.js", false],
  ] as const)("静态豁免边界：%s → %s", (uri, exempt) => {
    const requestMap = nginxConfig.match(/map\s+\$uri\s+\$demo_req_key\s*\{([^}]+)\}/);
    if (!requestMap) throw new Error("缺少静态资源限流映射");
    const patterns = [...requestMap[1].matchAll(/~(\S+)\s+""\s*;/g)].map((match) => new RegExp(match[1]));
    // 读取配置中的规则检查路径边界；真实 Nginx 的计数和 URI 规范化另做运行对照。
    expect(patterns.some((pattern) => pattern.test(uri))).toBe(exempt);
  });

  it("不包含正式目录、正式环境文件或固定会话密钥", () => {
    expect(source).not.toMatch(/(?:env_file|\.\/data\/(?:db|uploads|notes)|container_name)/);
    expect(source).not.toContain("zhiliao-demo-session-secret-0123");
    expect(readme).toContain("npm run demo:compose -- up -d");
    expect(englishReadme).toContain("npm run demo:compose -- up -d");
    expect(readme).toContain("docker compose --env-file demo.env -p zhiliao-demo");
    expect(englishReadme).toContain("docker compose --env-file demo.env -p zhiliao-demo");
    expect(readme).not.toMatch(/docker compose -p zhiliao-demo -f docker-compose\.demo\.yml/);
    expect(englishReadme).not.toMatch(/docker compose -p zhiliao-demo -f docker-compose\.demo\.yml/);
    const dockerIgnore = fs.readFileSync(path.resolve(process.cwd(), ".dockerignore"), "utf8").split(/\r?\n/);
    expect(dockerIgnore).toEqual(expect.arrayContaining([
      ".env", ".env.*", "demo.env", "demo.env.*", "*.env", "data", "data-*", "_bmad-output",
      ".npmrc", "*.pem", "*.key", "secrets.*", "credentials.*", "local-config.*", ".aws", ".ssh",
    ]));
  });

});

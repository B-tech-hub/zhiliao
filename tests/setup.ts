// 测试环境注入：setupFiles 在任何被测模块加载前执行。
// vitest 不加载 .env 文件，本机真实配置不会泄入测试。
process.env.DATABASE_PATH = ":memory:";
process.env.SESSION_SECRET = "vitest-secret-0123456789abcdef";
// 提供 LLM 三项使 isLlmConfigured() 为真；实际请求在用例中以 stub fetch 拦截，不会真发网络
process.env.LLM_BASE_URL = "http://127.0.0.1:9/v1";
process.env.LLM_API_KEY = "test-key";
process.env.LLM_MODEL = "test-model";

// isolatedModules 要求所有 .ts 文件都是模块
export {};

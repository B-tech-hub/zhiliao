import { LoginForm } from "./login-form";

// 强制动态：DEMO_MODE 是运行时环境变量（Docker 镜像构建期不含它），静态化会把提示固化为关闭
export const dynamic = "force-dynamic";

// 服务端组件：读取 DEMO_MODE 决定是否展示体验模式的密码提示，表单逻辑在客户端子组件
export default function LoginPage() {
  return <LoginForm demoHint={process.env.DEMO_MODE === "1"} />;
}

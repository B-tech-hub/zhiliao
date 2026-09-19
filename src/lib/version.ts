import { version } from "../../package.json";

// 静态导入随应用打包，避免读取 standalone 裁剪后的包文件或启动环境变量。
export const APP_VERSION = version;

import path from "node:path";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";
import { ControlledReporter, ControlledSequencer } from "./scripts/pwsh-preview-observer.mjs";

const group = process.env.ZHILIAO_PREVIEW_GROUP;
const output = process.env.ZHILIAO_PREVIEW_CONTROL_DIR;
if (!group || !["A", "B", "D"].includes(group) || !output || !path.isAbsolute(output)) {
  throw new Error("缺少受控实验身份或仓库外的诊断目录");
}

export default defineConfig({
  ...base,
  cacheDir: path.join(output, "vite-cache"),
  test: {
    ...base.test,
    ...(group === "D" ? {} : { include: ["tests/config/smoke-fresh-install.test.ts"], maxWorkers: 1, fileParallelism: false }),
    sequence: { sequencer: ControlledSequencer },
    reporters: ["default", "json", new ControlledReporter()],
    outputFile: { json: path.join(output, "vitest.json") },
  },
});

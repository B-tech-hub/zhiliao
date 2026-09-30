import fs from "node:fs";
import path from "node:path";
import { BaseSequencer } from "vitest/node";

const target = "tests/config/smoke-fresh-install.test.ts";
const relative = (name) => path.relative(process.cwd(), name).split(path.sep).join("/");
const record = (entry) => fs.appendFileSync(path.join(process.env.ZHILIAO_PREVIEW_CONTROL_DIR, "events.jsonl"),
  `${JSON.stringify({ utc_ms: Date.now(), ...entry })}\n`);

export class ControlledSequencer extends BaseSequencer {
  async sort(files) {
    // 固定清单顺序，不读取上轮成功/失败缓存；实际派发仍单独记录。
    const result = [...files].sort((a, b) => {
      const left = relative(a.moduleId);
      const right = relative(b.moduleId);
      if (left === target) return -1;
      if (right === target) return 1;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    record({ event: "sequence", files: result.map((spec) => relative(spec.moduleId)) });
    return result;
  }
}

export class ControlledReporter {
  onInit(context) {
    record({ event: "config", pool: context.config.pool, max_workers_setting: context.config.maxWorkers ?? null,
      file_parallelism: context.config.fileParallelism, projects: context.projects.map((project) => ({
        name: project.name, max_workers_setting: project.config.maxWorkers ?? null, pool: project.config.pool,
      })) });
  }
  onTestModuleQueued(module) { record({ event: "module-queued", module: relative(module.moduleId) }); }
  onTestModuleCollected(module) { record({ event: "module-collected", module: relative(module.moduleId) }); }
  onTestModuleStart(module) { record({ event: "module-start", module: relative(module.moduleId) }); }
  onTestModuleEnd(module) { record({ event: "module-end", module: relative(module.moduleId) }); }
  onTestRunEnd(_modules, errors, reason) { record({ event: "run-end", unhandled_errors: errors.length, reason }); }
}

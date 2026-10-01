import fs from "node:fs";
import path from "node:path";
import { BaseSequencer, ForksPoolWorker } from "vitest/node";

const target = "tests/config/smoke-fresh-install.test.ts";
const relative = (name) => path.relative(process.cwd(), name).split(path.sep).join("/");
const record = (entry) => fs.appendFileSync(path.join(process.env.ZHILIAO_PREVIEW_CONTROL_DIR, "events.jsonl"),
  `${JSON.stringify({ utc_ms: Date.now(), ...entry })}\n`);

// BEGIN SEND HOOK
export function installSendObserver(prototype, emit, identity, normalize, clock = () => process.hrtime.bigint().toString()) {
  const marker = Symbol.for("zhiliao.preview.send-observer");
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "send");
  if (!descriptor || typeof descriptor.value !== "function" || !descriptor.writable || descriptor.value[marker]) {
    throw new Error("发送接口不符或重复安装");
  }
  if (!identity.sample || !identity.protocol || !Number.isInteger(identity.parent_pid) || identity.parent_pid <= 0) {
    throw new Error("发送采集身份缺失");
  }
  const original = descriptor.value;
  let sequence = 0;
  let failure;
  let restored = false;
  function write(entry) {
    try { emit({ ...identity, monotonic_ns: clock(), ...entry }); }
    catch (error) { failure ??= error; throw error; }
  }
  function wrapped(...args) {
    const message = args[0];
    if (message?.__vitest_worker_request__ !== true || message.type !== "run") {
      return Reflect.apply(original, this, args);
    }
    if (failure) throw failure;
    const context = message.context;
    if (!Number.isInteger(context?.workerId) || context.workerId < 0 || !Array.isArray(context.files) || !context.files.length
      || context.files.some((file) => typeof file.filepath !== "string" || !file.filepath)) {
      failure = new Error("run 请求接口不符");
      throw failure;
    }
    const entry = { sequence: ++sequence, worker_id: context.workerId, files: context.files.map((file) => normalize(file.filepath)) };
    write({ event: "send-begin", ...entry });
    let result;
    try { result = Reflect.apply(original, this, args); }
    catch (error) {
      failure = error;
      // 记录失败不能覆盖原发送异常；缺少结束记录也会被收口拒绝。
      try { write({ event: "send-end", ...entry, outcome: "throw", error: String(error) }); } catch {}
      throw error;
    }
    write({ event: "send-end", ...entry, outcome: "returned" });
    return result;
  }
  Object.defineProperty(wrapped, marker, { value: true });
  Object.defineProperty(prototype, "send", { ...descriptor, value: wrapped });
  try { write({ event: "send-hook-installed" }); }
  catch (error) { Object.defineProperty(prototype, "send", descriptor); throw error; }
  return () => {
    if (restored) throw new Error("发送钩子重复恢复");
    restored = true;
    if (prototype.send !== wrapped) throw new Error("发送钩子所有者变化，未覆盖其他方法");
    Object.defineProperty(prototype, "send", descriptor);
    if (failure) throw failure;
    write({ event: "send-hook-restored", calls: sequence });
  };
}
// END SEND HOOK

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
    if (context.config.pool !== "forks") throw new Error("本批仅允许内建 forks");
    this.restoreSend = installSendObserver(ForksPoolWorker.prototype, record, {
      parent_pid: process.pid, sample: process.env.ZHILIAO_PREVIEW_SAMPLE,
      protocol: process.env.ZHILIAO_PREVIEW_PROTOCOL,
    }, relative);
    record({ event: "config", pool: context.config.pool, max_workers_setting: context.config.maxWorkers ?? null,
      file_parallelism: context.config.fileParallelism, projects: context.projects.map((project) => ({
        name: project.name, max_workers_setting: project.config.maxWorkers ?? null, pool: project.config.pool,
      })) });
  }
  onTestModuleQueued(module) { record({ event: "module-queued", module: relative(module.moduleId) }); }
  onTestModuleCollected(module) { record({ event: "module-collected", module: relative(module.moduleId) }); }
  onTestModuleStart(module) { record({ event: "module-start", module: relative(module.moduleId) }); }
  onTestModuleEnd(module) { record({ event: "module-end", module: relative(module.moduleId) }); }
  onTestRunEnd(_modules, errors, reason) {
    this.restoreSend();
    record({ event: "run-end", unhandled_errors: errors.length, reason });
  }
}

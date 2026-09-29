const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const original = childProcess.spawnSync;
childProcess.spawnSync = function (command, args, options) {
  const observed = Array.isArray(args) && args.some((arg) => typeof arg === "string" && path.basename(arg) === "preview.ps1");
  if (!observed) return original.apply(this, arguments);
  const started = process.hrtime.bigint();
  const result = original.apply(this, arguments);
  const argumentsFile = args[args.indexOf("-ArgumentsFile") + 1];
  const input = JSON.parse(fs.readFileSync(argumentsFile, "utf8"));
  fs.appendFileSync(path.join(__dirname, "preview-processes.jsonl"), JSON.stringify({
    image: input.Image ?? "default",
    executable: path.basename(command),
    duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
    timeout_ms: options.timeout,
    status: result.status,
    signal: result.signal,
    error_code: result.error?.code ?? null,
  }) + "\n");
  return result;
};
require("node:module").syncBuiltinESMExports();

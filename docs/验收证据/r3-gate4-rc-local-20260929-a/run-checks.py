import datetime
import json
import os
from pathlib import Path
import subprocess
import time

evidence = Path(__file__).resolve().parent
plan = json.loads((evidence / "verification-inputs.json").read_text(encoding="utf-8"))
work = Path(plan["work"])
tool = json.loads((evidence / "application.json").read_text(encoding="utf-8"))["actionlint"]
# 仅保留系统运行所需变量，不透传模型、应用凭据或 npm 用户配置。
allowed = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "SYSTEMDRIVE", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"}
env = {key: value for key, value in os.environ.items() if key.upper() in allowed}
env.update(TEMP=plan["fixture_temp"], TMP=plan["fixture_temp"], NO_COLOR="1")
node = plan["node"]
checks = [
    ("tests", [node, "node_modules/vitest/vitest.mjs", "run", "tests/config/release-gate4.test.ts", "tests/config/release-version.test.ts", "--maxWorkers=1", "--no-file-parallelism", "--reporter=default", "--reporter=json", "--outputFile=" + str(evidence / "tests.json")]),
    ("eslint", [node, "node_modules/eslint/bin/eslint.js", "tests/config/release-gate4.test.ts", "tests/config/release-version.test.ts"]),
    ("actionlint", [tool, "-shellcheck=", "-pyflakes=", "-no-color", ".github/workflows/release.yml"]),
    ("version", [node, plan["npm_cli"], "run", "check:version"]),
    ("version-rc", [node, plan["npm_cli"], "run", "check:version", "--", "--tag", "v0.6.1-rc1"]),
]
results = []
start_all = time.monotonic()
for name, command in checks:
    remaining = 600 - (time.monotonic() - start_all)
    if remaining <= 0:
        results.append({"name": name, "status": "not-run-total-budget"})
        break
    start = time.monotonic()
    entry = {"name": name, "command": command, "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    with (evidence / (name + ".log")).open("wb") as log:
        process = subprocess.Popen(command, cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            entry["exit_code"] = process.wait(timeout=min(120, remaining))
            entry["status"] = "passed" if entry["exit_code"] == 0 else "failed"
        except subprocess.TimeoutExpired:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
            process.wait(timeout=10)
            entry.update(status="timeout", exit_code=process.returncode)
    entry["seconds"] = round(time.monotonic() - start, 3)
    results.append(entry)
    (evidence / "checks.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(entry, ensure_ascii=False), flush=True)
    if entry["status"] != "passed":
        break
completed = {item["name"] for item in results}
for name, _ in checks:
    if name not in completed:
        results.append({"name": name, "status": "not-run-after-stop"})
(evidence / "checks.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
raise SystemExit(0 if all(item["status"] == "passed" for item in results) else 1)

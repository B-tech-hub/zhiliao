"""本轮门禁的隔离复制、命令留证与输入核对。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parents[1]
RUN = Path(tempfile.gettempdir()) / "zhiliao-release-gates-061-20260929-a"
COPY = RUN / "candidate"
OLD = ROOT / "docs/验收证据/0.6.1-heic-read-2026-09-27/candidate-inputs.json"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(name, value):
    target = EVIDENCE / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], creationflags=subprocess.CREATE_NO_WINDOW)


def files_manifest(paths, root):
    return [{"path": p, "bytes": (root / p).stat().st_size, "sha256": sha(root / p)} for p in paths]


def prepare():
    if RUN.exists():
        raise RuntimeError("本轮目录已经存在，拒绝覆盖")
    RUN.mkdir()
    COPY.mkdir()
    tracked = sorted(git("ls-files", "-z").decode("utf-8").rstrip("\0").split("\0"))
    forbidden = [p for p in tracked if p.split("/")[0].startswith("data") or (p.startswith(".env") and p != ".env.example")]
    if forbidden:
        raise RuntimeError("发现不允许复制的已跟踪文件")
    baseline = files_manifest(tracked, ROOT)
    save("workspace-before.json", {"head": git("rev-parse", "HEAD").decode().strip(), "files": baseline})
    (EVIDENCE / "existing-changes.patch").write_bytes(git("diff", "--", "eslint.config.mjs", "tests/config/demo-verification-utils.test.ts"))
    for relative in tracked:
        target = COPY / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    save("copy.json", {"path": str(COPY), "tracked_file_count": len(tracked), "env_files": [], "data_directories": [], "next_env_copied": False, "dependency_source": "本机 node_modules 独立复制；不构成 npm ci 或无缓存安装证据"})
    print(json.dumps({"candidate": str(COPY), "files": len(tracked)}, ensure_ascii=False))


def freeze():
    old = json.loads(OLD.read_text(encoding="utf-8"))
    paths = [entry["path"] for entry in old["files"] if entry["path"] != "next-env.d.ts"]
    entries = files_manifest(paths, COPY)
    old_by_path = {entry["path"]: entry for entry in old["files"]}
    changed = [entry["path"] for entry in entries if entry["sha256"] != old_by_path[entry["path"]]["sha256"]]
    tracked = sorted(git("ls-files", "-z").decode("utf-8").rstrip("\0").split("\0"))
    save("gate-inputs.json", {"scope": "隔离副本的全部已跟踪输入，含门禁读取的文档与 CI 配置", "files": files_manifest(tracked, COPY)})
    save("candidate-inputs.json", {"schema": 1, "kind": "release-gate-source-inputs", "source_head": git("rev-parse", "HEAD").decode().strip(), "working_tree_included": True, "generated_excluded": ["next-env.d.ts"], "old_manifest_sha256": sha(OLD), "changed_from_old": changed, "files": entries})
    save("candidate-identity.json", {"kind": "isolated-source-validation", "source_head": git("rev-parse", "HEAD").decode().strip(), "manifest_sha256": sha(EVIDENCE / "candidate-inputs.json"), "gate_inputs_sha256": sha(EVIDENCE / "gate-inputs.json"), "file_count": len(entries), "image_built": False, "platform": "win32/x64", "copy": str(COPY)})
    print(json.dumps({"manifest_sha256": sha(EVIDENCE / "candidate-inputs.json"), "changed": changed}, ensure_ascii=False))


def clean_env():
    allowed = {"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA", "SYSTEMDRIVE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"}
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env.update({"CI": "1", "NEXT_TELEMETRY_DISABLED": "1", "REQUIRE_DOCKER_COMPOSE": "1", "CIRCLE_NODE_TOTAL": "2", "DATABASE_PATH": str(RUN / "data/db/app.db"), "UPLOAD_DIR": str(RUN / "data/uploads"), "NOTES_EXPORT_DIR": str(RUN / "data/notes"), "APP_PASSWORD": "isolated-release-gate-fixture", "SESSION_SECRET": "isolated-release-gate-session-fixture-20260929", "NO_COLOR": "1"})
    return env


def execute(stage):
    node = Path(shutil.which("node"))
    npm = node.parent / "node_modules/npm/bin/npm-cli.js"
    commands = {
        "target-test": [str(node), "node_modules/vitest/vitest.mjs", "run", "tests/config/demo-verification-utils.test.ts", "--maxWorkers=1", "--no-file-parallelism"],
        "target-lint": [str(node), "node_modules/eslint/bin/eslint.js", "eslint.config.mjs", "tests/config/demo-verification-utils.test.ts"],
        "version": [str(node), str(npm), "run", "check:version"],
        "version-rc": [str(node), str(npm), "run", "check:version", "--", "--tag", "v0.6.1-rc1"],
        "design": [str(node), str(npm), "run", "check:design"],
        "lint": [str(node), str(npm), "run", "lint"],
        "test": [str(node), str(npm), "test", "--", "--maxWorkers=1", "--no-file-parallelism", "--reporter=default", "--reporter=json", "--outputFile.json=" + str(EVIDENCE / "test-results.json")],
        "build": [str(node), str(npm), "run", "build"],
        "diagnose-before": [str(node), "node_modules/vitest/vitest.mjs", "run", "tests/components/settings-page-demo.test.tsx", "tests/config/demo-http-probes.test.ts", "tests/components/markdown-editor-security.test.tsx", "--maxWorkers=1", "--no-file-parallelism", "--reporter=default", "--reporter=json", "--outputFile.json=" + str(EVIDENCE / "diagnose-before-results.json")],
    }
    commands["regression-after"] = [str(node), "node_modules/vitest/vitest.mjs", "run", "tests/components/settings-page-demo.test.tsx", "tests/config/demo-http-probes.test.ts", "tests/components/markdown-editor-security.test.tsx", "tests/config/demo-verification-utils.test.ts", "--maxWorkers=1", "--no-file-parallelism", "--reporter=default", "--reporter=json", "--outputFile.json=" + str(EVIDENCE / "regression-after-results.json")]
    for original in ["version", "version-rc", "design", "lint", "test"]:
        commands[original + "-final"] = [part.replace("test-results.json", "test-final-results.json") for part in commands[original]]
    record = EVIDENCE / "commands" / (stage + ".json")
    if record.exists():
        raise RuntimeError("该阶段已有记录；复验必须使用单独记录")
    record.parent.mkdir(parents=True, exist_ok=True)
    command = commands[stage]
    cwd = ROOT if stage in ["version-final", "version-rc-final"] else COPY
    started = datetime.now(timezone.utc).isoformat()
    clock = time.monotonic()
    print("开始 " + stage, flush=True)
    with record.with_suffix(".stdout.log").open("wb") as stdout, record.with_suffix(".stderr.log").open("wb") as stderr:
        result = subprocess.run(command, cwd=cwd, env=clean_env(), stdout=stdout, stderr=stderr, creationflags=subprocess.CREATE_NO_WINDOW)
    report = {"stage": stage, "command": command, "cwd": str(cwd), "started_at": started, "finished_at": datetime.now(timezone.utc).isoformat(), "duration_seconds": round(time.monotonic() - clock, 3), "exit_code": result.returncode, "manifest_sha256": sha(EVIDENCE / "candidate-inputs.json"), "node": subprocess.check_output([str(node), "--version"], creationflags=subprocess.CREATE_NO_WINDOW).decode().strip(), "environment": {k: v for k, v in clean_env().items() if k in ["CI", "NEXT_TELEMETRY_DISABLED", "REQUIRE_DOCKER_COMPOSE", "CIRCLE_NODE_TOTAL", "DATABASE_PATH", "UPLOAD_DIR", "NOTES_EXPORT_DIR"]}}
    save("commands/" + stage + ".json", report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    for path in [record.with_suffix(".stdout.log"), record.with_suffix(".stderr.log")]:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        print("\n".join(lines[-35:]))
    sys.exit(result.returncode)


def compare():
    manifest = json.loads((EVIDENCE / "candidate-inputs.json").read_text(encoding="utf-8"))
    mismatches = [entry["path"] for entry in manifest["files"] if sha(COPY / entry["path"]) != entry["sha256"]]
    generated = COPY / "next-env.d.ts"
    if generated.exists():
        shutil.copy2(generated, EVIDENCE / "next-env.generated.txt")
    save("input-check.json", {"source_mismatches": mismatches, "next_env_generated": generated.exists(), "next_env_sha256": sha(generated) if generated.exists() else None, "old_manifest_unchanged": sha(OLD) == manifest["old_manifest_sha256"]})
    print(json.dumps({"source_mismatches": mismatches, "next_env_generated": generated.exists()}, ensure_ascii=False))


def dependencies():
    lock = json.loads((COPY / "package-lock.json").read_text(encoding="utf-8"))
    installed, absent, mismatches = [], [], []
    for relative, expected in lock["packages"].items():
        if not relative:
            continue
        package = COPY / relative / "package.json"
        if not package.exists():
            absent.append({"path": relative, "optional": expected.get("optional", False), "os": expected.get("os"), "cpu": expected.get("cpu")})
            continue
        actual = json.loads(package.read_text(encoding="utf-8"))["version"]
        entry = {"path": relative, "expected": expected.get("version"), "actual": actual}
        installed.append(entry)
        if actual != expected.get("version"):
            mismatches.append(entry)
    save("installed-versions.json", {"checked": len(installed), "mismatches": mismatches, "absent": absent, "installed": installed})
    print(json.dumps({"checked": len(installed), "mismatches": mismatches, "absent": len(absent)}, ensure_ascii=False))


def closeout():
    source = json.loads((EVIDENCE / "candidate-inputs.json").read_text(encoding="utf-8"))
    before = json.loads((EVIDENCE / "workspace-before.json").read_text(encoding="utf-8"))
    gate_inputs = json.loads((EVIDENCE / "gate-inputs.json").read_text(encoding="utf-8"))
    changed_files = ["eslint.config.mjs", "tests/config/demo-verification-utils.test.ts", "tests/components/settings-page-demo.test.tsx", "tests/config/demo-http-probes.test.ts"]
    (EVIDENCE / "final-source.patch").write_bytes(git("diff", "--binary", "HEAD", "--", *changed_files))
    root_mismatches = [entry["path"] for entry in source["files"] if sha(ROOT / entry["path"]) != entry["sha256"]]
    copy_mismatches = [entry["path"] for entry in gate_inputs["files"] if sha(COPY / entry["path"]) != entry["sha256"]]
    root_changes = [entry["path"] for entry in before["files"] if sha(ROOT / entry["path"]) != entry["sha256"]]
    old_source = json.loads(OLD.read_text(encoding="utf-8"))
    old_generated = next(entry for entry in old_source["files"] if entry["path"] == "next-env.d.ts")
    protected = [entry["path"] for entry in before["files"] if entry["path"].startswith(("src/", "public/", "scripts/", "docs/验收证据/")) or entry["path"] in ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "_bmad-output/implementation-artifacts/sprint-status.yaml"]]
    protected_changes = sorted(set(root_changes) & set(protected))
    production_path = EVIDENCE / "production-after.txt"
    if not production_path.exists():
        production = subprocess.check_output(["docker", "inspect", "zhiliao", "--format", "{{json .Id}} {{json .State.StartedAt}} {{json .RestartCount}} {{json .Mounts}}"], creationflags=subprocess.CREATE_NO_WINDOW).decode("utf-8").strip()
        production_path.write_text(production + "\n", encoding="utf-8", newline="\n")
    production = production_path.read_text(encoding="utf-8").strip()
    production_before = (EVIDENCE / "production-before.txt").read_text(encoding="utf-8").strip()

    def normalize_production(value):
        fields = []
        decoder = json.JSONDecoder()
        while value.strip():
            field, end = decoder.raw_decode(value.lstrip())
            fields.append(field)
            value = value.lstrip()[end:]
        if len(fields) != 4:
            raise RuntimeError("正式容器快照格式不符")
        fields[3] = sorted(fields[3], key=lambda mount: mount["Destination"])
        return fields

    production_same = normalize_production(production) == normalize_production(production_before)
    allowed_docs = ["CHANGELOG.md", "CONTRIBUTING.md", "docs/0.6.1候选定稿-2026-09-28.md", "docs/README.md", "docs/releases/v0.6.1.md", "docs/产品规划/开源发布范围与执行清单-2026-09-13.md"]
    unexpected = sorted(set(root_changes) - set(changed_files + allowed_docs))
    protection = {"head_unchanged": git("rev-parse", "HEAD").decode().strip() == before["head"], "workspace_source_matches_final": not root_mismatches, "workspace_source_mismatches": root_mismatches, "copy_input_mismatches": copy_mismatches, "protected_tracked_file_count": len(protected), "protected_tracked_changes": protected_changes, "original_next_env_unchanged": sha(ROOT / "next-env.d.ts") == old_generated["sha256"], "production_raw_order_equal": production == production_before, "production_identity_started_at_restart_mounts_unchanged": production_same, "changed_tracked_files_since_start": root_changes, "unexpected_tracked_changes": unexpected, "old_manifest_unchanged": sha(OLD) == source["old_manifest_sha256"]}
    save("protection-check.json", protection)
    stages = [json.loads((EVIDENCE / "commands" / (name + ".json")).read_text(encoding="utf-8")) for name in ["design-final", "lint-final", "test-final", "build"]]
    tests = json.loads((EVIDENCE / "test-final-results.json").read_text(encoding="utf-8"))
    passed = all(stage["exit_code"] == 0 and stage["manifest_sha256"] == sha(EVIDENCE / "candidate-inputs.json") for stage in stages)
    passed = passed and not root_mismatches and not copy_mismatches and not protected_changes and not unexpected and production_same and protection["head_unchanged"] and protection["original_next_env_unchanged"] and protection["old_manifest_unchanged"]
    save("summary.json", {"status": "passed" if passed else "failed", "scope": "门禁 3：Windows x64 隔离源码验证，不是发布", "source_head": before["head"], "working_tree_included": True, "source_manifest_sha256": sha(EVIDENCE / "candidate-inputs.json"), "gate_inputs_sha256": sha(EVIDENCE / "gate-inputs.json"), "source_patch_sha256": sha(EVIDENCE / "final-source.patch"), "source_changes_from_old_candidate": source["changed_from_old"], "gates": [{k: stage[k] for k in ["stage", "exit_code", "duration_seconds", "manifest_sha256"]} for stage in stages], "tests": {"passed": tests["numPassedTests"], "failed": tests["numFailedTests"], "skipped": tests["numPendingTests"], "total": tests["numTotalTests"]}, "remaining_gates": [4, 5, 6]})
    print(json.dumps({"status": "passed" if passed else "failed", "root_mismatches": root_mismatches, "copy_mismatches": copy_mismatches, "protected_changes": protected_changes, "production_same": production_same}, ensure_ascii=False))
    if not passed:
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "freeze", "run", "compare", "dependencies", "closeout"])
    parser.add_argument("stage", nargs="?")
    args = parser.parse_args()
    if args.action == "run":
        execute(args.stage)
    else:
        {"prepare": prepare, "freeze": freeze, "compare": compare, "dependencies": dependencies, "closeout": closeout}[args.action]()

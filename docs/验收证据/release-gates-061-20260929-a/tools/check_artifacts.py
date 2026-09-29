"""静态核对本轮文档、补丁复现和门禁范围，不重跑产品验证。"""
import json
import hashlib
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote

sys.dont_write_bytecode = True
from gates import COPY, EVIDENCE, ROOT, RUN, git, save, sha

summary = json.loads((EVIDENCE / "summary.json").read_text(encoding="utf-8"))
manifest = json.loads((EVIDENCE / "candidate-inputs.json").read_text(encoding="utf-8"))
changed = manifest["changed_from_old"]
patch_root = RUN / "patch-reproduction-repository"
if not patch_root.exists():
    patch_root.mkdir()
    # 临时目录可能位于宿主的另一个仓库内，必须建立独立仓库，避免 git apply 静默跳过。
    subprocess.run(["git", "init", "--quiet"], cwd=patch_root, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    (patch_root / ".gitattributes").write_bytes((ROOT / ".gitattributes").read_bytes())
    for relative in changed:
        target = patch_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git("show", summary["source_head"] + ":" + relative))
    subprocess.run(["git", "apply", "--check", str(EVIDENCE / "final-source.patch")], cwd=patch_root, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    subprocess.run(["git", "apply", str(EVIDENCE / "final-source.patch")], cwd=patch_root, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
patch_mismatches = [relative for relative in changed if sha(patch_root / relative) != sha(ROOT / relative)]

binding_path = EVIDENCE / "source-commit.json"
revision = json.loads(binding_path.read_text(encoding="utf-8"))["revision"] if binding_path.exists() else git("rev-parse", "HEAD").decode().strip()
tree = {}
for item in git("ls-tree", "-r", "-z", revision).split(b"\0"):
    if item:
        metadata, name = item.split(b"\t", 1)
        tree[name.decode("utf-8")] = metadata.split()[2].decode()
commit_mismatches = []
line_ending_differences = []
for entry in manifest["files"]:
    raw = (ROOT / entry["path"]).read_bytes()
    blob = hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()
    if sha(ROOT / entry["path"]) != entry["sha256"]:
        commit_mismatches.append(entry["path"])
        continue
    if tree.get(entry["path"]) != blob:
        committed = git("show", revision + ":" + entry["path"])
        attributes = git("check-attr", "-z", "text", "eol", "--", entry["path"]).split(b"\0")
        attributes = {attributes[i + 1].decode(): attributes[i + 2].decode() for i in range(0, len(attributes) - 1, 3)}
        # 只接受现有 Git 属性允许、且可双向逐字节复现的纯 CRLF/LF 差异。
        if attributes == {"text": "auto", "eol": "lf"} and raw.replace(b"\r\n", b"\n") == committed and committed.replace(b"\n", b"\r\n") == raw:
            line_ending_differences.append({"path": entry["path"], "validated_sha256": entry["sha256"], "committed_sha256": hashlib.sha256(committed).hexdigest(), "validated_bytes": len(raw), "committed_bytes": len(committed), "crlf_count": raw.count(b"\r\n"), "git_attributes": attributes, "reconstruction": "committed bytes: replace LF with CRLF", "raw_bytes_reproduced": True})
        else:
            commit_mismatches.append(entry["path"])
save("source-commit.json", {"revision": revision, "source_manifest_sha256": sha(EVIDENCE / "candidate-inputs.json"), "checked_files": len(manifest["files"]), "byte_identical_files": len(manifest["files"]) - len(line_ending_differences) - len(commit_mismatches), "line_ending_differences": line_ending_differences, "mismatches": commit_mismatches, "generated_files_excluded": ["next-env.d.ts"]})

tracked_changes = git("diff", "--name-only", "-z", "HEAD").decode("utf-8").rstrip("\0").split("\0")
untracked = git("ls-files", "--others", "--exclude-standard", "-z").decode("utf-8").rstrip("\0").split("\0")
markdown = sorted({path for path in tracked_changes + untracked if path.endswith(".md")})
links, broken, encodings = 0, [], []
for relative in markdown:
    path = ROOT / relative
    raw = path.read_bytes()
    if b"\r" in raw or raw.startswith(b"\xef\xbb\xbf"):
        encodings.append(relative)
    content = raw.decode("utf-8")
    content = re.sub(r"```[^\n]*\n.*?```", "", content, flags=re.S)
    for target in re.findall(r"\]\(([^\s)]+)\)", content):
        if re.match(r"[a-zA-Z]+://|mailto:", target) or target.startswith("#"):
            continue
        destination = unquote(target.split("#", 1)[0])
        links += 1
        if not (path.parent / destination).exists():
            broken.append({"file": relative, "target": target})

lint_probe = '''
const { ESLint } = require("eslint");
(async () => {
  const eslint = new ESLint();
  const paths = ["docs/验收证据/r2-061-20260927-d/browser-check.cjs", "scripts/demo-http-probes.mjs", "tests/config/demo-http-probes.test.ts", "src/app/(app)/settings/page.tsx"];
  const result = [];
  for (const path of paths) result.push({ path, ignored: await eslint.isPathIgnored(path) });
  process.stdout.write(JSON.stringify(result));
})();
'''
lint_scope = json.loads(subprocess.check_output(["node", "-e", lint_probe], cwd=COPY, creationflags=subprocess.CREATE_NO_WINDOW))
log_paths = {str(path.relative_to(ROOT)).replace("\\", "/") for path in EVIDENCE.rglob("*.log")}
tracked = git("ls-files", "-z").decode("utf-8").rstrip("\0").split("\0")
unlisted_logs = sorted(log_paths - set(tracked) - set(untracked))
report = {
    "patch_reproduced_files": len(changed), "patch_mismatches": patch_mismatches, "commit_mismatches": commit_mismatches,
    "line_ending_differences": line_ending_differences,
    "markdown_files": markdown, "local_links_checked": links, "broken_links": broken, "encoding_issues": encodings,
    "lint_scope": lint_scope, "raw_log_count": len(log_paths), "unlisted_logs": unlisted_logs,
    "standalone_server_exists": (COPY / ".next/standalone/server.js").exists(),
    "build_id": (COPY / ".next/BUILD_ID").read_text(encoding="utf-8").strip(),
}
save("artifact-check.json", report)
print(json.dumps(report, ensure_ascii=False, indent=2))
if patch_mismatches or commit_mismatches or broken or encodings or unlisted_logs or not lint_scope[0]["ignored"] or any(item["ignored"] for item in lint_scope[1:]):
    raise SystemExit(1)

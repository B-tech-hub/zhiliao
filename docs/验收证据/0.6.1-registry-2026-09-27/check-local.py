"""核对下载源迁移、候选身份和失败归档；只读，不安装依赖。"""

import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


evidence = Path(__file__).resolve().parent
root = evidence.parents[2]
old_dir = evidence.parent / "0.6.1-baseline-2026-09-23"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


identity = read_json(evidence / "candidate-identity.json")
record = read_json(evidence / "lock-comparison.json")
head = identity["source_head"]
before = subprocess.check_output(["git", "show", head + ":package-lock.json"], cwd=root)
after = (root / "package-lock.json").read_bytes()
assert sha(before) == record["before_sha256"]
assert sha(after) == record["after_sha256"]
assert after == before.replace(b"https://registry.npmmirror.com/", b"https://registry.npmjs.org/")
a, b = json.loads(before), json.loads(after)
changed = []
for name, pkg in a["packages"].items():
    url = pkg.get("resolved", "")
    if url.startswith("https://registry.npmmirror.com/"):
        assert b["packages"][name]["resolved"] == url.replace("https://registry.npmmirror.com/", "https://registry.npmjs.org/", 1)
        changed.append(name)
        b["packages"][name]["resolved"] = url
assert a == b and len(changed) == 820
assert changed == record["package_names"]
assert b"registry.npmmirror.com" not in after

raw_manifest = (evidence / "candidate-inputs.json").read_bytes()
assert sha(raw_manifest) == identity["manifest_sha256"] == record["new_manifest_sha256"]
assert identity["local_image_tag"] == "zhiliao-r2:0.6.1-" + identity["manifest_sha256"][:12]
manifest = json.loads(raw_manifest)
old_manifest = read_json(old_dir / "candidate-inputs.json")
assert sha((old_dir / "candidate-inputs.json").read_bytes()) == record["old_manifest_sha256"]
assert sha((old_dir / "candidate-identity.json").read_bytes()) == record["old_identity_sha256"]
assert manifest["source_head"] == head
assert manifest["previous_manifest_sha256"] == identity["previous_manifest_sha256"] == record["old_manifest_sha256"]
assert len(manifest["files"]) == identity["file_count"] == 272
assert [x["path"] for x in manifest["files"]] == [x["path"] for x in old_manifest["files"]]
assert [x["path"] for x, y in zip(manifest["files"], old_manifest["files"]) if x != y] == ["package-lock.json"]
for entry in manifest["files"]:
    raw = (root / entry["path"]).read_bytes()
    assert sha(raw) == entry["sha256"] and len(raw) == entry["bytes"], entry["path"]

archive_count = 0
for run in read_json(evidence / "failed-builds.json")["runs"]:
    for item in run["files"]:
        raw = (evidence / item["archive"]).read_bytes()
        assert sha(raw) == item["sha256"] and len(raw) == item["bytes"]
        original = Path(os.environ["TEMP"]) / ("zhiliao-r2-" + run["run_id"]) / item["source"]
        if original.exists():
            assert original.read_bytes() == raw
        archive_count += 1

files = set()
for args in (["diff", head, "--name-only", "-z"], ["ls-files", "--others", "--exclude-standard", "-z"]):
    files.update(x for x in subprocess.check_output(["git", *args], cwd=root).decode("utf-8").split("\0") if x)
link_count = 0
for name in sorted(files):
    path = root / name
    assert name == "package-lock.json" or name.startswith(("docs/", "_bmad-output/implementation-artifacts/")) or name == "CHANGELOG.md", name
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")
    assert b"\r\n" not in raw, name
    if path.suffix == ".json":
        json.loads(text)
    if path.suffix != ".md":
        continue
    # 旧文档原有缺链不扩大到本轮，仅检查新增链接；新文档全部检查。
    original = subprocess.run(["git", "show", head + ":" + name], cwd=root, capture_output=True)
    old_links = set(re.findall(r"\[[^\]]*\]\(([^)]+)\)", original.stdout.decode("utf-8-sig"))) if original.returncode == 0 else set()
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    for target in set(re.findall(r"\[[^\]]*\]\(([^)]+)\)", prose)) - old_links:
        if target.startswith(("http:", "https:", "#", "mailto:")):
            continue
        assert (path.parent / target.split("#")[0]).resolve().exists(), (name, target)
        link_count += 1

print(json.dumps({"status": "passed", "changed_resolved": len(changed),
    "all_other_lock_fields_equal": True, "candidate_files": 272,
    "unchanged_candidate_files": 271, "old_identity_preserved": True,
    "archived_files_verified": archive_count, "utf8_lf_files": len(files),
    "new_links_checked": link_count, "network_invoked": False,
    "docker_invoked": False}, ensure_ascii=False, indent=2))

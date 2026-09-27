"""只读核对本轮候选、历史证据与新增文档链接，不调用 Docker 或网络。"""

import hashlib
import json
import re
import subprocess
from pathlib import Path


evidence = Path(__file__).resolve().parent
root = evidence.parents[2]
previous = evidence.parent / "0.6.1-registry-2026-09-27"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


identity = read_json(evidence / "candidate-identity.json")
manifest = read_json(evidence / "candidate-inputs.json")
old_manifest = read_json(previous / "candidate-inputs.json")
comparison = read_json(evidence / "input-comparison.json")
assert sha((evidence / "candidate-inputs.json").read_bytes()) == identity["manifest_sha256"] == comparison["manifest_sha256"]
assert sha((previous / "candidate-inputs.json").read_bytes()) == identity["previous_manifest_sha256"] == manifest["previous_manifest_sha256"]
assert manifest["source_head"] == identity["source_head"]
assert identity["local_image_tag"] == "zhiliao-r2:0.6.1-" + identity["manifest_sha256"][:12]
assert identity["status"] == "prepared-not-built" and identity["image_id"] is None
old = {f["path"]: f for f in old_manifest["files"]}
new = {f["path"]: f for f in manifest["files"]}
assert len(new) == len(manifest["files"]) == identity["file_count"] == 276
assert sorted(set(new) - set(old)) == sorted(comparison["added"]) == [
    "tests/api/images.test.ts", "tests/fixtures/images/README.md",
    "tests/fixtures/images/pattern.heic", "tests/fixtures/images/pattern.png",
]
assert not (set(old) - set(new))
assert [p for p in old if old[p] != new[p]] == comparison["changed"] == ["src/app/api/images/[filename]/route.ts"]
assert old["package-lock.json"] == new["package-lock.json"]
for entry in new.values():
    target = (root / entry["path"]).resolve(strict=True)
    assert target.is_relative_to(root)
    data = target.read_bytes()
    assert sha(data) == entry["sha256"] and len(data) == entry["bytes"], entry["path"]
for name in ("pattern.png", "pattern.heic"):
    assert (root / "tests/fixtures/images" / name).read_bytes() == (evidence.parent / "0.6.1-baseline-2026-09-23/r2/fixtures" / name).read_bytes()

historical = read_json(evidence / "historical-hashes.json")
for entry in historical["files"]:
    data = (root / entry["path"]).read_bytes()
    assert sha(data) == entry["sha256"] and len(data) == entry["bytes"], entry["path"]
protected = [str(evidence.parent / name) for name in (
    "0.6.1-baseline-2026-09-23", "0.6.1-registry-2026-09-27", "r2-061-20260927-c",
)]
assert not subprocess.check_output(["git", "diff", identity["source_head"], "--name-only", "--", *protected], cwd=root)

changed = set()
for args in (["diff", identity["source_head"], "--name-only", "-z"], ["ls-files", "--others", "--exclude-standard", "-z"]):
    changed.update(p for p in subprocess.check_output(["git", *args], cwd=root).decode("utf-8").split("\0") if p)
links = 0
for name in sorted(changed):
    file = root / name
    assert name in ("CHANGELOG.md", "src/app/api/images/[filename]/route.ts", "tests/api/images.test.ts") or name.startswith(("docs/", "_bmad-output/implementation-artifacts/", "tests/fixtures/images/")), name
    if file.suffix in (".png", ".heic") or name.endswith(".log.txt"):
        continue
    raw = file.read_bytes()
    text = raw.decode("utf-8-sig")
    assert b"\r" not in raw, name
    if file.suffix == ".json":
        json.loads(text)
    if file.suffix != ".md":
        continue
    old_file = subprocess.run(["git", "show", identity["source_head"] + ":" + name], cwd=root, capture_output=True)
    old_links = set(re.findall(r"\[[^\]]*\]\(([^)]+)\)", old_file.stdout.decode("utf-8-sig"))) if old_file.returncode == 0 else set()
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    for target in set(re.findall(r"\[[^\]]*\]\(([^)]+)\)", prose)) - old_links:
        if target.startswith(("https:", "http:", "#", "mailto:")):
            continue
        assert (file.parent / target.split("#")[0]).resolve().exists(), (name, target)
        links += 1

print(json.dumps({"status": "passed", "manifest_sha256": identity["manifest_sha256"],
    "candidate_files": len(new), "unchanged_inputs": 271, "historical_files_preserved": len(historical["files"]),
    "package_lock_unchanged": True, "fixture_bytes_equal": True, "new_links_checked": links,
    "docker_invoked": False, "network_invoked": False}, ensure_ascii=False, indent=2))

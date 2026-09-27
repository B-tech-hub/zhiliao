import hashlib
import json
import sys
from pathlib import Path


def read_json(name):
    return json.loads(Path(name).read_text(encoding="utf-8-sig"))


def main():
    mode, *args = sys.argv[1:]
    if mode == "snapshot":
        source = Path(args[0]).resolve(strict=True)
        files = []
        for file in sorted(source.rglob("*")):
            if file.is_symlink():
                raise ValueError("快照中不接受符号链接")
            if file.is_file():
                data = file.read_bytes()
                files.append({"path": file.relative_to(source).as_posix(), "bytes": len(data),
                              "sha256": hashlib.sha256(data).hexdigest()})
        if not any(item["path"] == "app.db" for item in files):
            raise ValueError("缺少数据库快照")
        if len([item for item in files if item["path"].startswith("uploads/")]) != 3:
            raise ValueError("本次合成快照应有 PNG、JPEG、HEIC 三个文件")
        with Path(args[1]).open("x", encoding="utf-8", newline="\n") as output:
            output.write(json.dumps(files, ensure_ascii=False, indent=2) + "\n")
    elif mode == "manifest":
        manifest = read_json(args[0])
        root = Path(args[1]).resolve(strict=True)
        expected = {item["path"] for item in manifest["files"]}
        actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
        if actual != expected:
            raise ValueError("构建目录包含额外文件或缺文件")
        for item in manifest["files"]:
            target = (root / item["path"]).resolve(strict=True)
            if not target.is_relative_to(root):
                raise ValueError("构建目录路径越界")
            if hashlib.sha256(target.read_bytes()).hexdigest() != item["sha256"]:
                raise ValueError("构建输入内容变化：" + item["path"])
    elif mode in ("zip", "restore", "unchanged"):
        before, after = read_json(args[0]), read_json(args[1])
        fields = {"zip": ["exportedNotes", "pairedImages"],
                  "restore": ["tables", "files", "exportedNotes", "pairedImages", "counts"]}
        if mode == "unchanged":
            if before != after:
                raise ValueError("源包在演练期间发生变化")
        else:
            for field in fields[mode]:
                if before[field] != after[field]:
                    raise ValueError("比对失败：" + field)
            if mode == "zip" and after["counts"] != {"active": 3, "trash": 0, "images": 2}:
                raise ValueError("ZIP 目标计数不符合预期")
    else:
        raise ValueError("未知检查模式")
    print(mode + ": passed")


if __name__ == "__main__":
    main()

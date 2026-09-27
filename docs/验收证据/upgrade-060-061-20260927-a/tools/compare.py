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
    elif mode in ("upgrade", "rollback", "unchanged"):
        before, after = read_json(args[0]), read_json(args[1])
        if mode == "unchanged":
            if before != after:
                raise ValueError("升级前快照在演练期间发生变化")
        else:
            # 升级前状态必须来自 0.6.0；升级后只允许追加迁移，回退后迁移必须完全一致
            if before["appVersion"] != "0.6.0":
                raise ValueError("升级前状态不是 0.6.0")
            expected = {"upgrade": "0.6.1", "rollback": "0.6.0"}[mode]
            if after["appVersion"] != expected:
                raise ValueError("比对目标版本不是 " + expected)
            if after["migrations"][:len(before["migrations"])] != before["migrations"]:
                raise ValueError("迁移记录被改写")
            if mode == "rollback" and after["migrations"] != before["migrations"]:
                raise ValueError("回退库迁移记录与升级前不同")
            for field in ["integrity", "tables", "files", "exportedNotes", "pairedImages", "counts"]:
                if before[field] != after[field]:
                    raise ValueError("比对失败：" + field)
    else:
        raise ValueError("未知检查模式")
    print(mode + ": passed")


if __name__ == "__main__":
    main()

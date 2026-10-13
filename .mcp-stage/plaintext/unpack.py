#!/usr/bin/env python3
import hashlib, json, pathlib
root = pathlib.Path(".mcp-stage/plaintext")
for sub in sorted(root.iterdir()):
    if not sub.is_dir():
        continue
    mpath = sub / "manifest.json"
    if not mpath.exists():
        continue
    m = json.loads(mpath.read_text())
    parts = [(sub / f"part{i:02d}.txt").read_text() for i in range(m["parts"])]
    text = "".join(parts)
    raw = text.encode()
    if hashlib.sha256(raw).hexdigest() != m["sha256"]:
        raise SystemExit(f"sha mismatch {m['path']}")
    dest = pathlib.Path(m["path"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text)
    print(f"wrote {dest} ({len(raw)})")

#!/usr/bin/env python3
import base64, gzip, hashlib, json, pathlib, shutil
root = pathlib.Path(".mcp-stage/thread-i-rem")
manifest = json.loads((root / "manifest.json").read_text())
for entry in manifest:
    parts = [(root / f"{entry['key']}.part{i:02d}.b64").read_text().strip() for i in range(entry["parts"])]
    raw = gzip.decompress(base64.b64decode("".join(parts)))
    digest = hashlib.sha256(raw).hexdigest()
    if digest != entry["sha256"]:
        raise SystemExit(f"sha mismatch {entry['path']}: got {digest}")
    dest = pathlib.Path(entry["path"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    print(f"wrote {dest} ({len(raw)} bytes)")
# also wipe any leftover older stage dirs
for p in [pathlib.Path(".mcp-stage")]:
    pass

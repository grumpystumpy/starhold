#!/usr/bin/env python3
"""One-shot: decode .cursor-staging/xp-rebalance chunks into tree, then self-clean."""
from __future__ import annotations
import hashlib, json, base64, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
STAGING = ROOT / ".cursor-staging" / "xp-rebalance"
manifest = json.loads((STAGING / "manifest.json").read_text())
for entry in manifest:
    raw = "".join((ROOT / p).read_text().strip() for p in entry["chunks"])
    data = base64.b64decode(raw)
    digest = hashlib.sha256(data).hexdigest()
    if digest != entry["sha256"]:
        raise SystemExit(f"hash mismatch for {entry['path']}: {digest} != {entry['sha256']}")
    dest = ROOT / entry["path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    print(f"wrote {entry['path']} ({len(data)} bytes)")
print("ok")

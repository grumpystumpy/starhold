import base64, gzip, hashlib, json, pathlib
manifest = json.loads(pathlib.Path(".cursor-stage/manifest.json").read_text())
for entry in manifest:
    safe = entry["safe"]
    parts = []
    i = 0
    while True:
        p = pathlib.Path(f".cursor-stage/{safe}.{i:02d}")
        if not p.exists():
            break
        parts.append(p.read_text())
        i += 1
    assert i == entry["parts"], (entry["path"], i, entry["parts"])
    raw = gzip.decompress(base64.b64decode("".join(parts).encode("ascii")))
    assert hashlib.sha256(raw).hexdigest() == entry["sha256"], entry["path"]
    dest = pathlib.Path(entry["path"])
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    print("ok", entry["path"], len(raw))
    for j in range(i):
        pathlib.Path(f".cursor-stage/{safe}.{j:02d}").unlink()
pathlib.Path(".cursor-stage/manifest.json").unlink()
try:
    pathlib.Path(".cursor-stage").rmdir()
except OSError:
    pass

import base64, gzip, hashlib, pathlib
stage = pathlib.Path(".cursor-stage")
if not stage.exists():
    print("no stage dir")
    raise SystemExit(0)
for p in sorted(stage.glob("*.gz.b64")):
    dest = p.name[: -len(".gz.b64")].replace("__", "/")
    raw = gzip.decompress(base64.b64decode(p.read_text().encode("ascii")))
    pathlib.Path(dest).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(dest).write_bytes(raw)
    print(dest, len(raw), hashlib.sha256(raw).hexdigest()[:12])
    p.unlink()
try:
    stage.rmdir()
except OSError:
    pass

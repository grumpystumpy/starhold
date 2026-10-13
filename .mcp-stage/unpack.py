import base64, gzip, json
from pathlib import Path
manifest = json.loads(Path(".mcp-stage/manifest.json").read_text())
for item in manifest:
    safe = item["safe"]
    n = item["nparts"]
    dest = Path(item["dest"])
    parts = []
    for i in range(n):
        p = Path(f".mcp-stage/{safe}.part{i:02d}.b64")
        parts.append(p.read_text().strip())
    raw = gzip.decompress(base64.b64decode("".join(parts)))
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(raw)
    print("wrote", dest, len(raw))

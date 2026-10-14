#!/usr/bin/env python3
import base64, gzip, hashlib, json, pathlib, subprocess, sys
stage = pathlib.Path(".cursor-stage/round3-app")
man = json.loads((stage / "manifest.json").read_text())
b64 = "".join((stage / f"part-{i:02d}.b64").read_text().strip() for i in range(man["parts"]))
raw = gzip.decompress(base64.b64decode(b64))
digest = hashlib.sha256(raw).hexdigest()
assert digest == man["sha256"], (digest, man["sha256"])
path = pathlib.Path(man["path"])
path.parent.mkdir(parents=True, exist_ok=True)
path.write_bytes(raw)
print("wrote", path, "bytes", len(raw), "sha256", digest)
# cleanup staging + self
import shutil
shutil.rmtree(stage, ignore_errors=True)
wf = pathlib.Path(".github/workflows/unpack-app-ts.yml")
if wf.exists():
    wf.unlink()
self = pathlib.Path("scripts/unpack-staged-app.py")
if self.exists():
    self.unlink()
subprocess.check_call(["git", "config", "user.name", "github-actions[bot]"])
subprocess.check_call(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"])
subprocess.check_call(["git", "add", "-A"])
subprocess.check_call(["git", "commit", "-m", "chore: unpack apps/server/src/app.ts from staging (round3 rename-planet)"])
subprocess.check_call(["git", "push"])

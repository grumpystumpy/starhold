#!/usr/bin/env python3
"""One-shot: download #49 stack, commit onto cursor/batch-tomorrow-deploy, self-delete."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

TOKEN = os.environ["GH_TOKEN"]
OWNER, REPO, BRANCH = "grumpystumpy", "starhold", "cursor/batch-tomorrow-deploy"
API = f"https://api.github.com/repos/{OWNER}/{REPO}"
MSG = "integrate: fold #49 pirates+aliens onto batch-tomorrow-deploy (full clean)"
EXPECT_API = "4b21c187cad1e1192779e82d9817e776c83b34498ca2932e0b0afb777c431c23"
EXPECT_STACK = "7333cf7972f708296a7c1ebb471a7feeef5d4493913d95abe3f8dfc140cbef8d"
URLS = [
    "https://litter.catbox.moe/p445bv.tgz",
    "https://h.uguu.se/iumWvaCe.tgz",
]


def api(method: str, path: str, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(
        API + path,
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "starhold-assemble-full49",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"API {method} {path} -> {e.code}: {err}") from e


def get_json(path: str):
    return api("GET", path)[1]


def path_exists(path: str) -> bool:
    req = urllib.request.Request(
        API + f"/contents/{path}?ref={BRANCH}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "starhold-assemble-full49",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            r.read()
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise


def download_stack(dest: Path) -> None:
    last_err = None
    for url in URLS:
        try:
            print(f"download {url}")
            urllib.request.urlretrieve(url, dest)
            got = hashlib.sha256(dest.read_bytes()).hexdigest()
            if got != EXPECT_STACK:
                raise SystemExit(f"stack sha mismatch {got}")
            print(f"stack ok {dest.stat().st_size} {got}")
            return
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"failed {url}: {e}")
    raise SystemExit(f"all downloads failed: {last_err}")


def main() -> None:
    tmp = Path(tempfile.mkdtemp(prefix="full49-"))
    tgz = tmp / "full49.tgz"
    download_stack(tgz)
    full = tmp / "full"
    full.mkdir()
    with tarfile.open(tgz, "r:gz") as tar:
        tar.extractall(full)
    subprocess.check_call(["sha256sum", "-c", "SHA256SUMS"], cwd=full)

    stack = tmp / "stack"
    stack.mkdir()
    with tarfile.open(full / "src49-stack.tgz", "r:gz") as tar:
        tar.extractall(stack)
    (stack / "api").mkdir(exist_ok=True)
    api_raw = (full / "api-index.js").read_bytes()
    (stack / "api" / "index.js").write_bytes(api_raw)
    got = hashlib.sha256(api_raw).hexdigest()
    if got != EXPECT_API:
        raise SystemExit(f"api sha mismatch {got}")
    print(f"api ok {len(api_raw)} {got}")

    panels = (stack / "apps/web/src/ui/render-fleets-panels.ts").read_text()
    assert 'data-testid="galaxy-alien"' in panels
    assert 'data-testid="galaxy-alien-empty"' in panels
    assert "· Lv " in panels
    assert '<h3 class="subhead">Aliens</h3>' in panels
    assert panels.strip() != "PLACEHOLDER"
    pirate_line = next(ln for ln in panels.splitlines() if "galaxy-pirate" in ln and "empty" not in ln)
    assert "· Lv " in pirate_line and "· tier " not in pirate_line
    ci = (stack / ".github/workflows/ci.yml").read_text()
    assert "STARHOLD_E2E" in ci
    tuning = (stack / "packages/game/src/data/tuning.ts").read_text()
    assert "NPC_RAID_CATCHUP_MAX" in tuning
    print("markers ok")

    deletes: list[str] = []
    del_file = stack / "DELETE_PATHS.txt"
    if del_file.exists():
        deletes = [ln.strip() for ln in del_file.read_text().splitlines() if ln.strip()]
        del_file.unlink()

    candidates = deletes + [
        ".github/workflows/assemble-full49.yml",
        ".github/workflows/assemble-src49-api.yml",
        ".github/workflows/assemble-batch-tomorrow-49.yml",
        ".cursor-push/assemble-full49.py",
        ".cursor-push/src49/meta.json",
        ".cursor-push/api49/meta.json",
    ]
    for i in range(6):
        candidates.append(f".cursor-push/src49/src.{i:02d}.b64")
    for i in range(17):
        candidates.append(f".cursor-push/api49/api.{i:02d}.b64")

    deletes = []
    for rel in sorted(set(candidates)):
        if path_exists(rel):
            deletes.append(rel)
            print(f"will delete {rel}")
        else:
            print(f"skip missing {rel}")

    ref = get_json(f"/git/ref/heads/{BRANCH}")
    head_sha = ref["object"]["sha"]
    commit = get_json(f"/git/commits/{head_sha}")
    base_tree = commit["tree"]["sha"]

    tree = []
    for path in sorted(p for p in stack.rglob("*") if p.is_file()):
        rel = str(path.relative_to(stack))
        raw = path.read_bytes()
        b64 = base64.b64encode(raw).decode()
        _st, blob = api("POST", "/git/blobs", {"content": b64, "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print(f"blob {rel} {len(raw)} {blob['sha'][:8]}")

    for rel in deletes:
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": None})
        print(f"delete {rel}")

    _st, new_tree = api("POST", "/git/trees", {"base_tree": base_tree, "tree": tree})
    _st, new_commit = api(
        "POST",
        "/git/commits",
        {"message": MSG, "tree": new_tree["sha"], "parents": [head_sha]},
    )
    _st, updated = api(
        "PATCH",
        f"/git/refs/heads/{BRANCH}",
        {"sha": new_commit["sha"], "force": False},
    )
    print("COMMIT", new_commit["sha"])
    print("REF", updated["object"]["sha"])


if __name__ == "__main__":
    main()

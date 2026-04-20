#!/usr/bin/env python3
"""
Round-trip helper for the self-unpacking index.html bundle.

index.html embeds the app as a base64+gzipped blob inside a manifest
JSON on a single line, plus an escaped HTML template on another.
This script decodes both into /tmp/bundle/ for editing, then re-encodes
them back into index.html in place.

Usage:
  python3 scripts/bundle.py extract index.html
      Writes /tmp/bundle/app.jsx and /tmp/bundle/template.html.

  python3 scripts/bundle.py inject index.html
      Reads /tmp/bundle/{app.jsx,template.html} and rewrites the
      manifest + template lines in index.html in place.

  python3 scripts/bundle.py verify index.html
      Extract, inject-to-temp, re-extract, and assert the decoded
      contents round-trip byte-for-byte (gzip output isn't stable,
      but decoded sources must match exactly).
"""

import sys
import json
import base64
import gzip
import pathlib
import shutil
import tempfile

APP_UUID = "e54b79ec-d2e6-4b1c-987c-9fa59d5910eb"
WORKDIR = pathlib.Path("/tmp/bundle")
APP_PATH = WORKDIR / "app.jsx"
TEMPLATE_PATH = WORKDIR / "template.html"


def _read_lines(p):
    with open(p, "r", encoding="utf-8") as f:
        return f.read().splitlines(keepends=True)


def _write_lines(p, lines):
    with open(p, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _find_blob_lines(lines):
    """Locate the manifest + template payload lines by scanning for their
    wrapper tags, so edits elsewhere in index.html don't bit-rot this script.
    Returns (manifest_idx, template_idx) as 0-indexed positions."""
    manifest_idx = template_idx = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped == '<script type="__bundler/manifest">':
            manifest_idx = i + 1
        elif stripped == '<script type="__bundler/template">':
            template_idx = i + 1
    if manifest_idx is None or template_idx is None:
        raise RuntimeError("could not locate __bundler/manifest or __bundler/template tags")
    return manifest_idx, template_idx


def extract(index_path):
    WORKDIR.mkdir(parents=True, exist_ok=True)
    lines = _read_lines(index_path)
    manifest_idx, template_idx = _find_blob_lines(lines)

    manifest_line = lines[manifest_idx].rstrip("\n")
    manifest = json.loads(manifest_line)
    entry = manifest[APP_UUID]
    raw = base64.b64decode(entry["data"])
    app_src = gzip.decompress(raw).decode("utf-8") if entry.get("compressed") else raw.decode("utf-8")
    APP_PATH.write_text(app_src, encoding="utf-8")

    template_line = lines[template_idx].rstrip("\n")
    template_src = json.loads(template_line)
    TEMPLATE_PATH.write_text(template_src, encoding="utf-8")

    print(f"extracted app.jsx ({len(app_src)} chars) -> {APP_PATH}")
    print(f"extracted template.html ({len(template_src)} chars) -> {TEMPLATE_PATH}")


def inject(index_path):
    lines = _read_lines(index_path)
    manifest_idx, template_idx = _find_blob_lines(lines)

    manifest_line = lines[manifest_idx].rstrip("\n")
    manifest = json.loads(manifest_line)
    entry = manifest[APP_UUID]

    new_app = APP_PATH.read_text(encoding="utf-8").encode("utf-8")
    if entry.get("compressed"):
        # mtime=0 and compresslevel=9 for a stable-ish rebuild; not required.
        compressed = gzip.compress(new_app, compresslevel=9, mtime=0)
    else:
        compressed = new_app
    entry["data"] = base64.b64encode(compressed).decode("ascii")

    lines[manifest_idx] = json.dumps(manifest, separators=(",", ":")) + "\n"

    new_template = TEMPLATE_PATH.read_text(encoding="utf-8")
    # Escape `</` as `<\/` so an inner `</script>` in the template can't close
    # the outer <script type="__bundler/template"> tag that wraps this JSON.
    # JSON treats `\/` as an escape for `/`, so JSON.parse still yields `</`.
    lines[template_idx] = json.dumps(new_template).replace("</", "<\\/") + "\n"

    _write_lines(index_path, lines)
    print(f"injected: app={len(new_app)} bytes (b64={len(entry['data'])}), template={len(new_template)} chars")


def verify(index_path):
    extract(index_path)
    app_before = APP_PATH.read_text(encoding="utf-8")
    tpl_before = TEMPLATE_PATH.read_text(encoding="utf-8")

    with tempfile.NamedTemporaryFile(mode="wb", delete=False, suffix=".html") as tf:
        tmp = tf.name
    shutil.copy(index_path, tmp)
    inject(tmp)
    extract(tmp)
    app_after = APP_PATH.read_text(encoding="utf-8")
    tpl_after = TEMPLATE_PATH.read_text(encoding="utf-8")
    # restore original extract for the workspace
    extract(index_path)

    assert app_before == app_after, "app.jsx round-trip mismatch"
    assert tpl_before == tpl_after, "template.html round-trip mismatch"
    print("verify OK: round-trip is idempotent at decoded-content level")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    cmd, idx = sys.argv[1], sys.argv[2]
    {"extract": extract, "inject": inject, "verify": verify}[cmd](idx)

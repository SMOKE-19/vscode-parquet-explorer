#!/usr/bin/env python3
"""Publish platform VSIX files and the Tailnet download page; preserve older files."""

import hashlib
import html
import json
import os
import shutil
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


TARGETS = ("win32-x64", "linux-x64")


def checksum(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def replace_text(path: Path, text: str) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(text)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(root: Path) -> dict:
    version = json.loads((root / "package.json").read_text())["version"]
    output = root / "dist" / "downloads"
    artifacts = []
    for target in TARGETS:
        filename = f"pq-explorer-{version}-{target}.vsix"
        artifact = root / "dist" / filename
        with ZipFile(artifact) as archive:
            manifest = json.loads(archive.read("extension/package.json"))
            if (manifest["name"], manifest["publisher"], manifest["version"]) != ("pq-explorer", "smoke-19", version):
                raise ValueError(f"VSIX identity/version mismatch: {filename}")
            identity = ET.fromstring(archive.read("extension.vsixmanifest")).find(".//{*}Identity")
            if identity is None or identity.get("TargetPlatform") != target:
                raise ValueError(f"VSIX target mismatch: {filename}")
            native = "duckdb.dll" if target == "win32-x64" else "libduckdb.so"
            for required in ("extension/extension.js", "extension/engine/worker.js",
                             f"extension/node_modules/@duckdb/node-bindings-{target}/duckdb.node",
                             f"extension/node_modules/@duckdb/node-bindings-{target}/{native}"):
                if required not in archive.namelist():
                    raise ValueError(f"Missing runtime file: {filename}: {required}")
        digest = checksum(artifact)
        destination = output / filename
        if destination.exists() and checksum(destination) != digest:
            raise ValueError(f"Refusing to replace a different artifact with the same version: {destination}")
        artifacts.append({"target": target, "filename": filename, "sha256": digest,
                          "bytes": artifact.stat().st_size,
                          "packaged_at": datetime.fromtimestamp(artifact.stat().st_mtime, timezone.utc).isoformat()})

    # Validate all files and render the page before touching the live directory.
    windows, linux = artifacts
    metadata = {"version": version, **windows, "artifacts": artifacts}
    template = (root / "distribution" / "index.html").read_text(encoding="utf-8")
    fields = {"VERSION": version, "FILENAME": windows["filename"], "LINUX_FILENAME": linux["filename"],
              "SHA256": windows["sha256"], "LINUX_SHA256": linux["sha256"],
              "SIZE": f"{windows['bytes'] / 1024**2:.2f} MiB",
              "LINUX_SIZE": f"{linux['bytes'] / 1024**2:.2f} MiB",
              "DATE": datetime.fromisoformat(windows["packaged_at"]).strftime("%Y-%m-%d")}
    for name, value in fields.items():
        template = template.replace(f"__{name}__", html.escape(value))
    if any(f"__{name}__" in template for name in fields):
        raise ValueError("Unresolved download page template")
    output.mkdir(parents=True, exist_ok=True)
    for item in artifacts:
        destination = output / item["filename"]
        if not destination.exists():
            with tempfile.NamedTemporaryFile(dir=output, delete=False) as stream:
                temporary = Path(stream.name)
            try:
                shutil.copyfile(root / "dist" / item["filename"], temporary)
                if checksum(temporary) != item["sha256"]:
                    raise ValueError("VSIX changed while copying")
                os.replace(temporary, destination)
            finally:
                temporary.unlink(missing_ok=True)
    replace_text(output / "SHA256SUMS", "".join(f"{item['sha256']}  {item['filename']}\n" for item in artifacts))
    replace_text(output / "release.json", json.dumps(metadata, indent=2) + "\n")
    replace_text(output / "index.html", template)
    return {"directory": str(output), **metadata}


def main() -> None:
    print(json.dumps(prepare(Path(__file__).resolve().parents[1]), indent=2))


if __name__ == "__main__":
    main()

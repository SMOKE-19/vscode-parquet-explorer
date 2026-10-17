#!/usr/bin/env python3
"""Build the Tailnet download directory from the verified local VSIX."""

import hashlib
import html
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / "package.json").read_text())["version"]
    filename = f"pq-explorer-{version}.vsix"
    artifact = root / "dist" / filename
    with ZipFile(artifact) as archive:
        manifest = json.loads(archive.read("extension/package.json"))
        if (manifest["name"], manifest["publisher"], manifest["version"]) != ("pq-explorer", "smoke-19", version):
            raise SystemExit("VSIX identity/version does not match package.json")
    with artifact.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    output = root / "dist" / "downloads"
    output.mkdir(parents=True, exist_ok=True)
    destination = output / filename
    if destination.exists():
        with destination.open("rb") as existing:
            if hashlib.file_digest(existing, "sha256").hexdigest() != checksum:
                raise SystemExit(f"Refusing to replace a different artifact with the same version: {destination}")
    else:
        shutil.copyfile(artifact, destination)
    timestamp = datetime.fromtimestamp(artifact.stat().st_mtime, timezone.utc)
    metadata = {
        "version": version, "filename": filename, "sha256": checksum,
        "bytes": artifact.stat().st_size, "packaged_at": timestamp.isoformat(),
    }
    template = (root / "distribution" / "index.html").read_text(encoding="utf-8")
    fields = {
        "VERSION": version, "FILENAME": filename, "SHA256": checksum,
        "SIZE": f"{metadata['bytes'] / 1024:.1f} KiB", "DATE": timestamp.strftime("%Y-%m-%d"),
    }
    for name, value in fields.items():
        template = template.replace(f"__{name}__", html.escape(value))
    (output / "index.html").write_text(template, encoding="utf-8")
    (output / "SHA256SUMS").write_text(f"{checksum}  {filename}\n", encoding="utf-8")
    (output / "release.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"directory": str(output), **metadata}, indent=2))


if __name__ == "__main__":
    main()

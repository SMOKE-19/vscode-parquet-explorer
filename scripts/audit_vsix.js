"use strict";

const os = require("node:os");
const yauzl = require("yauzl");

const roots = new Set(["extension.js", "bridge.js", "favorites.js", "package.json", "readme.md", "changelog.md", "license.txt", "privacy.md", "security.md", "third_party_notices.md"]);
const owned = /^(?:engine\/(?:parquet|sql|values|worker)\.js|media\/(?:explorer\.(?:js|html|css)|sql-editor\.js)|assets\/(?:icon|explorer)\.png)$/;
const vendor = /^node_modules\/(?:@duckdb\/(?:node-api|node-bindings|node-bindings-(?:linux|win32|darwin)-(?:x64|arm64)(?:-musl)?)|detect-libc)\//;
const patterns = [
  ["private key", /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ["GitHub credential", /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["embedded publishing credential", /(?:VSCE_PAT|AZURE_CLIENT_SECRET)\s*[:=]\s*["'][^"'\r\n]{12,}["']/i],
  ["private network address", /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ["private overlay hostname", /\b(?:[a-z0-9-]+\.)*tail[a-z0-9]+\.ts\.net\b/i],
];

async function auditVsix(artifact) {
  const archive = await new Promise((resolve, reject) => yauzl.open(artifact, { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  const summary = { files: 0, owned_files: 0, vendor_files: 0 };
  try {
    await new Promise((resolve, reject) => {
      archive.on("error", reject);
      archive.on("entry", entry => {
        const file = entry.fileName;
        if (file.endsWith("/")) { archive.readEntry(); return; }
        if (file === "extension.vsixmanifest" || file === "[Content_Types].xml") { archive.readEntry(); return; }
        const relative = file.replace(/^extension\//, "");
        if (!file.startsWith("extension/") || relative.includes("..") || /[\\\x00]/.test(relative)
            || (!roots.has(relative.toLowerCase()) && !owned.test(relative) && !vendor.test(relative))) {
          reject(new Error(`Unexpected public package file: ${file}`)); return;
        }
        summary.files++;
        if (vendor.test(relative)) { summary.vendor_files++; archive.readEntry(); return; }
        summary.owned_files++;
        if (entry.uncompressedSize > 8 * 1024 * 1024) { reject(new Error(`Unexpected public file size: ${file}`)); return; }
        archive.openReadStream(entry, (error, stream) => {
          if (error) { reject(error); return; }
          const chunks = [];
          stream.on("error", reject);
          stream.on("data", chunk => chunks.push(chunk));
          stream.on("end", () => {
            const contents = Buffer.concat(chunks);
            if (relative === "assets/icon.png") {
              const png = contents.length >= 24 && contents.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                && contents.toString("ascii", 12, 16) === "IHDR";
              const width = png ? contents.readUInt32BE(16) : 0;
              const height = png ? contents.readUInt32BE(20) : 0;
              if (!width || !height || width > 1024 || height > 1024) {
                reject(new Error("Marketplace icon must be a PNG with dimensions at most 1024 by 1024 pixels")); return;
              }
            }
            const text = contents.toString("utf8");
            const match = patterns.find(([, expression]) => expression.test(text));
            if (match) { reject(new Error(`Public package check failed (${match[0]}): ${file}`)); return; }
            if (text.includes(os.homedir()) || text.includes(process.cwd())) {
              reject(new Error(`Public package contains a build-machine path: ${file}`)); return;
            }
            archive.readEntry();
          });
        });
      });
      archive.on("end", resolve);
      archive.readEntry();
    });
    return summary;
  } finally { archive.close(); }
}

module.exports = { auditVsix };

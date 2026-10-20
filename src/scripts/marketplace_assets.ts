import type { Readable } from "node:stream";
interface ManifestIdentity { publisher: string; name: string; version: string }
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import * as yazl from "yazl";

const SCREENSHOT_ASSET = "PQExplorer.Screenshots.Explorer";

function screenshotUrl(manifest: ManifestIdentity) {
  return `https://${manifest.publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${manifest.publisher}/extension/${manifest.name}/${manifest.version}/assetbyname/${SCREENSHOT_ASSET}`;
}

// Register the screenshot on the same Marketplace publication, avoiding a separate
// image host or a Git push merely to serve the README image.
async function registerScreenshot(artifact: string) {
  const input = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(artifact, { lazyEntries: true }, (error, archive) => error ? reject(error) : resolve(archive!)));
  const output = new yazl.ZipFile();
  const temporary = artifact + ".assets.tmp";
  const writing = pipeline(output.outputStream, fs.createWriteStream(temporary));
  // Prevent an early stream failure from becoming an unhandled rejection.
  writing.catch(() => {});
  let hasScreenshot = false, hasManifest = false;
  try {
    await new Promise<void>((resolve, reject) => {
      input.on("error", reject);
      input.on("entry", (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith("/")) { input.readEntry(); return; }
        if (entry.fileName === "extension/assets/explorer.png") hasScreenshot = true;
        input.openReadStream(entry, (error, stream) => {
          if (error) { reject(error); return; }
          if (entry.fileName === "extension.vsixmanifest") {
            const chunks: Buffer[] = [];
            stream.on("data", chunk => chunks.push(chunk));
            stream.on("error", reject);
            stream.on("end", () => {
              const xml = Buffer.concat(chunks).toString("utf8");
              if (!xml.includes("</Assets>")) { reject(new Error("VSIX asset manifest is missing")); return; }
              const asset = `<Asset Type="${SCREENSHOT_ASSET}" Path="extension/assets/explorer.png" Addressable="true" />`;
              output.addBuffer(Buffer.from(xml.replace("</Assets>", `${asset}\n</Assets>`)), entry.fileName);
              hasManifest = true;
              input.readEntry();
            });
          } else {
            output.addReadStream(stream, entry.fileName, { mode: entry.externalFileAttributes >>> 16 });
            stream.on("error", reject);
            stream.on("end", () => input.readEntry());
          }
        });
      });
      input.on("end", () => {
        if (!hasScreenshot || !hasManifest) { reject(new Error("Marketplace screenshot is missing from VSIX")); return; }
        output.end(); resolve();
      });
      input.readEntry();
    });
    await writing;
    await fsp.rename(temporary, artifact);
  } catch (error) {
    input.close(); (output.outputStream as Readable).destroy();
    await writing.catch(() => {});
    await fsp.rm(temporary, { force: true });
    throw error;
  }
}

export { screenshotUrl, registerScreenshot, SCREENSHOT_ASSET };

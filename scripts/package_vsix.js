"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createVSIX } = require("@vscode/vsce");
const { familySync, MUSL } = require("detect-libc");
const { screenshotUrl, registerScreenshot } = require("./marketplace_assets");
const { auditVsix } = require("./audit_vsix");

const targets = {
  "linux-x64": ["linux", "x64", "glibc"], "linux-arm64": ["linux", "arm64", "glibc"],
  "alpine-x64": ["linux", "x64", "musl"], "alpine-arm64": ["linux", "arm64", "musl"],
  "win32-x64": ["win32", "x64"], "win32-arm64": ["win32", "arm64"],
  "darwin-x64": ["darwin", "x64"], "darwin-arm64": ["darwin", "arm64"],
};
const host = `${process.platform === "linux" && familySync() === MUSL ? "alpine" : process.platform}-${process.arch}`;
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`Usage: npm run package -- [--target TARGET]\nDefault: ${host}\nTargets: ${Object.keys(targets).join(", ")}\nBuilds a local VSIX with native dependencies; does not publish or install it.`);
} else {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

async function main() {
  if (args.length && (args.length !== 2 || args[0] !== "--target")) throw new Error("사용법: npm run package -- [--target TARGET]");
  const target = args[1] || host;
  if (!targets[target]) throw new Error(`지원하지 않는 target: ${target}. --help로 목록을 확인하세요.`);
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const artifact = path.join(root, "dist", `${manifest.name}-${manifest.version}-${target}.vsix`);
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "pq-vsix-"));
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  function run(args, cwd) {
    const result = spawnSync(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    if (result.status !== 0) throw new Error(`npm ${args[0]} 실패: ${result.error?.message || result.status}`);
  }
  try {
    run(["run", "build"], root);
    await fs.mkdir(path.dirname(artifact), { recursive: true });
    for (const file of ["extension.js", "bridge.js", "favorites.js", "engine", "media", "assets", "LICENSE", "README.md", "CHANGELOG.md", "PRIVACY.md", "SECURITY.md", "THIRD_PARTY_NOTICES.md", "package-lock.json"]) {
      await fs.cp(path.join(root, file), path.join(stage, file), { recursive: true });
    }
    const packaged = { ...manifest };
    delete packaged.devDependencies;
    delete packaged.scripts;
    await fs.writeFile(path.join(stage, "package.json"), JSON.stringify(packaged, null, 2));
    const readme = await fs.readFile(path.join(stage, "README.md"), "utf8");
    await fs.writeFile(path.join(stage, "README.md"), readme.replace("(assets/explorer.png)", `(${screenshotUrl(manifest)})`));
    const [platform, cpu, libc] = targets[target];
    // Install in a disposable build directory, never in the user's runtime/workspace.
    run(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", `--os=${platform}`, `--cpu=${cpu}`, ...(libc ? [`--libc=${libc}`] : [])], stage);
    const binding = `@duckdb/node-bindings-${platform}-${cpu}${libc === "musl" ? "-musl" : ""}`;
    await fs.access(path.join(stage, "node_modules", binding, "duckdb.node"));
    await fs.rm(path.join(stage, "package-lock.json"));
    await fs.rm(path.join(stage, "node_modules", ".package-lock.json"), { force: true });
    await fs.rm(path.join(stage, "media", "sql-editor.source.mjs"));
    await fs.writeFile(path.join(stage, ".vscodeignore"), "**/*.d.ts\n**/*.js.map\n");
    await createVSIX({ cwd: stage, packagePath: artifact, target, dependencies: true, useYarn: false });
    await registerScreenshot(artifact);
    console.log("Public package audit:", await auditVsix(artifact));
    console.log(`VSIX: ${artifact}`);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

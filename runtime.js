"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { pythonCommand } = require("./bridge");

const UV_HELP_URL = "https://docs.astral.sh/uv/getting-started/installation/";
const PROBE = [
  "import sys, json",
  "if sys.version_info < (3, 10): raise RuntimeError('Python 3.10 이상이 필요합니다.')",
  "import duckdb",
  "if not (1, 4) <= tuple(map(int, duckdb.__version__.split('.')[:2])) < (2, 0): raise RuntimeError('DuckDB >=1.4,<2가 필요합니다.')",
  "print(json.dumps({'python': sys.executable, 'duckdb': duckdb.__version__}))",
].join("\n");

function venvPython(directory, platform = process.platform) {
  return platform === "win32" ? path.join(directory, "Scripts", "python.exe") : path.join(directory, "bin", "python");
}

function runProcess(command, args, { cwd, signal, onOutput = () => {}, timeout = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, signal, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, UV_NO_PROGRESS: "1", NO_COLOR: "1", PYTHONIOENCODING: "utf-8" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    }
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`실행 시간이 초과되었습니다: ${command}`));
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text) => { stdout = (stdout + text).slice(-32_000); onOutput(text); });
    child.stderr.on("data", (text) => { stderr = (stderr + text).slice(-32_000); onOutput(text); });
    child.once("error", finish);
    child.once("close", (code) => finish(code === 0 ? undefined : new Error(`${command} 실행 실패 (exit ${code})\n${stderr || stdout}`)));
  });
}

class RuntimeManager {
  constructor({ storagePath, state, remoteName, run = runProcess, platform = process.platform }) {
    this.directory = path.join(storagePath, "python-runtime");
    this.venv = path.join(this.directory, ".venv");
    this.python = venvPython(this.venv, platform);
    this.platform = platform;
    const system = platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : "Linux";
    const wsl = remoteName === "wsl" || !!process.env.WSL_DISTRO_NAME;
    const remote = remoteName === "ssh-remote" ? "Remote SSH" : remoteName ? "Remote" : system;
    this.environment = `${wsl ? "WSL" : remote} · ${os.hostname()}`;
    this.state = state;
    this.selections = { ...state?.get("pythonSelections", {}) };
    this.run = run;
    this.listeners = new Set();
    this.controller = new AbortController();
    this.log = "";
  }

  selectedPython(root, configured) {
    const saved = this.selections[root];
    return saved?.configured === configured ? saved.python : pythonCommand(root, configured);
  }

  async remember(root, configured, python) {
    this.selections[root] = { configured, python };
    await this.state?.update("pythonSelections", this.selections);
  }

  describe(currentPython) {
    return {
      environment: this.environment, currentPython, directory: this.directory, venv: this.venv, python: this.python,
      installing: !!this.installPromise, log: this.log,
      commands: "uv venv .venv --python 3.13\nuv pip install duckdb",
    };
  }

  onProgress(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  progress(message, output = "") {
    this.message = message;
    this.log = (this.log + output).slice(-20_000);
    for (const listener of this.listeners) listener({ message, log: this.log, installing: !!this.installPromise });
  }

  async findUv() {
    const executable = this.platform === "win32" ? "uv.exe" : "uv";
    const candidates = [executable, path.join(os.homedir(), ".local", "bin", executable), path.join(os.homedir(), ".cargo", "bin", executable)];
    for (const candidate of candidates) {
      try {
        await this.run(candidate, ["--version"], { signal: this.controller.signal, timeout: 5_000 });
        return candidate;
      } catch (error) {
        if (this.controller.signal.aborted) throw error;
      }
    }
    const error = new Error("uv를 찾을 수 없습니다. 이 실행 환경에 uv를 설치한 뒤 ‘다시 확인’을 누르세요. PATH 변경 후에는 VS Code를 다시 시작해야 할 수 있습니다.");
    error.code = "UV_NOT_FOUND";
    throw error;
  }

  async inspect(currentPython) {
    try { await this.findUv(); return { ...this.describe(currentPython), uvAvailable: true }; }
    catch (error) {
      if (error.code !== "UV_NOT_FOUND") throw error;
      return { ...this.describe(currentPython), uvAvailable: false, uvError: error.message };
    }
  }

  async validate(python) {
    const result = await this.run(python, ["-c", PROBE], { signal: this.controller.signal });
    return JSON.parse(result.stdout.trim());
  }

  install() {
    if (this.installPromise) return this.installPromise;
    this.log = "";
    this.installPromise = Promise.resolve().then(async () => {
      this.progress("uv 확인 중…", "uv 확인\n");
      const uv = await this.findUv();
      await fs.promises.mkdir(this.directory, { recursive: true });
      const options = { cwd: this.directory, signal: this.controller.signal, timeout: 600_000 };
      if (!fs.existsSync(this.python)) {
        this.progress("Python 3.13 준비 · 가상환경 생성 중…", "Python 3.13 · 가상환경 생성\n");
        await this.run(uv, ["venv", this.venv, "--python", "3.13", "--allow-existing"], {
          ...options, onOutput: (text) => this.progress("Python 3.13 준비 · 가상환경 생성 중…", text),
        });
      }
      this.progress("DuckDB 설치 중…", "DuckDB >=1.4,<2 설치\n");
      await this.run(uv, ["pip", "install", "--python", this.python, "duckdb>=1.4,<2"], {
        ...options, onOutput: (text) => this.progress("DuckDB 설치 중…", text),
      });
      this.progress("설치한 환경 확인 중…", "Python · DuckDB 검증\n");
      await this.validate(this.python);
      this.progress("설치 완료 · Parquet을 여는 중…", "환경 준비 완료\n");
      return this.python;
    }).catch((error) => {
      this.progress("환경 설치 실패", `${error.message}\n`);
      throw error;
    }).finally(() => { this.installPromise = undefined; this.progress(this.message); });
    return this.installPromise;
  }

  dispose() { this.controller.abort(); this.listeners.clear(); }
}

module.exports = { RuntimeManager, runProcess, venvPython, UV_HELP_URL };

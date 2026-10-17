"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("setup UI handles missing uv, failed installation, retry and automatic first query", (t) => {
  if (spawnSync("chromium", ["--version"]).status !== 0) { t.skip("Chromium is unavailable"); return; }
  const media = path.resolve(__dirname, "../media");
  const nonce = "pq-setup-test";
  const mock = `<script nonce="${nonce}">
    const sent = [];
    let installAttempts = 0;
    let uv = false;
    const info = {environment:"Windows · SMOKE_DESKTOP",currentPython:"python",directory:"C:/PQ Explorer/python-runtime",venv:"C:/PQ Explorer/python-runtime/.venv",python:"C:/PQ Explorer/python-runtime/.venv/Scripts/python.exe",commands:"uv venv .venv --python 3.13\\nuv pip install duckdb",installing:false,log:""};
    function post(data) { window.dispatchEvent(new MessageEvent("message",{data})); }
    window.acquireVsCodeApi = () => ({postMessage(message) {
      sent.push(message);
      setTimeout(() => {
        if(message.type === "loaded") return post({type:"startupError",error:"duckdb가 없습니다.",setupRequired:true,setup:info});
        if(message.operation === "setup.info") return post({id:message.id,result:{...info,uvAvailable:uv,uvError:uv?"":"uv가 필요합니다."}});
        if(message.operation === "setup.choose") return post({id:message.id,result:{cancelled:true}});
        if(message.operation === "setup.install") {
          installAttempts++;
          post({type:"setupProgress",message:"DuckDB 설치 중…",log:"DuckDB download",installing:true});
          return setTimeout(() => {
            post({type:"setupProgress",message:installAttempts===1?"설치 실패":"설치 완료",log:installAttempts===1?"network unavailable":"완료",installing:false});
            if(installAttempts === 1) return post({id:message.id,error:"network unavailable"});
            post({type:"ready"});
            post({id:message.id,result:{ready:true}});
          },20);
        }
        if(message.operation === "meta") return post({id:message.id,result:{source_path:"sample.parquet",file_count:1,file_bytes:10,column_count:1,row_count:null}});
        if(message.operation === "query") return post({id:message.id,result:{sql:message.payload.sql,rows:[[42]],columns:[{name:"id",type:"INTEGER",index:0}],row_offset:0,column_offset:0,total_columns:1,has_more:false,has_previous_columns:false,has_more_columns:false,elapsed_ms:1}});
        if(message.operation === "lint") return post({id:message.id,result:{ok:true}});
      },0);
    }});
    async function waitFor(check) { for(let i=0;i<100;i++){ if(check()) return; await new Promise(resolve=>setTimeout(resolve,5)); } throw new Error("UI wait timed out"); }
    window.addEventListener("load", async () => {
      try {
        await waitFor(()=>!document.getElementById("runtime-required").hidden);
        document.body.dataset.installsBeforeAction=sent.filter(x=>x.operation==="setup.install").length;
        document.getElementById("setup-open").click();
        await waitFor(()=>!document.getElementById("setup-check").disabled);
        document.body.dataset.uvMissing=String(!document.getElementById("setup-uv").hidden);
        document.body.dataset.installBlocked=String(document.getElementById("setup-install").disabled);
        document.getElementById("setup-choose").click();
        await waitFor(()=>!document.getElementById("setup-check").disabled);
        document.body.dataset.cancelPreservesSetup=String(!document.getElementById("runtime-setup").hidden);
        uv=true;
        document.getElementById("setup-check").click();
        await waitFor(()=>!document.getElementById("setup-install").disabled);
        document.getElementById("setup-install").click();
        document.body.dataset.installBusy=String(document.getElementById("setup-choose").disabled && !document.getElementById("setup-progress").hidden);
        await waitFor(()=>document.getElementById("setup-error").textContent.includes("network unavailable"));
        document.body.dataset.failureLog=document.getElementById("setup-log").textContent;
        document.getElementById("setup-install").click();
        await waitFor(()=>document.querySelector("tbody td:nth-child(2)")?.textContent==="42");
        document.body.dataset.setupHidden=String(document.getElementById("runtime-setup").hidden);
        document.body.dataset.viewerVisible=String(!document.getElementById("explorer-content").hidden);
        document.body.dataset.installAttempts=installAttempts;
        document.body.dataset.queries=sent.filter(x=>x.operation==="query").length;
        document.body.dataset.passed="true";
      } catch(error) {document.body.dataset.failure=String(error);}
    });
  </script>`;
  const html = fs.readFileSync(path.join(media, "explorer.html"), "utf8")
    .replaceAll("__CSP_SOURCE__", "file:").replaceAll("__NONCE__", nonce)
    .replaceAll("__SCRIPT_URI__", pathToFileURL(path.join(media, "explorer.js")).href)
    .replaceAll("__SQL_EDITOR_URI__", pathToFileURL(path.join(media, "sql-editor.js")).href)
    .replaceAll("__STYLE_URI__", pathToFileURL(path.join(media, "explorer.css")).href)
    .replace("<script nonce=", `${mock}\n<script nonce=`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pq-setup-webview-"));
  try {
    const page = path.join(root, "index.html");
    fs.writeFileSync(page, html);
    const run = spawnSync("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", `--user-data-dir=${path.join(root,"profile")}`, "--disable-background-networking", "--virtual-time-budget=2000", "--dump-dom", pathToFileURL(page).href], {encoding:"utf8",timeout:20000,maxBuffer:8*1024*1024});
    assert.equal(run.status, 0, run.stderr.slice(-1000));
    assert.doesNotMatch(run.stdout, /data-failure=/);
    for (const attribute of ["uv-missing", "install-blocked", "cancel-preserves-setup", "install-busy", "setup-hidden", "viewer-visible", "passed"]) assert.match(run.stdout, new RegExp(`data-${attribute}="true"`), attribute);
    assert.match(run.stdout, /data-installs-before-action="0"/);
    assert.match(run.stdout, /data-failure-log="network unavailable"/);
    assert.match(run.stdout, /data-install-attempts="2"/);
    assert.match(run.stdout, /data-queries="1"/);
  } finally { fs.rmSync(root, { recursive:true,force:true }); }
});

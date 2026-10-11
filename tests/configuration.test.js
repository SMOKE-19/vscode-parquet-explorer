"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

test("performance and resource settings are contributed", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const properties = manifest.contributes.configuration.properties;
  for (const name of ["queryTimeoutSeconds", "exactResultCount", "duckdbMemoryLimit", "duckdbThreads", "duckdbTempDirectory", "duckdbMaxTempSize", "maxCellBytes"]) {
    assert.ok(properties[`pqExplorer.${name}`], `${name} setting is missing`);
  }
  assert.equal(properties["pqExplorer.exactResultCount"].default, false);
});

test("webview exposes cancellation and truncated-cell state", () => {
  const html = fs.readFileSync(path.join(root, "media", "explorer.html"), "utf8");
  const script = fs.readFileSync(path.join(root, "media", "explorer.js"), "utf8");
  assert.match(html, /id="cancel"/);
  assert.match(script, /__pq_truncated__/);
  assert.match(script, /request\("cancel"/);
});

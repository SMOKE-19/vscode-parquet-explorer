"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { FavoritesStore, LIMIT } = require("../favorites");

test("SQL 파일과 인덱스가 전역 저장소에 저장되고 다시 읽힌다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pq-favorites-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FavoritesStore(root);
  const saved = await store.save({ alias: "월간 매출", description: "확정 데이터", sql: "SELECT *\nFROM data" });
  assert.equal(saved.preview, "SELECT * FROM data");
  assert.equal((await store.get(saved.id)).sql, "SELECT *\nFROM data");
  assert.equal((await new FavoritesStore(root).list())[0].alias, "월간 매출");
  assert.equal((await fs.readFile(path.join(root, "pq-explorer-sql-favorites", "sql", `${saved.id}.sql`), "utf8")), "SELECT *\nFROM data");
  assert.equal(JSON.parse(await fs.readFile(path.join(root, "pq-explorer-sql-favorites", "index.json"), "utf8")).version, 1);
  await store.recordUse(saved.id, "SELECT * FROM data");
  assert.equal((await store.get(saved.id)).useCount, 0);
  await store.recordUse(saved.id, "SELECT *\nFROM data");
  assert.equal((await store.get(saved.id)).useCount, 1);
  assert.equal((await store.togglePin(saved.id)).pinned, true);
  assert.equal((await new FavoritesStore(root).get(saved.id)).pinned, true);
  assert.equal((await store.togglePin(saved.id)).pinned, false);
  await store.remove(saved.id);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(fs.stat(path.join(root, "pq-explorer-sql-favorites", "sql", `${saved.id}.sql`)), { code: "ENOENT" });
});

test("기존 즐겨찾기 폴더는 새 이름으로 이동하고 SQL을 유지한다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pq-favorites-migrate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, "sql-favorites");
  await fs.mkdir(path.join(legacy, "sql"), { recursive: true });
  await fs.writeFile(path.join(legacy, "sql", "old-id.sql"), "SELECT 42");
  await fs.writeFile(path.join(legacy, "index.json"), JSON.stringify({ version: 1, items: [{ id: "old-id", alias: "기존 SQL", description: "", preview: "SELECT 42", createdAt: "2026-01-01", updatedAt: "2026-01-01", useCount: 0, lastUsedAt: null }] }));
  const store = new FavoritesStore(root);
  assert.equal((await store.get("old-id")).sql, "SELECT 42");
  assert.equal((await store.list())[0].alias, "기존 SQL");
  await assert.rejects(fs.stat(legacy), { code: "ENOENT" });
  assert.equal((await fs.readFile(path.join(store.folder, "sql", "old-id.sql"), "utf8")), "SELECT 42");
});

test("동시 사용 횟수 기록이 누락되지 않고 잘못된 인덱스를 덮어쓰지 않는다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pq-favorites-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FavoritesStore(root);
  const saved = await store.save({ alias: "A", sql: "SELECT 1" });
  await Promise.all(Array.from({ length: 12 }, () => store.recordUse(saved.id, "SELECT 1")));
  assert.equal((await store.get(saved.id)).useCount, 12);
  await assert.rejects(store.save({ alias: "a", sql: "SELECT 2" }), /같은 별칭/);
  await fs.writeFile(store.indexPath, '{"version":2,"items":[]}');
  await assert.rejects(new FavoritesStore(root).list(), /지원하지 않는/);
});

test("100개 제한은 기존 항목 수정을 막지 않는다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pq-favorites-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new FavoritesStore(root);
  let first;
  for (let i = 0; i < LIMIT; i += 1) {
    const saved = await store.save({ alias: `Query ${i}`, sql: `SELECT ${i}` });
    if (i === 0) first = saved;
  }
  await assert.rejects(store.save({ alias: "Overflow", sql: "SELECT 101" }), /최대 100개/);
  await store.save({ id: first.id, alias: "Changed", sql: "SELECT 200" });
  assert.equal((await store.get(first.id)).sql, "SELECT 200");
  assert.equal((await store.list()).length, LIMIT);
});

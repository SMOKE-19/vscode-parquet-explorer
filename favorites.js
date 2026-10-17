"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const LIMIT = 100;
const MAX_SQL_LENGTH = 100000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function validateId(id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new Error("올바르지 않은 즐겨찾기 ID입니다.");
  return id;
}

function preview(sql) {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

class FavoritesStore {
  constructor(storagePath) {
    this.folder = path.join(storagePath, "pq-explorer-sql-favorites");
    this.legacyFolder = path.join(storagePath, "sql-favorites");
    this.sqlFolder = path.join(this.folder, "sql");
    this.indexPath = path.join(this.folder, "index.json");
    this.loaded = false;
    this.items = [];
    this.queue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    try {
      await fs.access(this.folder);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      try {
        await fs.access(path.join(this.legacyFolder, "index.json"));
        await fs.rename(this.legacyFolder, this.folder);
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") throw legacyError;
      }
    }
    let contents;
    try {
      if ((await fs.stat(this.indexPath)).size > 1048576) throw new Error("즐겨찾기 인덱스 크기가 너무 큽니다.");
      contents = await fs.readFile(this.indexPath, "utf8");
    }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.loaded = true;
      return;
    }
    const index = JSON.parse(contents);
    if (index?.version !== 1 || !Array.isArray(index.items) || index.items.length > LIMIT) {
      throw new Error(`지원하지 않는 즐겨찾기 인덱스입니다: ${this.indexPath}`);
    }
    const seen = new Set();
    for (const item of index.items) {
      validateId(item?.id);
      if (seen.has(item.id) || typeof item.alias !== "string" || !item.alias.trim() || item.alias.length > 200
          || (item.description != null && (typeof item.description !== "string" || item.description.length > 2000))) {
        throw new Error("올바르지 않은 즐겨찾기 인덱스입니다.");
      }
      seen.add(item.id);
    }
    this.items = index.items.map(item => ({ ...item,
      description: item.description || "", preview: typeof item.preview === "string" ? item.preview.slice(0, 120) : "",
      useCount: Number.isSafeInteger(item.useCount) && item.useCount >= 0 ? item.useCount : 0,
      pinned: item.pinned === true,
    }));
    this.loaded = true;
  }

  async list() {
    await this.load();
    return this.items.map((item) => ({ ...item }));
  }

  async get(id) {
    validateId(id);
    await this.load();
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error("즐겨찾기를 찾을 수 없습니다.");
    const sqlPath = path.join(this.sqlFolder, `${item.id}.sql`);
    if ((await fs.stat(sqlPath)).size > MAX_SQL_LENGTH * 4) throw new Error("저장된 SQL 크기가 너무 큽니다.");
    const sql = await fs.readFile(sqlPath, "utf8");
    if (sql.length > MAX_SQL_LENGTH) throw new Error("SQL은 100,000자를 넘을 수 없습니다.");
    return { ...item, sql };
  }

  mutate(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async writeIndex() {
    await fs.mkdir(this.folder, { recursive: true });
    const temp = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify({ version: 1, items: this.items }, null, 2)}\n`, "utf8");
      await fs.rename(temp, this.indexPath);
    } finally {
      await fs.rm(temp, { force: true });
    }
  }

  save({ id, alias, description = "", sql }) {
    return this.mutate(async () => {
      await this.load();
      const name = String(alias || "").trim();
      const code = String(sql || "");
      if (!name) throw new Error("별칭을 입력하세요.");
      if (!code.trim()) throw new Error("저장할 SQL이 비어 있습니다.");
      if (name.length > 200 || String(description).length > 2000) throw new Error("별칭은 200자, 설명은 2,000자 이내로 입력하세요.");
      if (code.length > MAX_SQL_LENGTH) throw new Error("SQL은 100,000자를 넘을 수 없습니다.");
      if (id != null) validateId(id);
      const existing = id ? this.items.find((item) => item.id === id) : undefined;
      if (id && !existing) throw new Error("수정할 즐겨찾기를 찾을 수 없습니다.");
      if (!existing && this.items.length >= LIMIT) throw new Error(`즐겨찾기는 최대 ${LIMIT}개까지 저장할 수 있습니다.`);
      if (this.items.some((item) => item.id !== id && item.alias.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error("같은 별칭의 즐겨찾기가 이미 있습니다.");
      }
      const now = new Date().toISOString();
      const item = existing || { id: randomUUID(), createdAt: now, useCount: 0, lastUsedAt: null, pinned: false };
      const previous = existing ? { ...existing } : null;
      const oldSql = existing ? (await this.get(id)).sql : null;
      Object.assign(item, { alias: name, description: String(description).trim(), preview: preview(code), updatedAt: now });
      await fs.mkdir(this.sqlFolder, { recursive: true });
      const sqlPath = path.join(this.sqlFolder, `${item.id}.sql`);
      const temp = `${sqlPath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, code, "utf8");
        await fs.rename(temp, sqlPath);
      } finally { await fs.rm(temp, { force: true }); }
      if (!existing) this.items.push(item);
      try { await this.writeIndex(); }
      catch (error) {
        if (existing) {
          Object.assign(item, previous);
          await fs.writeFile(sqlPath, oldSql, "utf8");
        } else {
          this.items = this.items.filter((entry) => entry.id !== item.id);
          await fs.rm(sqlPath, { force: true });
        }
        throw error;
      }
      return { ...item };
    });
  }

  recordUse(id, sql) {
    return this.mutate(async () => {
      if (!id) return;
      const item = await this.get(id).catch((error) => {
        if (error.message === "즐겨찾기를 찾을 수 없습니다.") return null;
        throw error;
      });
      if (!item || item.sql !== sql) return;
      const entry = this.items.find((value) => value.id === id);
      const previous = { ...entry };
      entry.useCount += 1;
      entry.lastUsedAt = new Date().toISOString();
      try { await this.writeIndex(); }
      catch (error) { Object.assign(entry, previous); throw error; }
    });
  }

  togglePin(id) {
    return this.mutate(async () => {
      validateId(id);
      await this.load();
      const item = this.items.find((entry) => entry.id === id);
      if (!item) throw new Error("즐겨찾기를 찾을 수 없습니다.");
      item.pinned = !item.pinned;
      try { await this.writeIndex(); }
      catch (error) { item.pinned = !item.pinned; throw error; }
      return { ...item };
    });
  }

  remove(id) {
    return this.mutate(async () => {
      validateId(id);
      await this.load();
      const item = this.items.find((entry) => entry.id === id);
      if (!item) return;
      const sqlPath = path.join(this.sqlFolder, `${id}.sql`);
      const remaining = this.items.filter((entry) => entry.id !== id);
      this.items = remaining;
      try { await this.writeIndex(); }
      catch (error) { this.items.push(item); throw error; }
      await fs.rm(sqlPath, { force: true });
    });
  }
}

module.exports = { FavoritesStore, LIMIT };

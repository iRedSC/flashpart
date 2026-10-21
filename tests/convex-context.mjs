import assert from 'node:assert/strict';
import { hashValue } from '../convex/authUtils.ts';

export const sessionToken = 'test-session';
export async function context(seed = {}) {
  let serial = 0;
  const tables = { authSessions: [{ _id: 'session', tokenHash: await hashValue(sessionToken), userId: 'user', expiresAt: Date.now() + 60000 }], ...seed };
  const scheduled = [];
  const db = {
    query(table) {
      let rows = [...(tables[table] ?? [])];
      const query = {
        withIndex(_name, predicate) {
          const filter = { eq(key, value) { rows = rows.filter(row => row[key] === value); return filter; } };
          predicate?.(filter); return query;
        },
        order() { return query; },
        collect: async () => rows,
        first: async () => rows[0] ?? null,
        unique: async () => { assert.ok(rows.length <= 1); return rows[0] ?? null; },
      };
      return query;
    },
    get: async id => Object.values(tables).flat().find(row => row._id === id) ?? null,
    insert: async (table, value) => { const _id = `${table}-${++serial}`; (tables[table] ??= []).push({ ...value, _id }); return _id; },
    patch: async (id, patch) => { const row = await db.get(id); assert.ok(row, id); Object.assign(row, patch); },
    delete: async id => { for (const rows of Object.values(tables)) { const index = rows.findIndex(row => row._id === id); if (index >= 0) rows.splice(index, 1); } },
  };
  return { db, tables, scheduled, scheduler: { runAfter: async (...args) => scheduled.push(args) }, storage: { getUrl: async id => `https://test.invalid/${id}` } };
}

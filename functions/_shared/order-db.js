/**
 * Database ports for the website order ledger.
 * sqliteAdapter wraps node:sqlite for tests.
 * d1Adapter wraps Cloudflare D1. It is not executed against Production here.
 */

export function sqliteAdapter(database) {
  return {
    async get(sql, params = []) {
      const row = database.prepare(sql).get(...params);
      return row === undefined ? null : row;
    },
    async run(sql, params = []) {
      const result = database.prepare(sql).run(...params);
      return { changes: result.changes || 0 };
    },
  };
}

export function d1Adapter(d1) {
  function statement(sql, params) {
    const prepared = d1.prepare(sql);
    if (params && params.length) return prepared.bind(...params);
    return prepared;
  }
  return {
    async get(sql, params = []) {
      const row = await statement(sql, params).first();
      return row ?? null;
    },
    async run(sql, params = []) {
      const result = await statement(sql, params).run();
      return { changes: result.meta && result.meta.changes ? result.meta.changes : 0 };
    },
  };
}

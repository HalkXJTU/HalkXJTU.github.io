import { route } from './router.mjs';
import { unlockStatements } from './store.mjs';

function d1Store(db) {
  const bind = (sql, params) => db.prepare(sql).bind(...params);
  return {
    first: (sql, params) => bind(sql, params).first(),
    all: async sql => (await db.prepare(sql).all()).results,
    run: (sql, params) => bind(sql, params).run(),
    async unlock(hash, receipt, now) {
      if (!receipt) return bind('UPDATE invitations SET successes = successes + 1 WHERE code_hash = ? AND revoked = 0 RETURNING id', [hash]).first();
      const result = await db.batch(unlockStatements(hash, receipt, now).map(([sql, params]) => bind(sql, params)));
      return result[1].results[0];
    }
  };
}

export default {
  fetch(request, env) { return route(request, env, d1Store(env.DB)); }
};

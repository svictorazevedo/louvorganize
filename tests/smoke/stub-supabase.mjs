// Supabase falso: devolve linhas de globalThis.__DB. Só entende .eq(coluna, valor) simples
// (ignora o resto dos filtros). Serve para provar que as telas montam sem erro de código.
function builder(table) {
  let single = false; let write = false; const eqs = [];
  const b = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (res, rej) => {
          try {
            if (write) return res({ data: single ? { id: 'new-id' } : null, error: null });
            let rows = globalThis.__DB.tables[table] ?? [];
            for (const [k, v] of eqs) rows = rows.filter((r) => !(k in r) || r[k] === v);
            res({ data: single ? (rows[0] ?? null) : rows, error: null });
          } catch (e) { rej(e); }
        };
      }
      if (prop === 'eq') return (k, v) => { if (!k.includes('.')) eqs.push([k, v]); return b; };
      if (prop === 'single' || prop === 'maybeSingle') return () => { single = true; return b; };
      if (['insert', 'update', 'delete', 'upsert'].includes(prop)) return () => { write = true; globalThis.__DB.writes.push([table, prop]); return b; };
      return () => b;
    },
  });
  return b;
}
export function createClient() {
  return {
    from: (t) => builder(t),
    rpc: (name, args) => {
      globalThis.__DB.rpcs.push([name, args]);
      const f = globalThis.__DB.rpc[name];
      return Promise.resolve({ data: f ? f(args) : null, error: null });
    },
    auth: {
      getSession: async () => ({ data: { session: globalThis.__DB.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}), signInWithPassword: async () => ({ error: null }),
      signUp: async () => ({ data: { session: null }, error: null }), resetPasswordForEmail: async () => ({ error: null }),
      updateUser: async () => ({ error: null }),
    },
  };
}

// Redireciona o CDN do Supabase e o config.js para versões de teste.
const here = new URL('./', import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('https://cdn.jsdelivr.net/npm/@supabase/')) {
    return { url: new URL('./stub-supabase.mjs', here).href, shortCircuit: true };
  }
  if (specifier.endsWith('/config.js') && context.parentURL?.includes('/js/lib/api.js')) {
    return { url: new URL('./config-test.mjs', here).href, shortCircuit: true };
  }
  return next(specifier, context);
}

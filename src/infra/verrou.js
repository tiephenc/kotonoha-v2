// KOTONOHA 2.0 · verrou d'exclusion pour une base (même appareil : onglets entre eux). Les décisions
// du cycle de vie d'un effacement (08 §19.16) — annuler en E2, figer un lot, l'envoyer — ne doivent
// jamais s'entrecroiser entre deux onglets. Dans un navigateur : Web Locks (partagé entre les onglets
// d'une même origine). Sans Web Locks (Node, tests) : une file en mémoire, par objet de magasin.
const files = new WeakMap();

/**
 * Exécute `fn` en exclusion pour ce magasin. Non réentrant : `fn` ne doit pas redemander le verrou.
 * @template T @param {any} store @param {() => Promise<T>} fn @returns {Promise<T>}
 */
export function exclusif(store, fn) {
  const locks = globalThis.navigator?.locks;
  if (locks) return locks.request(`kotonoha2-effacement-${store.name}`, fn);
  const prev = files.get(store) || Promise.resolve();
  const run = prev.then(fn, fn);
  files.set(store, run.catch(() => {}));
  return run;
}

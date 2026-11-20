// KOTONOHA 2.0 · persistance du stockage (08 §10.7) : stockage persistant, espace disponible,
// détection d'une éviction. `localStorage` ne porte que le pointeur de la base active (préfixe
// `kotonoha2.`) ; aucune clé de la V1 (`kotonoha.…`) n'est lue ni écrite (INV-04).

export const POINTER_KEY = 'kotonoha2.pointeur';
export const ALERT_RATIO = 0.8; // [Hyp] 08 §10.7

/** Demande le stockage persistant (après la première séance, 07 §17.8). @returns {Promise<boolean|null>} */
export async function requestPersist() {
  if (!navigator.storage?.persist) return null;
  return navigator.storage.persist();
}

/** État du stockage : persistant ou non, usage, quota, alerte. */
export async function storageState() {
  const s = navigator.storage;
  const persisted = s?.persisted ? await s.persisted() : null;
  const est = s?.estimate ? await s.estimate() : null;
  const ratio = est && est.quota ? est.usage / est.quota : null;
  return { persisted, usage: est?.usage ?? null, quota: est?.quota ?? null, ratio, alert: ratio !== null && ratio > ALERT_RATIO };
}

/** @param {string} db @returns {{db: string, n: number, at: number}|null} */
export function readPointer(db) {
  try { const p = JSON.parse(localStorage.getItem(POINTER_KEY) || 'null'); return p && p[db] ? p[db] : null; } catch { return null; }
}

/** Mémorise le nombre d'opérations enregistrées dans la base. Un échec est sans conséquence sur les données. */
export function writePointer(db, n, at) {
  try { const p = JSON.parse(localStorage.getItem(POINTER_KEY) || '{}') || {}; p[db] = { db, n, at }; localStorage.setItem(POINTER_KEY, JSON.stringify(p)); return true; } catch { return false; }
}

/**
 * Éviction probable (T-STO-02) : le pointeur annonce des opérations, la base n'en contient plus.
 * @param {string} db @param {number} n opérations lues
 */
export function evictionOf(db, n) {
  const p = readPointer(db);
  return p && p.n > n ? { expected: p.n, found: n, since: p.at } : null;
}

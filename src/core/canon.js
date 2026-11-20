// KOTONOHA 2.0 · forme canonique, arrondis et empreintes (08 §7.5, §10.2-10.3). Domaine pur.

/** Précision des comparaisons d'états dérivés : six décimales (08 §7.5, égalité sémantique). */
export const DECIMALS = 6;

/** Arrondi fixe, à appliquer avant toute réinjection dans un calcul (08 §7.5, « pas d'accumulation »). @param {number} x */
export function round(x, d = DECIMALS) {
  if (!Number.isFinite(x)) throw new Error('nombre non fini');
  const f = 10 ** d; const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * JSON canonique : clés triées, `undefined` ignoré. `rounded` : nombres non entiers arrondis à
 * DECIMALS. La forme EXACTE sert à l'identité des opérations, objets et sauvegardes (INV-07) ; la
 * forme ARRONDIE sert seulement à comparer des états dérivés entre moteurs (08 §7.5).
 * @param {unknown} v @param {boolean} [rounded] @returns {string}
 */
export function canonical(v, rounded = false) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('nombre non fini'); return JSON.stringify(rounded && !Number.isInteger(v) ? round(v) : Object.is(v, -0) ? 0 : v); }
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x, rounded)).join(',')}]`;
  if (typeof v === 'object') {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k], rounded)}`).join(',')}}`;
  }
  throw new Error(`valeur non sérialisable : ${typeof v}`);
}

/** SHA-256 hexadécimal d'une chaîne (Web Crypto, navigateur et Node). @param {string} s */
export async function sha256(s) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Empreinte de la forme canonique exacte. @param {unknown} v */
export const hashOf = (v) => sha256(canonical(v));
/** Empreinte de la forme canonique arrondie (états dérivés). @param {unknown} v */
export const hashRounded = (v) => sha256(canonical(v, true));

/** Copie profonde d'une valeur JSON. @template T @param {T} v @returns {T} */
export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

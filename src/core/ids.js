// KOTONOHA 2.0 · MOD-01 core/ids — identifiants (08 §5, D-64). Domaine pur : aucun accès au DOM,
// au stockage ni au réseau. L'aléa vient de crypto.getRandomValues (navigateur et Node).

/** Espaces de noms que la V2 génère. `anki:` et `v1:` ne sont jamais générés (08 §5.2, §5.5). */
export const GENERATED = Object.freeze(['op', 'lot', 'dev', 'ku']);
export const NEVER_GENERATED = Object.freeze(['anki', 'v1']);

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** État du générateur : dernier horodatage et compteur (RFC 9562 §6.2, méthode 1, 12 bits). */
const gen = { ms: -1, seq: 0 };

/** @param {number} n */
function randomBytes(n) { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; }

/**
 * UUIDv7 monotone : 48 bits d'horodatage en millisecondes, 12 bits de compteur (rand_a), 62 bits
 * aléatoires. Dans une même milliseconde, ou si l'horloge recule, le compteur croît ; s'il déborde,
 * l'horodatage avance d'une milliseconde. L'identifiant nomme ; il n'ordonne pas les opérations (§5.2).
 * @param {number} [now] horloge physique en millisecondes (injectable pour les tests)
 * @returns {string}
 */
export function uuidv7(now = Date.now()) {
  let ms = Math.floor(now);
  if (ms > gen.ms) { gen.ms = ms; gen.seq = randomBytes(1)[0]; } // départ aléatoire de 0 à 255 : au moins 3 840 identifiants par milliseconde
  else { gen.seq++; if (gen.seq > 0xfff) { gen.ms++; gen.seq = 0; } ms = gen.ms; }
  const r = randomBytes(8);
  const b = new Uint8Array(16);
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = 0x70 | (gen.seq >> 8); b[7] = gen.seq & 0xff;
  b[8] = 0x80 | (r[0] & 0x3f); for (let i = 1; i < 8; i++) b[8 + i] = r[i];
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Horodatage en millisecondes porté par un UUIDv7. @param {string} u */
export function uuidv7Time(u) { return parseInt(u.replace(/-/g, '').slice(0, 12), 16); }

/** @param {string} u */
export const isUuidv7 = (u) => typeof u === 'string' && HEX.test(u);

/** Registre des identifiants réservés (08 §5.5) : vide tant que Q-08 n'est pas tranchée. */
let reserved = new Set();
/** @param {Iterable<string>|{has: (id: string) => boolean}} ids ensemble, ou objet qui répond à has() */
export function setReserved(ids) { reserved = typeof ids?.has === 'function' ? ids : new Set(ids); }
/** @param {string} id */
export const isReserved = (id) => reserved.has(id);

/**
 * Nouvel identifiant d'un espace généré. Un identifiant réservé n'est jamais rendu (T-ID-02).
 * @param {'op'|'lot'|'dev'|'ku'} ns
 * @param {string} [type] pour `ku:` (obj, doc, snap, bak, ses, cut…)
 * @param {number} [now]
 */
export function newId(ns, type, now) {
  if (NEVER_GENERATED.includes(ns)) throw new Error(`espace « ${ns}: » : jamais généré par la V2`);
  if (!GENERATED.includes(ns)) throw new Error(`espace inconnu : ${ns}`);
  if (ns === 'ku' && !/^[a-z]{2,8}$/.test(type || '')) throw new Error('ku: exige un type');
  for (let i = 0; i < 16; i++) {
    const id = ns === 'ku' ? `ku:${type}:${uuidv7(now)}` : `${ns}:${uuidv7(now)}`;
    if (!reserved.has(id)) return id;
  }
  throw new Error('générateur : identifiants réservés en série');
}

/**
 * Vérifie la forme d'un identifiant généré.
 * @param {string} id @param {'op'|'lot'|'dev'|'ku'} ns @param {string} [type]
 */
export function isId(id, ns, type) {
  if (typeof id !== 'string') return false;
  const p = ns === 'ku' ? `ku:${type ?? '[a-z]{2,8}'}:` : `${ns}:`;
  const m = new RegExp(`^${p}(.+)$`).exec(id);
  return !!m && isUuidv7(m[1]);
}

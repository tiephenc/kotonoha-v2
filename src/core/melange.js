// KOTONOHA 2.0 · mélange déterministe des options d'un exercice (PH-4 ; rapport V5 §5.7 : « position de la clé équilibrée, chaque
// position à 100/n ± 5 points pour n options »). Le corpus V1 place la bonne réponse TOUJOURS en première position (les 942 questions
// de quiz, les 471 de lecture et les 314 d'écoute, soit 1 727 sur 1 727, toutes à l'index 0) : la V1 mélangeait à l'affichage (`qBlock`/`shuffle`), la V2
// mélange ici, dans le domaine, avant tout affichage. Domaine pur : aucune lecture du DOM, du stockage ni de l'horloge.
// La graine est celle de la SESSION (stockée par l'interface) combinée à l'identifiant de l'item : le même item a le même ordre
// pendant toute la session, y compris après rechargement, et un ordre indépendant des autres items.

/** FNV-1a 32 bits. @param {string} s */
export function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** Générateur reproductible (mulberry32) à partir d'un texte. @param {string} graine */
export function rng(graine) {
  let a = hash32(String(graine)) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Permutation de [0, n) (Fisher-Yates). @param {number} n @param {string} graine */
export function permutation(n, graine) {
  const r = rng(graine), p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}
/** Nouvelle graine de session (aléatoire, 8 caractères hexadécimaux). */
export function nouvelleGraine(alea = globalThis.crypto) {
  const b = new Uint8Array(4); alea.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Mélange les options d'un item QCM et recalcule l'index de la bonne réponse. L'item reçu n'est pas modifié.
 * @template {{id: string, options: string[], reponse: number}} T
 * @param {T} item @param {string} graine graine de session
 * @returns {T & {ordre: number[]}} `ordre[k]` : index d'origine de l'option affichée en position k
 */
export function melangerOptions(item, graine) {
  const n = item.options.length;
  const ordre = permutation(n, `${graine}|${item.id}`);
  return { ...item, options: ordre.map((i) => item.options[i]), reponse: ordre.indexOf(item.reponse), ordre };
}

/** Mélange l'affichage d'un item d'exercice, quel que soit son type (QCM : options ; phrase à ordonner : segments). */
export function melangerItem(item, graine) {
  if (item.type === 'trace') return item; // écriture : rien à mélanger
  return item.type === 'ordonner' ? { ...item, ordre: melangerSegments(item.segments, `${graine}|${item.id}`) } : melangerOptions(item, graine);
}

/**
 * Mélange les segments d'une phrase à reconstituer ; le résultat n'est jamais l'ordre d'origine quand c'est possible.
 * @param {string[]} segments @param {string} graine @returns {number[]} ordre d'affichage (index d'origine)
 */
export function melangerSegments(segments, graine) {
  const n = segments.length;
  let ordre = permutation(n, graine);
  const identique = (o) => o.every((i, k) => segments[i] === segments[k]);
  if (n > 1 && identique(ordre)) {
    const distincts = new Set(segments).size > 1;
    if (distincts) { for (let d = 1; d < n && identique(ordre); d++) ordre = ordre.map((_, k) => (k + d) % n); }
  }
  return ordre;
}

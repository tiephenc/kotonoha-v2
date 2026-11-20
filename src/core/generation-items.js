// KOTONOHA 2.0 · banque d'items à choix : génération déterministe et contrôle (rapport V5 §5.7, ligne « Distracteurs »).
// Domaine pur : aucune E/S, aucune horloge, aucun alea hors de la graine. Réutilisable par tout niveau.
// Les seuils sont ceux PROPOSÉS au §5.7 (P-30 n'est pas décidée) : le contrôle MESURE et rapporte, il ne certifie pas.

/** Tolérance proposée au §5.7 : chaque position de la clé à 100/n ± 5 points de pourcentage. */
export const TOLERANCE_POSITION = 5;

/** Graine (chaîne ou entier) → générateur pseudo-aléatoire uniforme [0, 1) (xmur3 puis mulberry32). */
export function generateur(graine) {
  let h = 1779033703 ^ String(graine).length;
  for (const c of String(graine)) { h = Math.imul(h ^ c.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const melange = () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  a = melange();
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Mélange de Fisher-Yates : renvoie une copie, ne modifie pas l'entrée. */
export function melanger(liste, rng) {
  const a = [...liste];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Normalisation de comparaison des options : NFC, espaces de bord retirés. */
export const normaliser = (s) => String(s).normalize('NFC').trim();

/**
 * Positions de la clé : suite de longueur `effectif` où chaque position 0..n-1 apparaît à une unité près
 * (équilibre exact), puis mélangée par la graine. Contrairement à un tirage indépendant, aucune banque ne dérive.
 */
export function positionsEquilibrees(effectif, n, rng) {
  return melanger(Array.from({ length: effectif }, (_, i) => i % n), rng);
}

/**
 * Génère une banque d'items à choix, de façon déterministe.
 * @param {{ cibles: {id: string, enonce: string, reponse: string, candidats: {raison: string, valeurs: string[]}[], extra?: object}[],
 *   n?: number, graine: string|number }} p
 *   `candidats` : paliers de distracteurs par ordre de proximité ; au sein d'un palier l'ordre est mélangé par la graine.
 *   Une valeur égale à la réponse (après normalisation) ou déjà retenue est ignorée (jamais deux réponses, jamais de doublon).
 * @returns {{ id: string, enonce: string, options: string[], cle: number, reponse: string, distracteurs: {valeur: string, raison: string}[] }[]}
 */
export function genererBanque({ cibles, n = 4, graine }) {
  if (!Number.isInteger(n) || n < 2) throw new Error('n doit être un entier au moins égal à 2');
  const ids = new Set();
  for (const c of cibles) { if (ids.has(c.id)) throw new Error(`cible en double : ${c.id}`); ids.add(c.id); }
  const rng = generateur(graine);
  const positions = positionsEquilibrees(cibles.length, n, rng);
  return cibles.map((c, i) => {
    const rep = normaliser(c.reponse), vus = new Set([rep]), choisis = [];
    for (const palier of c.candidats) {
      for (const v of melanger(palier.valeurs, rng)) {
        if (choisis.length >= n - 1) break;
        const k = normaliser(v);
        if (!k || vus.has(k)) continue;
        vus.add(k); choisis.push({ valeur: v, raison: palier.raison });
      }
    }
    if (choisis.length < n - 1) throw new Error(`${c.id} : ${choisis.length} distracteurs trouvés, ${n - 1} requis`);
    const ordre = melanger(choisis, rng), cle = positions[i];
    const options = ordre.map((d) => d.valeur); options.splice(cle, 0, c.reponse);
    return { id: c.id, enonce: c.enonce, options, cle, reponse: c.reponse, distracteurs: ordre, ...(c.extra ? { extra: c.extra } : {}) };
  });
}

/**
 * Contrôle d'une banque (rapport V5 §5.7). Mesures rapportées, aucun seuil décidé : seule la tolérance de position
 * (100/n ± 5) est celle proposée au §5.7.
 * Échecs d'item : clé hors options ou non unique ; options en double (après normalisation) ; nombre d'options ≠ n ;
 * énoncé en double (doublon interne). Échec de banque : une position hors de 100/n ± 5 points.
 * @param {{id: string, enonce: string, options: string[], cle: number}[]} items
 * @param {{ n?: number, tolerance?: number }} [o]
 */
export function controlerBanque(items, { n = 4, tolerance = TOLERANCE_POSITION } = {}) {
  const echecs = [];
  const e = (id, motif) => echecs.push({ id, motif });
  const enonces = new Map(), ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) e(it.id, 'identifiant en double'); ids.add(it.id);
    if (!Array.isArray(it.options) || it.options.length !== n) { e(it.id, `nombre d'options différent de ${n}`); continue; }
    const norm = it.options.map(normaliser);
    if (new Set(norm).size !== norm.length) e(it.id, 'options en double');
    if (norm.some((o) => !o)) e(it.id, 'option vide');
    if (!Number.isInteger(it.cle) || it.cle < 0 || it.cle >= n) { e(it.id, 'clé hors des options'); continue; }
    if (it.reponse !== undefined && normaliser(it.reponse) !== norm[it.cle]) e(it.id, 'la clé ne désigne pas la réponse');
    if (it.reponse !== undefined && norm.filter((o) => o === normaliser(it.reponse)).length !== 1) e(it.id, 'clé non unique');
    const k = normaliser(it.enonce);
    if (enonces.has(k)) e(it.id, `énoncé en double de ${enonces.get(k)}`); else enonces.set(k, it.id);
  }
  const effectif = items.length, comptes = Array(n).fill(0);
  for (const it of items) if (Number.isInteger(it.cle) && it.cle >= 0 && it.cle < n) comptes[it.cle]++;
  const cible = 100 / n;
  const parts = comptes.map((c) => (effectif ? (100 * c) / effectif : 0));
  const ecartMax = Math.max(...parts.map((p) => Math.abs(p - cible)));
  const equilibre = effectif > 0 && ecartMax <= tolerance;
  if (!equilibre) echecs.push({ id: '(banque)', motif: `position de la clé hors de ${cible} ± ${tolerance} points (écart max ${ecartMax.toFixed(2)})` });
  return { ok: echecs.length === 0, effectif, n, positions: { comptes, parts, cible, tolerance, ecartMax, equilibre }, echecs };
}

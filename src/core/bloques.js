// KOTONOHA 2.0 · identifiants d'exercices bloqués (décision du 2026-11-15, registre 11 §9.6).
// 1 890 identifiants distincts : les 1 888 du canon V200 et deux questions TRY imprimées,
// TRY-N3-YATTE-G050-A-Q04 et TRY-N3-YATTE-G059-A-Q04. Tous sous verrou de publication et de préservation.
// Ensemble DISTINCT des 11 041 notes Anki : aucun contrôle de l'un ne vaut pour l'autre.
// Domaine pur : le manifeste (donnees/identifiants-bloques-1890.tsv) est fourni en texte ; tout écart est fatal.
import { setReserved } from './ids.js';

export const MANIFESTE_SHA256 = '8190cfb837f7aa010e4d4c112d3df2a7d666c0d9398ecb354f308f21489318d0';
export const TOTAL = 1890;
export const CANON_V200 = 1888;
export const AJOUTS = Object.freeze(['TRY-N3-YATTE-G050-A-Q04', 'TRY-N3-YATTE-G059-A-Q04']);
const ENTETE = 'id\torigine\tsha256_ligne';

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Lit et vérifie le manifeste ; rend l'ensemble figé des 1 890 identifiants. Échoue au moindre écart
 * (empreinte, en-tête, doublon, effectif, origine), sans jamais compléter ni corriger la liste.
 * @param {string} texte
 * @returns {Promise<ReadonlySet<string>>}
 */
export async function chargerBloques(texte) {
  const empreinte = hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)));
  if (empreinte !== MANIFESTE_SHA256) throw new Error(`manifeste des identifiants bloqués altéré : ${empreinte}`);
  const [entete, ...lignes] = texte.split('\n').filter((l) => l !== '');
  if (entete !== ENTETE) throw new Error('manifeste : en-tête inattendu');
  const ids = new Set(), origines = { V200: 0, V230: 0 };
  for (const l of lignes) {
    const [id, origine, h] = l.split('\t');
    if (!id || !/^[0-9a-f]{64}$/.test(h || '') || !(origine in origines)) throw new Error(`manifeste : ligne invalide « ${l.slice(0, 60)} »`);
    if (ids.has(id)) throw new Error(`manifeste : identifiant en double ${id}`);
    ids.add(id); origines[origine]++;
  }
  if (ids.size !== TOTAL || origines.V200 !== CANON_V200 || origines.V230 !== AJOUTS.length || !AJOUTS.every((a) => ids.has(a)))
    throw new Error(`manifeste : composition inattendue (${ids.size} ; V200 ${origines.V200} ; V230 ${origines.V230})`);
  return Object.freeze(ids);
}

/**
 * Collisions entre des identifiants d'un catalogue (identifiants, localisateurs, cibles d'alias) et les identifiants
 * bloqués. Une collision est fatale au chargement : un contenu ne peut ni porter ni viser un identifiant bloqué.
 * @param {Iterable<string>} identifiants
 * @param {ReadonlySet<string>} bloques
 */
export function verifierCollisions(identifiants, bloques) {
  const out = new Set();
  for (const id of identifiants) if (bloques.has(id)) out.add(id);
  return [...out];
}

/** Inscrit les identifiants bloqués au registre des identifiants réservés (08 §5.5, §19.5) : jamais générés ni réutilisés. */
export function reserverBloques(bloques) { setReserved(bloques); }

export const MOTIFS = Object.freeze({
  'verrou-retire': 'identifiant bloqué : la publication reste interdite',
  'absent': 'identifiant bloqué absent du catalogue : ni suppression ni remplacement',
  'reattribue': 'identifiant bloqué réattribué à un autre contenu',
  'alias-non-demontre': 'alias vers un identifiant bloqué sans preuve : refusé',
  'variante-non-attestee': 'variante libre non attestée : jamais certifiée',
  'graphique-non-conforme': 'graphique annoté non conforme : refusé, correction humaine requise',
});

/**
 * Contrôle d'un catalogue d'exercices au regard des identifiants bloqués. Ne modifie rien ; rend les écarts.
 * @param {{id: string, publication?: string, empreinte?: string, aliasDe?: string, preuveAlias?: string,
 *   variante?: 'libre'|'attestee', graphique?: {conforme: boolean}}[]} items
 * @param {ReadonlySet<string>} bloques
 * @param {Map<string, string>} [empreintesReference] identifiant → empreinte du contenu de référence
 */
export function controlerCatalogue(items, bloques, empreintesReference) {
  const ecarts = [], vus = new Set();
  const e = (id, motif) => ecarts.push({ id, motif, texte: MOTIFS[motif] });
  for (const it of items) {
    if (bloques.has(it.id)) {
      vus.add(it.id);
      if (it.publication !== 'BLOQUEE') e(it.id, 'verrou-retire');
      if (empreintesReference?.has(it.id) && it.empreinte !== empreintesReference.get(it.id)) e(it.id, 'reattribue');
      if (it.variante === 'libre') e(it.id, 'variante-non-attestee');
      if (it.graphique && it.graphique.conforme !== true) e(it.id, 'graphique-non-conforme');
    }
    if (it.aliasDe !== undefined && bloques.has(it.aliasDe) && !it.preuveAlias) e(it.id, 'alias-non-demontre');
  }
  for (const id of bloques) if (!vus.has(id)) e(id, 'absent');
  return ecarts;
}

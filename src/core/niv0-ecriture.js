// KOTONOHA 2.0 · NIV-0 : écriture interactive des kana. Items d'écriture, groupes, file de reprise. Domaine pur : aucune E/S, aucun DOM.
// Un item d'écriture = UN kana. Identité stable et déterministe, dans la nomenclature des items NIV-0 existants
// (`niv0:item:lecture:hira:a`, `niv0:item:kana:hira:a`) : `niv0:item:ecriture:hira:a`. Il porte la facette S-ECR (écriture d'un kana, 02 §11.2 :
// déjà déclarée dans consolidation.js) sur l'élément `niv0:hira:a` : une réponse s'enregistre donc au sujet `kf:niv0:hira:a#S-ECR`, que le
// moteur de consolidation fait évoluer et que la vue Révisions sait proposer, comme toute facette. Aucune opération nouvelle.
import { facetSubject } from './consolidation.js';
import { HORS_NIVEAU } from './statut-niveau.js';
import { permutation } from './melange.js';
import { dispositionPetit, dispositionYoon } from './kana-yoon.js';

export const FACETTE_ECRITURE = 'S-ECR';
/** Nombre maximal de reprises d'un même kana raté dans une séance (le retour est espacé : voir `reinserer`). */
export const MAX_REPRISES = 2;
/** Écart (en questions) avant qu'un kana raté revienne dans la séance. */
export const ECART_REPRISE = 3;

/** Identifiant d'item d'écriture d'un signe (`niv0:hira:a` → `niv0:item:ecriture:hira:a`). */
export const idItemEcriture = (entreeId) => `niv0:item:ecriture:${entreeId.replace(/^niv0:/, '')}`;
/** Sujet de journal (facette) des réponses d'écriture d'un signe : `kf:niv0:hira:a#S-ECR`. */
export const sujetEcriture = (entreeId) => facetSubject(`kc:${entreeId}`, FACETTE_ECRITURE);

const NOM = { hiragana: 'hiragana', katakana: 'katakana' };

/** Tracés d'un signe composé : les deux caractères d'un yōon (き + ゃ) sont cherchés dans les tracés des signes d'un caractère. */
const parCaractere = new WeakMap();
const indexCaracteres = (traces) => {
  let m = parCaractere.get(traces);
  if (!m) { m = new Map(Object.values(traces.kana).map((k) => [k.caractere, k])); parCaractere.set(traces, m); }
  return m;
};
/** Les deux tracés d'un yōon (premier signe, petit signe), ou null. Un yōon hors parcours (ぢゃ…, presque inemployés) n'a pas d'item. */
function tracesYoon(entree, traces) {
  if (entree.type !== 'yoon' || entree.parcours === false) return null;
  const [c1, c2, ...reste] = [...entree.caractere];
  if (!c2 || reste.length) return null;
  const idx = indexCaracteres(traces), t1 = idx.get(c1), t2 = idx.get(c2);
  return t1 && t2 ? [t1, t2] : null;
}
/** Un signe a-t-il de quoi s'écrire (tracé propre, ou deux tracés composés pour un yōon) ? */
export const aUnTrace = (entree, traces) => !!traces.kana[entree.id] || tracesYoon(entree, traces) !== null;

/**
 * Item d'écriture d'un signe, ou null s'il n'a pas de tracé.
 * Le signe n'est montré dans l'énoncé que s'il n'a pas de lecture propre ou si sa lecture est partagée avec un autre signe (ぢ, づ, を…) : l'énoncé
 * désigne alors le signe lui-même (`copie` : copie d'un modèle montré, enregistrée comme réponse aidée).
 * Deux dispositions particulières (`disposition`, kana-yoon.js) : un petit kana (ゃ, っ, ぁ…) s'écrit petit, en bas à gauche de sa case ; un yōon
 * (きゃ…) s'écrit en deux caractères, le second petit. Leur identité d'item reste celle du signe (`niv0:item:ecriture:hira:kya`).
 * @param {{id: string, caractere: string, ecriture: string, romanisation?: string, secondaire?: boolean, type?: string, parcours?: boolean}} entree
 * @param {{kana: Record<string, {traits: string[], caractere: string}>}} traces contenu de kana-traces.json
 */
export function itemEcriture(entree, traces) {
  const t = traces.kana[entree.id], deux = t ? null : tracesYoon(entree, traces);
  if (!t && !deux) return null;
  const copie = !entree.romanisation || entree.secondaire === true;
  const nom = NOM[entree.ecriture] ?? entree.ecriture;
  let question = copie ? `Écrivez ce signe (${nom}) : ${entree.caractere}` : `Écrivez en ${nom} le signe qui se lit « ${entree.romanisation} ».`;
  let traits = t?.traits, disposition;
  if (deux) {
    traits = [...deux[0].traits, ...deux[1].traits];
    disposition = dispositionYoon(deux[0].traits, deux[1].traits);
    question += ' Deux caractères : le second est petit, en bas à droite du premier.';
  } else if (entree.type === 'petit') {
    disposition = dispositionPetit(t.traits);
    question += ' Petit signe : écrivez-le petit, en bas à gauche de la case.';
  }
  return { id: idItemEcriture(entree.id), element: entree.id, facette: FACETTE_ECRITURE, type: 'trace', source: 'ecriture', statut: HORS_NIVEAU, niveau: null,
    entreeId: entree.id, caractere: entree.caractere, ecriture: entree.ecriture, lecture: entree.romanisation || '', copie, question, traits, ...(disposition ? { disposition } : {}) };
}

/** Tous les items d'écriture (un par signe qui a un tracé), dans l'ordre de kana.json. */
export function itemsEcriture(doc, traces) {
  return doc.entrees.map((e) => itemEcriture(e, traces)).filter(Boolean);
}

/** Groupes du parcours restreints aux signes qui ont un tracé (un groupe sans signe tracé disparaît). @param {object[]} groupes issus de `groupesParcours` */
export function groupesEcriture(groupes, traces) {
  return groupes.map((g) => ({ ...g, signes: g.signes.filter((s) => aUnTrace(s, traces)) })).filter((g) => g.signes.length > 0);
}

/**
 * Avancement de l'écriture d'un groupe, lu dans la vue dérivée du journal (`view.learn`, par sujet de facette).
 * @returns {{total: number, essayes: number, reussis: number}} essayés : au moins une réponse ; réussis : au moins une réponse juste
 */
export function avancementEcriture(groupe, view) {
  const learn = view.learn ?? {};
  let essayes = 0, reussis = 0;
  for (const s of groupe.signes) { const l = learn[sujetEcriture(s.id)]; if (l?.n > 0) essayes++; if (l?.ok > 0) reussis++; }
  return { total: groupe.signes.length, essayes, reussis };
}

/** Un item est « à reprendre » si sa facette a des oublis non réparés (échecs consécutifs) ou est en reprise (MF). @param {Record<string, any>} facets */
export function aReprendre(item, facets, learn = {}) {
  const k = sujetEcriture(item.entreeId ?? item.element);
  const r = facets?.[k], l = learn?.[k];
  // Tenté sans jamais réussir : la facette n'existe pas encore dans le moteur (un échec avant M2 n'est qu'un réenseignement), mais le kana est à reprendre.
  return (!!r && (r.fails > 0 || r.state === 'MF')) || (!!l && l.n > 0 && !(l.ok > 0));
}

/**
 * Ordre d'une séance : les kana à reprendre d'abord (ils reviennent plus souvent), puis les autres ; ordre stable et déterministe pour une graine.
 * @param {object[]} items @param {{facets?: Record<string, any>, learn?: Record<string, any>, graine?: string}} [o] learn : vue dérivée (view.learn)
 */
export function ordreSeance(items, { facets = {}, learn = {}, graine = '' } = {}) {
  const ordre = permutation(items.length, `${graine}|ecriture`).map((i) => items[i]);
  const prioritaires = ordre.filter((it) => aReprendre(it, facets, learn));
  return [...prioritaires, ...ordre.filter((it) => !aReprendre(it, facets, learn))];
}

/**
 * File de reprise : après un kana raté, le même item revient ECART_REPRISE questions plus loin (ou en fin de file), au plus MAX_REPRISES fois.
 * Fonction pure : renvoie la nouvelle file et le compteur de reprises mis à jour.
 * @param {object[]} file items restants (le courant a été retiré) @param {object} item l'item raté @param {Record<string, number>} reprises
 * @returns {{file: object[], reprises: Record<string, number>, reinsere: boolean}}
 */
export function reinserer(file, item, reprises) {
  const n = reprises[item.id] ?? 0;
  if (n >= MAX_REPRISES) return { file, reprises, reinsere: false };
  const pos = Math.min(ECART_REPRISE, file.length);
  return { file: [...file.slice(0, pos), item, ...file.slice(pos)], reprises: { ...reprises, [item.id]: n + 1 }, reinsere: true };
}

// KOTONOHA 2.0 · Q-12 core/statut-niveau : statut de niveau d'un élément, calculé à partir de ses repères.
// Fonction pure : le corpus V1 n'est jamais modifié ; la surcouche est en ajout seul.
// Règle 6 : le statut de provenance (`statut`) et le niveau JLPT (`niveau`) sont deux champs distincts,
// jamais fusionnés dans une seule valeur.
export const LEVELS = Object.freeze(['N5', 'N4', 'N3', 'N2', 'N1']); // du plus facile au plus difficile
/** `hors-niveau` (décision D2 du 2026-11-18) : contenu sans niveau JLPT propre (kana, mots d'exemple de longueur). Il n'est PAS estimé. */
export const HORS_NIVEAU = 'hors-niveau';
export const STATUSES = Object.freeze(['verifie', 'estime-un-repere', 'estime-v1', 'estime-editorial-nouveau', 'non-disponible', HORS_NIVEAU]);
export const ESTIMATED = Object.freeze(['estime-un-repere', 'estime-v1', 'estime-editorial-nouveau']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** D-55-a adopté le 2026-11-15 (registre 11 §9.2) : l'appelant passe `{ d55a: D55A_ADOPTE }`. Ne lève jamais D-55. */
export const D55A_ADOPTE = true;

/**
 * Famille d'un repère.
 * - Règle 1 : tout ce qui dérive de Waller (ou de tanos.co.uk) forme UNE seule famille, 'waller'.
 * - Règle 2 : une famille n'existe que si l'origine est déclarée (`derive` ou `origine`). Un repère
 *   sans origine déclarée renvoie `null` : il n'est jamais une famille indépendante.
 */
export const familyOf = (r) => {
  if (r.derive === 'waller' || /waller|tanos/i.test(r.source || '') || /waller|tanos/i.test(r.origine || '')) return 'waller';
  const o = (typeof r.derive === 'string' && r.derive.trim()) || (typeof r.origine === 'string' && r.origine.trim());
  return o || null;
};
/** Repère utilisable : licence vérifiée à la source, consultation datée, niveau N5–N1. */
const usable = (r) => r.licence === 'verifiee' && DATE.test(r.date || '') && LEVELS.includes(r.niveau);
/** Règle 5 : en cas d'incertitude entre plusieurs niveaux, le plus facile (le plus proche de N5). */
export const easiest = (ls) => [...ls].sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b))[0];
const sortLevels = (ls) => [...ls].sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b));

/**
 * @param {{v1?: string, nouveau?: boolean, propose?: string, reperes?: any[], justification?: {utilite?: string, frequence?: string, progression?: string}, derniereRecherche?: string}} el
 * @param {{d55a?: boolean}} [o] d55a : l'addendum D-55-a est intégré formellement (sinon le cinquième statut n'existe pas).
 *   Règle 11 : d55a n'intervient QUE dans la branche « nouvel élément sans repère » ; il ne produit jamais `verifie`.
 */
export function statusOf(el, { d55a = false } = {}) {
  if (el.v1 !== undefined && el.nouveau) throw new Error('un élément est soit du corpus V1, soit nouveau');
  if (el.v1 !== undefined && !LEVELS.includes(el.v1)) throw new Error(`niveau V1 invalide : ${el.v1}`);
  const all = el.reperes || [], ok = all.filter(usable), ecartes = all.filter((r) => !usable(r)).map((r) => r.source);
  const indep = ok.filter((r) => familyOf(r) !== null);              // origine déclarée
  const origineInconnue = ok.filter((r) => familyOf(r) === null).map((r) => r.source);
  const byLevel = {};                                                 // niveau -> familles indépendantes qui le donnent
  for (const r of indep) (byLevel[r.niveau] ||= new Set()).add(familyOf(r));
  const families = new Set(indep.map(familyOf));
  const okLevels = sortLevels(new Set(ok.map((r) => r.niveau)));      // tous les repères utilisables, origine connue ou non
  const divergences = okLevels.length > 1 ? okLevels : [];
  const agreed = Object.keys(byLevel).filter((l) => byLevel[l].size >= 2);
  const out = (statut, niveau, extra = {}) => ({ statut, niveau, familles: families.size, origineInconnue, divergences, ecartes, ...extra });
  if (el.horsNiveau === true) {                                       // D2 : déclaré, jamais déduit ; aucun niveau, aucun repère
    if (el.v1 !== undefined || all.length || el.propose !== undefined) throw new Error('un élément hors-niveau n’a ni niveau V1, ni repère, ni niveau proposé');
    return out(HORS_NIVEAU, null, { note: 'hors échelle JLPT : jamais présenté comme certifié ni comme d’un niveau' });
  }
  if (agreed.length) {
    const niveau = easiest(agreed);
    if (el.v1 !== undefined && el.v1 !== niveau) return out('estime-v1', el.v1, { note: `repères concordants ${niveau}, différents du niveau V1 : arbitrage éditorial` });
    return out('verifie', niveau);
  }
  if (ok.length) {
    // Aucune concordance de deux familles indépendantes : au mieux une estimation.
    if (el.v1 !== undefined) {                                        // règle 3 : le niveau V1 n'est jamais écrasé
      return okLevels.length === 1 && okLevels[0] === el.v1 ? out('estime-un-repere', el.v1) : out('estime-v1', el.v1, { note: 'repère divergent ou repères non concordants : niveau V1 conservé' });
    }
    if (okLevels.length === 1) return out('estime-un-repere', okLevels[0]);
    return out('estime-un-repere', easiest(okLevels), { note: `repères non concordants (${okLevels.join(', ')}) : niveau le plus facile retenu` });
  }
  if (el.v1 !== undefined) return out('estime-v1', el.v1);
  const j = el.justification || {}, complete = ['utilite', 'frequence', 'progression'].every((k) => typeof j[k] === 'string' && j[k].trim());
  if (d55a && el.nouveau && complete && DATE.test(el.derniereRecherche || '') && LEVELS.includes(el.propose)) {
    return out('estime-editorial-nouveau', el.propose, { origine: 'editoriale', note: 'niveau choisi par l’équipe éditoriale (D-55-a), sans repère externe' });
  }
  return out('non-disponible', null);
}

/** Libellé affiché à l'apprenant (le statut est porté par le texte, jamais par la couleur seule). */
export function label({ statut, niveau, divergences = [] }) {
  if (statut === 'estime-un-repere' && divergences.length > 1) return `Niveau estimé ${niveau}, références non concordantes`;
  return { 'verifie': `Niveau ${niveau}, deux références concordantes`, 'estime-v1': `Niveau estimé ${niveau}`,
    'estime-un-repere': `Niveau estimé ${niveau}, une seule référence`, 'estime-editorial-nouveau': `Niveau estimé ${niveau}, choix éditorial`,
    'non-disponible': 'Niveau non établi', 'hors-niveau': 'Hors échelle JLPT, sans niveau attribué' }[statut];
}
export const FORBIDDEN = /officiel|certifi|garanti|liste JLPT(?! estimée)/i;

/**
 * Surcouche en ajout seul : la dernière entrée datée d'un élément l'emporte ; sans surcouche, V1 à l'identique.
 * Règle 3 : le champ `niveau` du corpus n'est jamais écrit (la surcouche porte `statut` et `niveauAffiche`).
 * Règle 6 : `statut` doit être un statut connu et `niveau` un niveau N5–N1 (ou null) : aucune valeur fusionnée.
 */
export function applyOverlay(v1, overlay) {
  const out = structuredClone(v1);
  for (const e of [...overlay].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!out[e.id]) throw new Error(`élément inconnu : ${e.id}`);
    if (!STATUSES.includes(e.statut)) throw new Error(`statut invalide : ${e.statut}`);
    if (e.niveau !== null && !LEVELS.includes(e.niveau)) throw new Error(`niveau invalide : ${e.niveau}`);
    if (e.statut === HORS_NIVEAU && e.niveau !== null) throw new Error('un élément hors-niveau ne porte aucun niveau');
    out[e.id] = { ...out[e.id], statut: e.statut, niveauAffiche: e.niveau };
  }
  return out;
}

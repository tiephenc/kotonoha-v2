// KOTONOHA 2.0 · état du parcours dérivé du journal (PH-4). Domaine pur.
// Marquer une section ou une leçon « étudiée » = UNE opération `pref` (catégorie DC-4) : sujet `etude.l<n>[.<section>]`,
// valeur booléenne. L'état affiché se déduit de la vue dérivée du journal ; l'interface ne le modifie jamais.

/** Sections que l'apprenant peut marquer, dans la nomenclature des champs V1 (`ordreChamps`). */
export const SECTIONS = Object.freeze({
  intro: 'Introduction', grammar: 'Grammaire', nuance: 'Nuances', prod: 'Production', vocab: 'Vocabulaire', kanji: 'Kanji', reading: 'Lecture', listen: 'Écoute',
});
export const sujetSection = (n, cle) => `etude.l${n}.${cle}`;
export const sujetLecon = (n) => `etude.l${n}`;

const present = {
  intro: (l) => typeof l.champs?.intro === 'string' && l.champs.intro.length > 0,
  grammar: (l) => l.grammaire.length > 0,
  nuance: (l) => typeof l.champs?.nuance === 'string' && l.champs.nuance.length > 0,
  prod: (l) => Array.isArray(l.champs?.prod) && l.champs.prod.length > 0,
  vocab: (l) => l.vocabulaire.length > 0,
  kanji: (l) => l.kanji.length > 0,
  reading: (l) => !!l.lecture,
  listen: (l) => !!l.ecoute,
};

/** Sections suivies d'une leçon, dans l'ordre V1, seulement celles qui ont du contenu. */
export function sectionsDeLecon(l) {
  return l.ordreChamps.filter((c) => SECTIONS[c] && present[c](l)).map((cle) => ({ cle, libelle: SECTIONS[cle] }));
}

const vrai = (prefs, sujet) => prefs?.[sujet]?.v === true;
export const sectionEtudiee = (prefs, n, cle) => vrai(prefs, sujetSection(n, cle));
export const leconMarquee = (prefs, n) => vrai(prefs, sujetLecon(n));

/**
 * État d'une leçon. « terminée » : leçon marquée, ou toutes ses sections marquées. « en cours » : au moins une section.
 * @returns {{etat: 'non-commencee'|'en-cours'|'terminee', faites: number, total: number}}
 */
export function etatLecon(l, prefs) {
  const secs = sectionsDeLecon(l), faites = secs.filter((s) => sectionEtudiee(prefs, l.numero, s.cle)).length;
  const fin = leconMarquee(prefs, l.numero) || (secs.length > 0 && faites === secs.length);
  return { etat: fin ? 'terminee' : faites > 0 ? 'en-cours' : 'non-commencee', faites, total: secs.length };
}
export const LIBELLES_ETAT = Object.freeze({ 'non-commencee': 'non commencée', 'en-cours': 'en cours', terminee: 'terminée' });

/**
 * Leçons d'un niveau regroupées par module. `modules` : lignes [de, a, nom, niveau, …] des tables V1.
 * @param {{lecons: () => any[]}} cat @param {any[][]} modules @param {string} niveau
 */
export function groupesParModule(cat, modules, niveau) {
  const out = new Map();
  for (const l of cat.lecons()) {
    if (l.niveau !== niveau) continue;
    if (!out.has(l.module)) out.set(l.module, { module: l.module, nom: modules[l.module]?.[2] ?? `Module ${l.module + 1}`, lecons: [] });
    out.get(l.module).lecons.push(l);
  }
  return [...out.values()].sort((a, b) => a.module - b.module);
}

/** Leçon à reprendre : la première non terminée, dans l'ordre du parcours. */
export function prochaineLecon(lecons, prefs) {
  return lecons.find((l) => etatLecon(l, prefs).etat !== 'terminee') ?? null;
}

// KOTONOHA 2.0 · surcouche de corrections de contenu (registre docs/developpement/REGISTRE-CORRECTIONS-CONTENUS.md).
// Ajout seul : le corpus V1 et son extraction (v2/donnees/catalogue-v1/) ne sont jamais réécrits. Une correction ne
// s'applique que si elle porte une autorisation explicite et si le texte actuel est, à l'octet près, celui qu'elle
// attend (« avant ») ; sinon l'application échoue, sans rien corriger en partie. L'élément corrigé devient « adapté »,
// garde son localisateur et son fondement, et perd ses résultats de contrôle : son nouveau texte est à recontrôler.

const ID = /^C-\d{4}$/;

/**
 * Vérifie et indexe une surcouche { corrections: [...] }.
 * @param {{ corrections: { id: string, loc: string, chemin: (string|number)[], avant: string, apres: string,
 *   autorisation: { date: string, citation: string } }[] }} surcouche
 * @returns {Map<string, any[]>} loc → corrections, dans l'ordre du fichier
 */
export function tableCorrections(surcouche) {
  const parLoc = new Map(); const ids = new Set();
  for (const c of surcouche?.corrections ?? []) {
    if (!ID.test(c?.id ?? '')) throw new Error(`correction : identifiant invalide « ${c?.id} »`);
    if (ids.has(c.id)) throw new Error(`correction ${c.id} : en double`);
    if (typeof c.loc !== 'string' || !c.loc.startsWith('v1:')) throw new Error(`correction ${c.id} : localisateur invalide`);
    if (!Array.isArray(c.chemin) || !c.chemin.length || !c.chemin.every((k) => typeof k === 'string' || Number.isInteger(k))) throw new Error(`correction ${c.id} : chemin invalide`);
    if (['loc', 'fondement', 'origine', 'droits'].includes(c.chemin[0])) throw new Error(`correction ${c.id} : champ de provenance non corrigeable`);
    if (typeof c.avant !== 'string' || typeof c.apres !== 'string' || c.avant === c.apres) throw new Error(`correction ${c.id} : avant et après requis et différents`);
    if (!c.autorisation?.date || !c.autorisation?.citation?.trim()) throw new Error(`correction ${c.id} : autorisation explicite absente`);
    ids.add(c.id);
    if (!parLoc.has(c.loc)) parLoc.set(c.loc, []);
    parLoc.get(c.loc).push(Object.freeze({ ...c, chemin: Object.freeze([...c.chemin]) }));
  }
  return parLoc;
}

/**
 * Applique à un élément du catalogue les corrections qui le visent. Rend l'élément inchangé (même objet) s'il n'en a
 * aucune ; sinon une copie corrigée, marquée « adapté », avec la liste des corrections appliquées.
 * @param {any} el élément (gelé ou non) tel que rendu par `elementsDeLecon` @param {Map<string, any[]>} table
 */
export function corrigerElement(el, table) {
  const liste = table.get(el.loc);
  if (!liste) return el;
  const copie = structuredClone(el);
  for (const c of liste) {
    let parent = copie;
    for (const k of c.chemin.slice(0, -1)) {
      parent = parent?.[k];
      if (parent === null || typeof parent !== 'object') throw new Error(`correction ${c.id} : chemin introuvable dans ${el.loc}`);
    }
    const fin = c.chemin[c.chemin.length - 1];
    if (parent[fin] !== c.avant) throw new Error(`correction ${c.id} : le texte actuel de ${el.loc} n'est pas celui attendu ; rien n'est corrigé`);
    parent[fin] = c.apres;
  }
  copie.origine = 'adapté';
  copie.corrections = liste.map((c) => c.id);
  return deepFreeze(copie);
}

/** Localisateurs visés qui n'existent pas dans les éléments fournis : une correction orpheline est une erreur. */
export function correctionsOrphelines(table, locsConnus) {
  return [...table.keys()].filter((loc) => !locsConnus.has(loc));
}

function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(o);
}

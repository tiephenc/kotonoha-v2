// KOTONOHA 2.0 · MOD-20 core/migration-v1-etat — conversion de l'ÉTAT DE RÉVISION d'une carte V1 (SM-2 ou FSRS V1)
// vers le planificateur V2 (PH-5, mode simulation). Domaine pur : aucune horloge, aucun aléa, aucun stockage.
//
// Contrainte de fond : la V2 ne stocke aucun état de facette, elle le DÉRIVE des réponses du journal
// (core/consolidation). Un état V1 (facilité, stabilité, difficulté, échéance) n'est donc pas importable tel quel :
// on produit une courte suite de réponses de preuve faible (prv 2) dont le moteur V2 dérive un état. La fonction
// `projeterEtat` calcule cet état par un repli direct de `core/fsrs` ; le test T-MIG-02 vérifie que le moteur de
// consolidation relit exactement le même état (et non l'état V1, qui n'est pas exprimable).
//
// Formule (PROVISOIRE : RT-5, Q-14) :
//   1. Stabilité cible S* : SM-2 → intervalle `i` (jours) ; FSRS V1 → stabilité `st`, à défaut l'intervalle `iv`.
//      Avec la rétention visée 0,9, l'intervalle FSRS égale la stabilité : c'est la seule équivalence utilisée.
//   2. Échelle fixe de réponses « correct » (note 3) espacées de ECARTS = 1, 2, 4 jours : après k réponses la
//      stabilité V2 vaut ECHELLE[k-1] (3,715 ; 6,751 ; 12,365 ; 22,734 j), calculée par `core/fsrs`.
//   3. Nombre de réponses n = le plus grand k ≤ min(r, NMAX) tel que ECHELLE[k-1] ≤ S* (au moins 1). `r` (réussites
//      consécutives de V1) borne n : on ne produit jamais plus de réponses réussies que V1 n'en a observées.
//      Le résultat ne dépasse donc jamais S* (hors plancher : une première réponse vaut 3,715 j), et jamais 22,7 j.
//   4. La dernière réponse est datée de la dernière révision ESTIMÉE (SM-2 : échéance − intervalle ; FSRS : `lr`, à
//      défaut `la`), ramenée à la date de l'export si elle la dépasse ; les précédentes la précèdent des écarts de l'échelle.
//   5. Hypothèses conservatrices, chacune inscrite dans la trace : date absente ou illisible → une seule réponse
//      datée 0 (échéance immédiate) ; valeur corrigée hors bornes (hors simple type) → une seule réponse ;
//      dernière réponse ratée (SM-2 r = 0, FSRS s = 3) → une réponse échouée (la facette reste à réenseigner, M0) ;
//      carte jamais vue → aucune réponse.
// Limites : la difficulté, la facilité (`e`), les oublis (`l`), les hésitations (`hz`) et le temps (`t`) ne sont pas
// représentés (ils restent dans l'archive brute) ; la difficulté V2 dérive de l'échelle, pas de `df` ; l'échéance V2
// (dernière révision + intervalle) diffère de l'échéance V1 ; une stabilité V1 inférieure à 3,715 j est portée à ce plancher.
import { initial, review, interval, TARGET } from './fsrs.js';
import { utcDay, THRESHOLDS } from './consolidation.js';

const DAY = 864e5;
export const TS_MAX = 4.2e12;
/** Écarts (jours) entre réponses successives de l'échelle, nombre maximal de réponses. PROVISOIRES (RT-5, Q-14). */
export const ECARTS = Object.freeze([1, 2, 4]);
export const NMAX = ECARTS.length + 1;
export const FORMATS = Object.freeze(['v1-a', 'v1-b']);
export const dateValide = (x) => Number.isFinite(x) && x > 0 && x <= TS_MAX;

/** Stabilité V2 après k réponses « correct » espacées selon ECARTS (k = 1 à NMAX). Calculée, jamais saisie. */
export const ECHELLE = Object.freeze((() => {
  let st = initial(3); const out = [st.s];
  for (const g of ECARTS) { const n = review(st, 3, g); st = { s: n.s, d: n.d }; out.push(st.s); }
  return out;
})());

const choisirN = (cible, nmax) => { let n = 1; for (let k = 2; k <= nmax; k++) if (ECHELLE[k - 1] <= cible) n = k; return n; };

/** Construit la suite de réponses, la dernière à `dernier`. @returns {{ok: boolean, t: number, tu: boolean, fmt: string}[]} */
function echelle(n, dernier, tu) {
  return Array.from({ length: n }, (_, j) => {
    let recul = 0; for (let m = j; m < n - 1; m++) recul += ECARTS[m];
    return { ok: true, t: dernier - recul * DAY, tu, fmt: FORMATS[j % FORMATS.length] };
  });
}

function datee(base, ref, hyp) {
  if (!dateValide(base)) { hyp.push('date-absente-ou-illisible'); return null; }
  if (ref !== null && base > ref) { hyp.push('date-future-ramenee-a-l-export'); return ref; }
  return base;
}

/**
 * Plan de conversion d'une carte SM-2 (`{e, i, r, d, l, seen, hz, t}`, index.html l. 9924-9936), valeurs déjà ramenées
 * dans leurs bornes. @param {any} s @param {{ref?: number|null, corriges?: string[]}} [o] `ref` : date de l'export (ms) ;
 * `corriges` : notes de bornes (`champ:trop-grand`, …) de la carte.
 * @returns {{regle: string, reponses: any[], hypotheses: string[], cibleStabilite: number|null}}
 */
export function planSm2(s, { ref = null, corriges = [] } = {}) {
  const hyp = [], vue = !!(s.seen || s.r > 0 || s.i > 0);
  if (!vue) return { regle: 'R-SM2-JAMAIS-VUE', reponses: [], hypotheses: hyp, cibleStabilite: null };
  const horsBornes = corriges.filter((c) => !c.endsWith(':type'));
  if (horsBornes.length) hyp.push(`valeur-hors-bornes-corrigee (${horsBornes.join(', ')}) : une seule reponse`);
  if (!(s.r > 0)) {
    const t = datee(s.d, ref, hyp);
    return { regle: 'R-SM2-ECHEC', reponses: [{ ok: false, t: t ?? 0, tu: true, fmt: FORMATS[0] }], hypotheses: hyp, cibleStabilite: null };
  }
  const dernier = datee(dateValide(s.d) ? s.d - s.i * DAY : null, ref, hyp);
  const cible = s.i;
  if (dernier === null || dernier <= 0) {
    return { regle: 'R-SM2-SANS-DATE', reponses: [{ ok: true, t: 0, tu: true, fmt: FORMATS[0] }], hypotheses: hyp, cibleStabilite: cible };
  }
  const n = horsBornes.length ? 1 : choisirN(cible, Math.min(s.r, NMAX));
  if (n === 1 && cible < ECHELLE[0]) hyp.push('plancher-fsrs-3.715j');
  return { regle: `R-SM2-ECHELLE-${n}`, reponses: echelle(n, dernier, true), hypotheses: hyp, cibleStabilite: cible };
}

/**
 * Plan de conversion d'une carte FSRS V1 (`S.core.c[nid]`, index.html l. 10681-10690) : `s` 0 nouveau, 1 apprentissage,
 * 2 révision, 3 réapprentissage. @param {any} c @param {{ref?: number|null, corriges?: string[]}} [o]
 */
export function planFsrs(c, { ref = null, corriges = [] } = {}) {
  const hyp = [];
  if (![1, 2, 3].includes(c.s)) return { regle: 'R-FSRS-NOUVELLE', reponses: [], hypotheses: hyp, cibleStabilite: null };
  const horsBornes = corriges.filter((x) => !x.endsWith(':type'));
  if (horsBornes.length) hyp.push(`valeur-hors-bornes-corrigee (${horsBornes.join(', ')}) : une seule reponse`);
  const base = dateValide(c.lr) ? c.lr : dateValide(c.la) ? c.la : null;
  const t0 = datee(base, ref, hyp);
  const tu = base === null;
  if (c.s === 3) return { regle: 'R-FSRS-REAPPRENTISSAGE', reponses: [{ ok: false, t: t0 ?? 0, tu, fmt: FORMATS[0] }], hypotheses: hyp, cibleStabilite: null };
  const cible = c.st > 0 ? c.st : c.iv > 0 ? c.iv : 0;
  if (t0 === null) return { regle: 'R-FSRS-SANS-DATE', reponses: [{ ok: true, t: 0, tu: true, fmt: FORMATS[0] }], hypotheses: hyp, cibleStabilite: cible };
  const n = horsBornes.length || c.s !== 2 ? 1 : choisirN(cible, Math.min(c.r, NMAX));
  if (n === 1 && cible < ECHELLE[0]) hyp.push('plancher-fsrs-3.715j');
  return { regle: `R-FSRS-ECHELLE-${n}`, reponses: echelle(n, t0, tu), hypotheses: hyp, cibleStabilite: cible };
}

/**
 * État que le moteur V2 dérive d'une suite de réponses (facette non productive, prv 2, ctx « pratique », sans
 * `item`) : repli direct de `core/fsrs`, indépendant de `consolidate`. Les réponses sont triées par date.
 * Une première réponse échouée laisse la facette hors consolidation (M0, à réenseigner).
 * @param {{ok: boolean, t: number, fmt?: string}[]} reponses @param {{target?: number, productive?: boolean}} [o]
 */
export function projeterEtat(reponses, { target = TARGET.def, productive = false } = {}) {
  const e = { state: 'M0', s: null, d: null, last: null, due: null, reps: 0, lapses: 0 };
  let jours = [], cles = [];
  for (const r of [...reponses].sort((a, b) => a.t - b.t)) {
    const jour = utcDay(r.t);
    if (e.state === 'M0') {
      if (!r.ok) continue;
      const i = initial(3);
      Object.assign(e, { state: 'M2', s: i.s, d: i.d, last: jour, due: jour + interval(i.s, target), reps: 1 });
      jours = [jour]; cles = r.fmt ? [`f:${r.fmt}`] : [];
      continue;
    }
    const n = review({ s: e.s, d: e.d }, r.ok ? 3 : 1, jour - e.last);
    Object.assign(e, { s: n.s, d: n.d, last: jour, due: jour + interval(n.s, target), reps: e.reps + 1 });
    if (!r.ok) { e.lapses++; continue; }
    if (!jours.includes(jour)) jours.push(jour);
    if (r.fmt && !cles.includes(`f:${r.fmt}`)) cles.push(`f:${r.fmt}`);
  }
  if (e.state === 'M2' && Math.max(...jours) - Math.min(...jours) >= 1 && cles.length >= 2 && !productive && e.s >= THRESHOLDS.m3Stability) e.state = 'M3';
  return e;
}

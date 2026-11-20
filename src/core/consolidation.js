// KOTONOHA 2.0 · MOD-04 core/consolidation — moteur unique de consolidation par facettes (02 §11 ;
// D-25, D-45, D-46 ; 01 RM-K01 à RM-K07). Domaine pur, déterministe : l'état de chaque facette est
// DÉRIVÉ des opérations actives du journal (réponses et présentations), jamais stocké à part. Deux
// appareils qui détiennent les mêmes opérations obtiennent les mêmes états et les mêmes échéances.
// Les seuils (1, 7, 21, 60 jours ; temps rapides ; 4 oublis ; 40 % ; 20 s) sont PROVISOIRES (RT-5, Q-14).
import { initial, review, interval, retrievability, TARGET } from './fsrs.js';

/** Facettes documentées (02 §6.1, §7, §11.2). `prod` : facette de rappel ou de production. */
export const FACETS = Object.freeze({
  'V-LEC': { kind: 'mot', prod: false }, 'V-SEN': { kind: 'mot', prod: false }, 'V-ORA': { kind: 'mot', prod: false },
  'V-FOR': { kind: 'mot', prod: true }, 'V-EMP': { kind: 'mot', prod: true },
  'K-REC': { kind: 'kanji', prod: false }, 'K-LCT': { kind: 'kanji', prod: false }, 'K-SEN': { kind: 'kanji', prod: false },
  'K-ECR': { kind: 'kanji', prod: true },
  'G-COMP': { kind: 'grammaire', prod: false }, 'G-PROD': { kind: 'grammaire', prod: true },
  // Facettes v4 (décision du 2026-11-15, CR15) ; anciens codes provisoires Z-PRC, Z-PRE, Z-PHO, Z-KLE, Z-KEC.
  // P- pragmatique, O- ouïe, S- syllabaire (kana) : préfixes libres, aucune collision avec V-, K-, G-.
  // F1 compréhension d'un usage pragmatique (I-2), F2 emploi en situation, F3 discrimination phonétique,
  // F4 lecture et F5 écriture d'un kana. `mode` : continu (défaut), jusqua-M4, retrait-M5.
  'P-COMP': { kind: 'pragmatique', prod: false }, 'P-EMP': { kind: 'pragmatique', prod: true },
  'O-DIS': { kind: 'phonetique', prod: false, mode: 'jusqua-M4' },
  'S-LEC': { kind: 'kana', prod: false, mode: 'retrait-M5' }, 'S-ECR': { kind: 'kana', prod: true, mode: 'retrait-M5' },
});
/** Mode d'ordonnancement d'une facette (02 §11.2, l. 1009-1010 ; §11.6). */
export const modeOf = (facet) => FACETS[facet].mode || 'continu';
/** Une facette en consolidation est ordonnancée, sauf phonétique à M4 et kana à M5 (retrait d'ordonnancement, pas d'état). */
export const scheduled = (r) => IN.has(r.state) && !(r.state === 'M4' && modeOf(r.facet) === 'jusqua-M4') && !(r.state === 'M5' && modeOf(r.facet) === 'retrait-M5');
/** Seuils provisoires (02 §11.5, RT-5). */
export const THRESHOLDS = Object.freeze({ m3Stability: 7, m4Interval: 21, m5Interval: 60, remediationLapses: 4, fastMs: Object.freeze({ mot: 3000, kanji: 3000, grammaire: 6000, pragmatique: 6000, kana: 2000 }) });
/** Ordre des états pour l'état d'un élément (le plus faible de ses facettes requises). */
export const ORDER = Object.freeze(['M0', 'M1', 'M2', 'MF', 'M3', 'M4', 'M5']);
const IN = new Set(['M2', 'M3', 'M4', 'M5', 'MF']); // en consolidation

/** Jour civil UTC d'un instant. L'application fournit le jour local de l'apprenant. @param {number} t */
export const utcDay = (t) => Math.floor(t / 864e5);

/** Sujet de facette : `kf:<élément du catalogue sans kc:>#<FACETTE>`. @param {string} s */
export function parseFacet(s) {
  const m = /^kf:([A-Za-z0-9._~:@-]+)#([A-Z]-[A-Z]{3,4})$/.exec(s);
  return m && FACETS[m[2]] ? { item: `kc:${m[1]}`, facet: m[2] } : null;
}
/** @param {string} item `kc:…` @param {string} facet */
export const facetSubject = (item, facet) => {
  if (!/^kc:/.test(item) || !FACETS[facet]) throw new Error(`facette inconnue : ${item} ${facet}`);
  return `kf:${item.slice(3)}#${facet}`;
};

function blank(subject, f) {
  return { subject, item: f.item, facet: f.facet, state: 'M0', prior: null, fsrs: null, last: null, due: null,
    reps: 0, lapses: 0, fails: 0, days: [], keys: [], recall: false, mob: false, diag: { items: [], fmts: [] },
    lastItem: null, seen: [], reactivate: false, remediate: false, aided: 0, history: [] };
}
const add = (a, v) => { if (v !== undefined && v !== null && !a.includes(v)) a.push(v); };
// Items par ordre d'emploi : le plus récemment employé en dernier.
const touch = (a, v) => { if (v === undefined || v === null) return; const i = a.indexOf(v); if (i >= 0) a.splice(i, 1); a.push(v); };
const HISTORY = 50; // dernières étapes gardées pour expliquer une proposition
const log = (r, e) => { r.history.push(e); if (r.history.length > HISTORY) r.history.shift(); };

/**
 * États de toutes les facettes rencontrées.
 * @param {{sorted: any[], neutralized: string[]}} d résultat de `derive`
 * @param {{dayOf?: (t: number) => number, target?: number}} [o]
 */
export function consolidate(d, { dayOf = utcDay, target = TARGET.def } = {}) {
  interval(1, target); // contrôle des bornes de la rétention visée
  const off = new Set(d.neutralized), facets = {}, anomalies = [], calib = {}, kinds = {};
  for (const o of d.sorted) {
    if ((o.type !== 'answer' && o.type !== 'expose') || off.has(o.op) || !o.subject.startsWith('kf:')) continue;
    const f = parseFacet(o.subject);
    if (!f) { anomalies.push(`facette inconnue : ${o.subject}`); continue; }
    const k = FACETS[f.facet].kind, prev = kinds[f.item]; // I-1 : un élément, un genre (01 RM-E03)
    if (prev && prev !== k) { anomalies.push(`genres mêlés : ${f.item} (${prev}, ${k})`); continue; }
    kinds[f.item] = k;
    const r = facets[o.subject] || (facets[o.subject] = blank(o.subject, f));
    const day = dayOf(o.t);
    if (o.type === 'expose') { if (r.state === 'M0') r.state = 'M1'; continue; }
    step(r, o.payload, day, target, calib, o.op);
  }
  for (const r of Object.values(facets)) r.remediate = r.lapses >= THRESHOLDS.remediationLapses;
  return { facets, anomalies, calibration: calib };
}

/** Applique une réponse à une facette. */
function step(r, p, day, target, calib, op) {
  if (p.prv === 1) return;                                     // PRV-1 : déclaratif, aucune valeur de preuve
  const aid = p.aid || 'aucune';
  if (p.ctx === 'simulation' && !p.ok) { r.reactivate = true; log(r, { op, day, ev: 'signal' }); return; } // RT-3
  if (p.ok && aid === 'decisive') { r.aided++; touch(r.seen, p.item); r.lastItem = p.item ?? r.lastItem; log(r, { op, day, ev: 'aide' }); return; } // RT-1
  const g = !p.ok ? 1 : aid === 'partielle' ? 2 : 3;
  const kind = FACETS[r.facet].kind;
  if (p.item) { touch(r.seen, p.item); r.lastItem = p.item; }

  if (!IN.has(r.state)) {                                      // hors consolidation : M0, M1
    if (!p.ok) { log(r, { op, day, ev: 'echec-avant' }); return; } // réenseigné, pas révisé (02 §11.6)
    r.state = 'M2'; r.fsrs = initial(g); r.last = day; r.due = day + interval(r.fsrs.s, target); r.reps = 1;
    evidence(r, p, day);
    if (p.ctx === 'evaluation') { add(r.diag.items, p.item); add(r.diag.fmts, p.fmt); }
    log(r, { op, day, ev: 'entree', state: r.state });
    return;
  }

  const t = day - r.last;
  const next = review(r.fsrs, g, t);
  const c = calib[kind] || (calib[kind] = { n: 0, predicted: 0, observed: 0 });
  c.n++; c.predicted += next.r; if (p.ok) c.observed++;
  r.fsrs = { s: next.s, d: next.d }; r.last = day; r.due = day + interval(next.s, target); r.reps++;

  if (!p.ok) {
    r.lapses++; r.fails++;
    if (r.state === 'MF' && r.fails >= 2) { r.state = 'M2'; r.prior = null; resetEvidence(r); } // RT-2 : deux échecs consécutifs
    else if (['M3', 'M4', 'M5'].includes(r.state)) { r.prior = r.state; r.state = 'MF'; } // RT-2
    log(r, { op, day, ev: 'echec', state: r.state });
    return;
  }
  r.fails = 0;
  if (p.ctx === 'evaluation' && r.state === 'M2') { add(r.diag.items, p.item); add(r.diag.fmts, p.fmt); }
  evidence(r, p, day);
  if (r.state === 'MF') {                                      // RT-2 (aussi au retour d'un kana retiré) : une réussite espacée rend l'état antérieur, si l'intervalle le justifie
    if (t >= 1) { r.state = r.prior === 'M5' && t >= THRESHOLDS.m5Interval ? 'M5' : r.prior !== 'M3' && t >= THRESHOLDS.m4Interval ? 'M4' : 'M3'; r.prior = null; }
  } else if (r.state === 'M2' && (m3(r) || diagOk(r))) r.state = 'M3'; // §11.5 ou RT-4
  else if (r.state === 'M3' && p.fresh && t >= THRESHOLDS.m4Interval && (p.prv ?? 3) > 2 && (!FACETS[r.facet].prod || (p.prv ?? 0) >= 4) && r.mob) r.state = 'M4';
  else if (r.state === 'M4' && modeOf(r.facet) !== 'jusqua-M4' && t >= THRESHOLDS.m5Interval && Number.isSafeInteger(p.ms) && p.ms < THRESHOLDS.fastMs[kind]) r.state = 'M5';
  log(r, { op, day, ev: 'reussite', state: r.state });
}

/** Preuves accumulées depuis l'entrée en acquisition (M2). */
function evidence(r, p, day) {
  add(r.days, day); add(r.keys, p.fmt ? `f:${p.fmt}` : undefined); add(r.keys, p.item ? `i:${p.item}` : undefined);
  if ((p.prv ?? 0) >= 4) r.recall = true;
  if (p.mob || (p.prv ?? 0) >= 7) r.mob = true;
}
function resetEvidence(r) { r.days = []; r.keys = []; r.recall = false; r.mob = false; }
/** RT-4 : présumé connu au diagnostic, au moins deux items de deux formats différents réussis. */
const diagOk = (r) => r.diag.items.length >= 2 && r.diag.fmts.length >= 2;
/** M3 : deux occasions espacées d'au moins un jour, deux formats ou items, un rappel si productive, stabilité ≥ 7 j. */
const m3 = (r) => Math.max(...r.days) - Math.min(...r.days) >= 1 && r.keys.length >= 2
  && (!FACETS[r.facet].prod || r.recall) && r.fsrs.s >= THRESHOLDS.m3Stability;

/**
 * État d'un élément : le plus faible de ses facettes requises (02 §11.5).
 * @param {Record<string, any>} facets @param {string} item `kc:…` @param {string[]} required
 */
export function elementState(facets, item, required) {
  let worst = 'M5';
  for (const f of required) {
    const s = facets[facetSubject(item, f)]?.state || 'M0';
    if (ORDER.indexOf(s) < ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

/**
 * Révisions du jour sous la part bornée du budget (02 §11.7 ; 01 RM-K03). Une révision reportée
 * n'est pas une dette : elle reste due, ordonnée par probabilité de rappel, sans pénalité.
 * @param {Record<string, any>} facets @param {number} day
 * @param {{budgetSec: number, share?: number, secPerReview?: number, priority?: Set<string>}} o
 */
export function plan(facets, day, { budgetSec, share = 0.4, secPerReview = 20, priority = new Set() }) {
  if (!(budgetSec > 0) || !(share > 0 && share <= 1)) throw new Error('budget invalide');
  const cap = Math.floor((budgetSec * share) / secPerReview);
  const rows = Object.values(facets).filter((r) => scheduled(r) && r.due <= day)
    .map((r) => ({ subject: r.subject, r: retrievability(day - r.last, r.fsrs.s), pri: priority.has(r.item) ? 0 : 1, remediate: r.remediate }))
    .sort((a, b) => a.pri - b.pri || a.r - b.r || (a.subject < b.subject ? -1 : 1));
  const week = Object.values(facets).filter((r) => scheduled(r) && r.due <= day + 6).length;
  return { due: rows.slice(0, cap), deferred: rows.slice(cap), load7: week, introduceNew: week <= cap * 7 };
}

/**
 * Item de la prochaine révision : jamais le même deux fois de suite quand la banque en contient au
 * moins deux (01 F-K01 CA5) ; un item jamais vu d'abord, puis le moins récemment employé. Déterministe.
 * @param {any} rec @param {string[]} bank
 */
export function pickItem(rec, bank) {
  if (!bank.length) return null;
  const pool = bank.length >= 2 ? bank.filter((i) => i !== rec?.lastItem) : bank;
  const unseen = pool.filter((i) => !rec?.seen?.includes(i));
  if (unseen.length) return [...unseen].sort()[0];
  return [...pool].sort((a, b) => rec.seen.indexOf(a) - rec.seen.indexOf(b))[0]; // le moins récemment employé
}

// KOTONOHA 2.0 · core/indicateurs — relevé LOCAL des indicateurs de réussite (00 §8, IND-01 à IND-13 ; 10 §3.6).
// Domaine pur : aucune télémétrie, aucun réseau, aucun stockage, aucune heure lue. L'entrée est la liste des
// opérations d'un journal V2 (déjà lue) et une période déclarée ; la sortie est un objet JSON. Rien n'est envoyé.
//
// Règle de 00 §8.1 : le temps passé, le nombre de cartes ou une série ne sont jamais des indicateurs de progression.
// Ici, seul IND-09 (engagement) mesure une activité, et il est présenté comme tel. Pour chaque indicateur, le relevé
// dit s'il est « calculable », « partiel » ou « non-calculable », avec la raison. Rien n'est estimé en silence.
//
// Hypothèses (marquées [Hyp]) :
//  - jour civil de l'apprenant = jour du fuseau IANA déclaré (« UTC » par défaut) ; la période est en jours
//    civils de ce fuseau, bornes incluses ;
//  - seules les opérations d'origine `v2` mesurent l'apprentissage : un import V1 ou Anki porte des dates
//    reconstituées, jamais une mesure (08 §12) ; elles restent comptées à part ;
//  - une opération à horloge incertaine (`tu`) n'entre dans aucun indicateur fondé sur les dates ;
//  - `session.active` est en millisecondes (comme `start` et `end`) ; le schéma ne le précise pas.
import { validate } from './ops.js';
import { derive } from './derive.js';
import { consolidate, FACETS, parseFacet, ORDER } from './consolidation.js';

export const VERSION_RELEVE = 1;
const DAY = 864e5;
const refus = (code, message, detail) => Object.assign(new Error(message), { code, detail });

/** Les 13 indicateurs de 00 §8.2, dans l'ordre. */
export const LISTE = Object.freeze([
  ['IND-01', 'Éléments de connaissance maîtrisés (M4 ou plus)'], ['IND-02', 'Score aux évaluations sur items inédits'],
  ['IND-03', 'Rétention observée à 30 jours'], ['IND-04', 'Profil de compétences'], ['IND-05', 'Part de preuves en production'],
  ['IND-06', 'Réussite au premier essai sur items inédits'], ['IND-07', 'Jours actifs sur jours planifiés'],
  ['IND-08', 'Autonomie (séances hors plan, textes personnels)'], ['IND-09', 'Engagement (temps actif, retour à 7 et 30 jours)'],
  ['IND-10', 'Expérience utilisateur (tests, satisfaction)'], ['IND-11', 'Respect du plafond de charge'],
  ['IND-12', 'Fiabilité technique (pertes, conflits, erreurs)'], ['IND-13', 'Qualité des contenus'],
].map(([id, libelle]) => Object.freeze({ id, libelle })));

// ───────────────────────────── jours civils ─────────────────────────────

const formats = new Map();
function formatDe(fuseau) {
  let f = formats.get(fuseau);
  if (!f) {
    try { f = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { throw refus('fuseau-invalide', `Fuseau horaire inconnu : ${fuseau}.`); }
    formats.set(fuseau, f);
  }
  return f;
}
/** Jour civil `AAAA-MM-JJ` d'un instant dans un fuseau IANA. @param {number} t @param {string} fuseau */
export function jourDe(t, fuseau = 'UTC') {
  const p = Object.fromEntries(formatDe(fuseau).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const numeroJour = (j) => Math.round(Date.parse(`${j}T00:00:00Z`) / DAY);
const jourDepuis = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const jourValide = (j) => typeof j === 'string' && ISO.test(j) && jourDepuis(numeroJour(j)) === j;
const taux = (ok, n) => (n ? Math.round((ok / n) * 1e4) / 1e4 : null);

// ───────────────────────────── calcul ─────────────────────────────

/**
 * Relevé des indicateurs sur une période déclarée.
 * @param {any[]} ops opérations du journal (toutes, tous types)
 * @param {{debut: string, fin: string, fuseau?: string}} periode jours civils AAAA-MM-JJ, bornes incluses
 * @returns {object} relevé ; lève une erreur de `code` `periode-invalide`, `fuseau-invalide` ou `journal-invalide`
 */
export function calculerIndicateurs(ops, { debut, fin, fuseau = 'UTC' } = {}) {
  if (!jourValide(debut) || !jourValide(fin)) throw refus('periode-invalide', 'La période doit être donnée en jours AAAA-MM-JJ (début et fin).');
  if (debut > fin) throw refus('periode-invalide', 'Le début de la période est postérieur à sa fin.');
  formatDe(fuseau);
  if (!Array.isArray(ops)) throw refus('journal-invalide', 'Le journal doit être une liste d’opérations.');
  const defauts = [], vus = new Set();
  ops.forEach((o, i) => {
    const e = validate(o);
    if (e.length) defauts.push({ rang: i, op: o?.op ?? null, defauts: e });
    else if (vus.has(o.op)) defauts.push({ rang: i, op: o.op, defauts: ['doublon d’identifiant'] });
    else vus.add(o.op);
  });
  if (defauts.length) throw refus('journal-invalide', `Journal refusé : ${defauts.length} opération(s) invalide(s). Aucun indicateur n’est calculé sur des données douteuses.`, defauts.slice(0, 20));

  const jour = new Map();                                                  // op → jour civil (dans le fuseau)
  const dans = (o) => { const j = jour.get(o.op) ?? jourDe(o.t, fuseau); jour.set(o.op, j); return j >= debut && j <= fin; };
  const d = derive(ops), neutres = new Set(d.neutralized);
  const actives = d.sorted.filter((o) => !neutres.has(o.op));
  const mesure = actives.filter((o) => o.origin === 'v2' && !o.tu);        // opérations qui mesurent
  const enPeriode = mesure.filter(dans);
  const reponses = (liste) => liste.filter((o) => o.type === 'answer' && o.subject.startsWith('kf:') && o.payload.prv !== 1);
  const apprentissage = (o) => o.payload.ctx !== 'simulation';

  const stats = {
    total: ops.length, neutralisees: neutres.size,
    importees: actives.filter((o) => o.origin === 'v1-import' || o.origin === 'anki-import').length,
    horloge_incertaine: actives.filter((o) => o.tu).length,
    mesurantes: mesure.length, dans_la_periode: enPeriode.length,
    hors_periode: mesure.length - enPeriode.length,
  };

  const jourN = (j) => numeroJour(j), nJours = jourN(fin) - jourN(debut) + 1;
  const ind = {};
  const nc = (raison) => ({ statut: 'non-calculable', raison });

  // État consolidé à la fin de la période (jours civils du fuseau).
  const jusqua = d.sorted.filter((o) => !neutres.has(o.op) && jourDe(o.t, fuseau) <= fin);
  const dc = { ...d, sorted: jusqua.filter((o) => o.type === 'answer' || o.type === 'expose') };
  const cons = consolidate(dc, { dayOf: (t) => numeroJour(jourDe(t, fuseau)) });
  const maitrisees = Object.values(cons.facets).filter((r) => ORDER.indexOf(r.state) >= ORDER.indexOf('M4'));

  // IND-01
  const parGenre = {}; for (const r of maitrisees) parGenre[FACETS[r.facet].kind] = (parGenre[FACETS[r.facet].kind] ?? 0) + 1;
  ind['IND-01'] = { statut: 'partiel', raison: 'Compté par FACETTE (et non par élément de connaissance) et par genre ; le niveau JLPT n’est pas calculable tant que le catalogue (PH-3) ne relie pas les éléments aux niveaux.', valeur: { facettes_m4_ou_plus: maitrisees.length, facettes_suivies: Object.keys(cons.facets).length, par_genre: Object.fromEntries(Object.entries(parGenre).sort()), a_la_date: fin } };

  // IND-02
  const evals = reponses(enPeriode).filter((o) => o.payload.ctx === 'evaluation' && o.payload.fresh === true);
  const evalGenre = {};
  for (const o of evals) { const k = FACETS[parseFacet(o.subject)?.facet]?.kind ?? 'inconnu'; const g = evalGenre[k] ?? (evalGenre[k] = { n: 0, ok: 0 }); g.n++; if (o.payload.ok) g.ok++; }
  ind['IND-02'] = { statut: 'partiel', raison: 'Réponses d’évaluation sur items inédits (`ctx = evaluation`, `fresh`) ; la compétence est approchée par le genre de facette (mot, kanji, grammaire, …) : lecture, écoute, écrit et oral n’ont pas d’événement propre dans le journal.', valeur: { n: evals.length, reussies: evals.filter((o) => o.payload.ok).length, taux: taux(evals.filter((o) => o.payload.ok).length, evals.length), par_genre: Object.fromEntries(Object.entries(evalGenre).sort().map(([k, g]) => [k, { ...g, taux: taux(g.ok, g.n) }])) } };

  // IND-03 : retention à 30 jours — réponse en période dont la réponse précédente sur la même facette date de 30 jours ou plus.
  const precedente = new Map(), retenues = [];
  for (const o of reponses(mesure).filter(apprentissage)) {
    const p = precedente.get(o.subject);
    if (p !== undefined && o.t - p >= 30 * DAY && dans(o)) retenues.push(o);
    precedente.set(o.subject, o.t);
  }
  const ok30 = retenues.filter((o) => o.payload.ok).length;
  ind['IND-03'] = { statut: 'calculable', raison: 'Réponses de la période dont la réponse précédente sur la même facette date d’au moins 30 jours (journal local, origine v2, hors simulation et hors déclaratif).', valeur: { n: retenues.length, reussies: ok30, taux: taux(ok30, retenues.length) } };

  ind['IND-04'] = nc('Le profil de compétences (grammaire, vocabulaire, kanji, lecture, écoute, écrit, oral, pragmatique, avec confiance) dépend du catalogue et des évaluations de compétence de 02 §12.6, absents de V2 à ce stade.');

  // IND-05
  const prod = maitrisees.filter((r) => r.recall).length;
  ind['IND-05'] = { statut: 'partiel', raison: 'Part des facettes M4 ou plus portant au moins une preuve de niveau PRV-4 ou plus (rappel), selon le moteur de consolidation ; la qualité de la production n’est pas mesurée.', valeur: { facettes_m4_ou_plus: maitrisees.length, avec_preuve_de_rappel: prod, part: taux(prod, maitrisees.length) } };

  // IND-06 : première réponse inédite, différée d'au moins 24 h après la première rencontre de la facette.
  const premiere = new Map(); for (const o of reponses(mesure)) if (!premiere.has(o.subject)) premiere.set(o.subject, o.t);
  const inedits = reponses(enPeriode).filter((o) => o.payload.fresh === true && apprentissage(o) && o.t - premiere.get(o.subject) >= DAY);
  const ok6 = inedits.filter((o) => o.payload.ok).length;
  ind['IND-06'] = { statut: 'partiel', raison: 'Réponses sur items inédits (`fresh`) données au moins 24 h après la première rencontre de la facette ; le lien avec une leçon précise n’existe pas dans le journal (pas d’événement de leçon).', valeur: { n: inedits.length, reussies: ok6, taux: taux(ok6, inedits.length) } };

  // IND-07 : jours actifs sur jours planifiés, 4 semaines glissantes se terminant à la fin de la période.
  const f28 = jourDepuis(jourN(fin) - 27);
  const joursActifs = new Set(), joursPlanifies = new Set();
  const session = (o) => o.type === 'session' && o.payload.active > 0;
  for (const o of mesure) if ((o.type === 'answer' || session(o)) && jourDe(o.t, fuseau) >= f28 && jourDe(o.t, fuseau) <= fin) joursActifs.add(jourDe(o.t, fuseau));
  for (const [sujet, e] of Object.entries(d.acc.plan)) { const j = sujet.slice(0, 10); if (e.v !== false && e.v !== null && e.v !== 0 && j >= f28 && j <= fin) joursPlanifies.add(j); }
  const planifiesActifs = [...joursPlanifies].filter((j) => joursActifs.has(j)).length;
  ind['IND-07'] = { statut: 'partiel', raison: '[Hyp] Un jour est « planifié » s’il porte une entrée de plan dont la valeur n’est ni fausse, ni nulle, ni 0 ; les jours de repos déclarés ne sont pas distinguables (pas de type de jour dans le schéma) ; le planificateur de PH-5 n’écrit pas encore ces entrées.', valeur: { fenetre: [f28, fin], jours_planifies: joursPlanifies.size, jours_planifies_actifs: planifiesActifs, taux: taux(planifiesActifs, joursPlanifies.size), jours_actifs: joursActifs.size } };

  ind['IND-08'] = nc('Une séance ne porte pas son mode de lancement (par l’apprenant ou par le plan) ; la lecture de textes personnels et les productions libres n’ont pas d’événement dédié.');

  // IND-09
  const tousActifs = new Set(); for (const o of enPeriode) if (o.type === 'answer' || session(o)) tousActifs.add(jourDe(o.t, fuseau));
  const actifsTous = new Set(); for (const o of mesure) if (o.type === 'answer' || session(o)) actifsTous.add(jourDe(o.t, fuseau));
  const sess = enPeriode.filter(session), tempsMs = sess.reduce((s, o) => s + o.payload.active, 0);
  const retour = (h) => { const base = [...tousActifs].filter((j) => jourN(j) + h <= jourN(fin)); const revenus = base.filter((j) => { for (let k = 1; k <= h; k++) if (actifsTous.has(jourDepuis(jourN(j) + k))) return true; return false; }); return { jours_evaluables: base.length, suivis_d_un_jour_actif: revenus.length, taux: taux(revenus.length, base.length) }; };
  ind['IND-09'] = { statut: 'partiel', raison: 'Indicateur d’ENGAGEMENT, non de progression (00 §8.1). Temps actif = somme de `session.active` (ms, [Hyp]). Le taux de retour est un équivalent local à un seul apprenant : part des jours actifs suivis d’un jour actif dans les 7 (30) jours ; la définition produit (cohorte) suppose un agrégat que la télémétrie interdit.', valeur: { jours_actifs: tousActifs.size, seances: sess.length, temps_actif_ms: tempsMs, temps_actif_hebdomadaire_ms: Math.round((tempsMs / nJours) * 7), retour_7_jours: retour(7), retour_30_jours: retour(30) } };

  ind['IND-10'] = nc('Mesuré par des tests utilisateurs et des questionnaires hors application : aucun événement correspondant dans le journal.');
  ind['IND-11'] = nc('Le plafond de charge et le planificateur (PH-5) n’écrivent pas encore le plafond ni la charge planifiée dans le journal ; impossible de dire quels jours l’ont dépassé.');
  const restaurations = actives.filter((o) => o.type === 'restore').length, coupures = actives.filter((o) => o.type === 'cut').length;
  ind['IND-12'] = { statut: 'non-calculable', raison: 'Les pertes de données, conflits et erreurs de synchronisation relèvent d’un journal technique que V2 ne tient pas ; un journal d’opérations ne peut pas prouver l’absence de perte. Un fichier invalide est refusé, jamais compté.', valeur: { information: { restaurations: restaurations, coupures: coupures } } };
  ind['IND-13'] = nc('Statut de validation linguistique et signalements : métadonnées du catalogue de contenus (03 §6), absentes de V2 à ce stade.');

  return { version: VERSION_RELEVE, local: true, envoi_reseau: false, periode: { debut, fin, fuseau, jours: nJours }, journal: stats, indicateurs: ind, synthese: synthese(ind) };
}

function synthese(ind) {
  const s = { calculable: [], partiel: [], 'non-calculable': [] };
  for (const { id } of LISTE) s[ind[id].statut].push(id);
  return s;
}

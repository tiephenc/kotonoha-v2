// KOTONOHA 2.0 · MOD-20 core/migration-v1 — conversion d'un export V1 en opérations V2 (08 §12, D-66).
// Domaine pur : aucun accès au DOM, au stockage ni au réseau, et jamais le stockage d'un navigateur : la
// seule entrée est un export V1 (texte ou objet). Rien n'est écrit ici ; l'adaptateur `infra/migration-v1.js`
// écrit, et seulement dans un magasin de test.
//
// Règles (08 §12.2, §12.3 ; D-66) :
//  - Les fonctions de normalisation de la V1 (`migrate`, `mig3`, `mig4`, `normTypes`, index.html l. 9147-9171)
//    sont reproduites ici et ne s'exécutent que sur une COPIE de l'export.
//  - Identifiants d'opération DÉTERMINISTES, calculés sur (famille, identifiant V1 normalisé, type de donnée,
//    contenu normalisé, version de la normalisation) : ni l'appareil, ni la source, ni l'heure n'y entrent.
//    Même entrée, mêmes identifiants (INV-07). L'appareil et la source vivent dans l'alias.
//  - HLC réservé [0, c], antérieur à toute opération V2 ; `c` dérive de l'identifiant, donc du contenu.
//  - Conversion prudente : aucune preuve `fresh`, `mob` ni `prv` ≥ 7 ; plafond M3 vérifié par le moteur de
//    consolidation lui-même (`verifierPlafondM3`).
//  - Rien n'est supprimé : tout élément V1 est « converti », « sans état », « non rattaché » ou « archive
//    seule », et figure dans l'inventaire.
import { SCHEMA, validate } from './ops.js';
import { canonical, hashOf, sha256 } from './canon.js';
import { familyOf, makeAlias, isKc } from './alias.js';
import { derive } from './derive.js';
import { consolidate, ORDER, facetSubject } from './consolidation.js';
import { cmpOps } from './ops.js';
import { planSm2, planFsrs, projeterEtat, dateValide, TS_MAX, ECHELLE, ECARTS, NMAX } from './migration-v1-etat.js';
export { ECHELLE, ECARTS, NMAX };

/** Version de la normalisation : elle entre dans l'identifiant des opérations (08 §19.10, C-7). */
export const NORM = 'norm:v1';
/** Dernière version de l'état V1 connue (`S.v`, index.html l. 9137). Une version supérieure est refusée. */
export const VERSION_V1_MAX = 6;
/** État maximal d'une conversion (D-66). */
export const PLAFOND = 'M3';
export const DEV_IMPORT_LIBELLE = 'kotonoha:v1-import:dev';

/** Facette par défaut d'une carte V1 selon sa famille. PROVISOIRE : à remplacer par le catalogue (PH-3). */
export const FACETTE_PAR_DEFAUT = Object.freeze({ v: 'V-SEN', k: 'K-SEN', g: 'G-COMP', ankid: 'V-SEN', 'kanji-importe': 'K-SEN', jmdict: 'V-SEN' });

/** Champs de premier niveau de l'état V1 `S`, établis par lecture ciblée (voir v2/MIGRATION-V1.md §1). */
const AVEC_SECTION = Object.freeze({
  v: 'meta-v1', updated: 'meta-v1',
  g: 'sans-equivalent-v2', rh: 'sans-equivalent-v2', decks: 'sans-equivalent-v2', prof: 'sans-equivalent-v2', x: 'sans-equivalent-v2',
  kw: 'sans-equivalent-v2', labo: 'sans-equivalent-v2', exh: 'sans-equivalent-v2', reports: 'sans-equivalent-v2',
});
const REGLAGES = Object.freeze(['furi', 'theme', 'hes', 'rate']);

const tok = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(v);
const objet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const octets = (s) => new TextEncoder().encode(s).length;

// ───────────────────────────── lecture ─────────────────────────────

/**
 * Lit un export V1 : le texte du fichier « Exporter ma progression » (`{app, format: 2, exported, state, plus}`,
 * index.html l. 10552) ou, comme l'import V1, l'état nu `S`. Aucune écriture. L'archive brute est le texte
 * reçu, inchangé ; si on fournit un objet, c'est sa sérialisation à la façon de la V1 (`JSON.stringify(o, null, 1)`).
 * @param {string|object} entree
 */
export async function lireExportV1(entree) {
  const brut = typeof entree === 'string' ? entree : JSON.stringify(entree, null, 1);
  const base = { brut, octets: octets(brut), sha256: await sha256(brut) };
  const refus = (code, message) => ({ ok: false, code, message, ...base });
  let o;
  const bom = brut.charCodeAt(0) === 0xFEFF;   // un éditeur de Windows peut avoir ajouté une marque d'ordre des octets : tolérée pour la lecture, l'archive garde le texte exact
  try { o = JSON.parse(bom ? brut.slice(1) : brut); } catch { return refus('illisible', 'Fichier illisible : ce n’est pas du JSON.'); }
  const enveloppe = !!o && o.app === 'kotonoha';
  const state = enveloppe ? o.state : o;
  if (!objet(state) || !objet(state.units) || !objet(state.srs) || typeof state.v !== 'number' || !(state.v >= 1)) return refus('non-reconnu', 'Fichier non reconnu : il manque la progression Kotonoha (units, srs, v).');
  if (state.v > VERSION_V1_MAX) return refus('version-future', `Version V1 ${state.v} plus récente que celle que cet outil connaît (${VERSION_V1_MAX}) : conversion refusée ; le fichier n’est pas modifié et rien n’est écrit.`);
  const avertissements = [];
  if (bom) avertissements.push({ code: 'bom-ignore', detail: 'U+FEFF en tête du fichier' });
  if (enveloppe && o.format !== 2) avertissements.push({ code: 'format-inattendu', detail: String(o.format) });
  let plus = null;
  if (enveloppe && o.plus !== undefined) { if (objet(o.plus)) plus = o.plus; else avertissements.push({ code: 'plus-invalide', detail: typeof o.plus }); }
  if (enveloppe) for (const k of Object.keys(o)) if (!['app', 'format', 'exported', 'state', 'plus'].includes(k)) avertissements.push({ code: 'champ-inconnu', detail: `export.${k}` });
  return { ok: true, ...base, enveloppe: enveloppe ? 'export' : 'etat-nu', format: enveloppe ? (o.format ?? null) : null, exporte: enveloppe && typeof o.exported === 'string' ? o.exported : null, version: state.v, state, plus, avertissements };
}

// ───────────────────────────── normalisation (copie de migrate / mig3 / mig4 / normTypes) ─────────────────────────────

const MIG = { 1: 7, 2: 8, 3: 11, 4: 13, 11: 'n3-cause', 23: 'n2-concession' };
const etapesUnite = {
  1: (k) => (MIG[k] !== undefined ? String(MIG[k]) : k),
  3: (k) => (k === 'n3-cause' ? '63' : k),
  4: (k) => (k === 'n2-concession' ? '137' : k),
};
const etapesCarte = {
  1: (k) => { const m = k.match(/^([vkg])(\d+)-(\d+)$/); return m && MIG[m[2]] !== undefined ? `${m[1]}${MIG[m[2]]}-${m[3]}` : k; },
  3: (k) => k.replace(/^([vkg])n3-cause-/, '$163-'),
  4: (k) => k.replace(/^([vkg])n2-concession-/, '$1137-'),
};
/** Étapes appliquées à une version : v1 → 1, 3, 4 ; v2 → 3, 4 ; v3 → 4 ; v4 à v6 : aucune (index.html l. 9157-9165). */
const ETAPES = { 1: [1, 3, 4], 2: [3, 4], 3: [4] };

/**
 * Renomme les clés d'une table selon la version, sur une copie, dans l'ordre des clés triées (résultat
 * indépendant de l'ordre du JSON). Deux clés qui donneraient le même nom : la première est placée, l'autre est
 * rendue dans `collisions` (la V1, elle, en écraserait une en silence).
 */
function renommer(table, v, etapes) {
  const sortie = Object.create(null), origine = Object.create(null), collisions = [];   // prototype nul : les clés « __proto__ », « toString », « constructor » d’un export sont des clés comme les autres
  for (const k of Object.keys(table).sort()) {
    let n = k; for (const e of ETAPES[v] || []) if (etapes[e]) n = etapes[e](n);
    if (Object.prototype.hasOwnProperty.call(sortie, n)) { collisions.push({ cle: k, vers: n }); continue; }
    sortie[n] = table[k]; if (n !== k) origine[n] = k;
  }
  return { sortie, origine, collisions };
}

const CHAMPS_UNITE = ['done', 'best', 'at', 'sc', 'exam'];
const CHAMPS_SRS = ['e', 'i', 'r', 'd', 'l', 'seen', 'hz', 't'];
const CHAMPS_CORE = ['s', 'due', 'st', 'df', 'iv', 'r', 'l', 'lr', 'ok', 'ko', 'h', 'la', 'fl', 'lg', 'step', 'imp'];
const BORNES_SRS = { e: [1.3, 10], i: [0, 36500], r: [0, 1e5], d: [0, TS_MAX], l: [0, 1e5], hz: [0, 1e5], t: [0, 1e5] };
const BORNES_CORE = { due: [0, TS_MAX], st: [0, 36500], df: [0, 10], iv: [0, 36500], r: [0, 1e5], l: [0, 1e5], lr: [0, TS_MAX], la: [0, TS_MAX], fl: [0, TS_MAX], ok: [0, 1e6], ko: [0, 1e6] };

/** `normNum` de la V1 (non nombre → nombre fini ou 0), puis contrôle des bornes : une valeur hors bornes est ramenée à la borne et signalée. */
function lisserNombres(src, bornes, champsSeen = []) {
  const o = { ...src }, notes = [];
  for (const k of [...Object.keys(bornes), ...champsSeen]) {
    if (o[k] == null) continue;
    if (typeof o[k] !== 'number') { const v = +o[k]; o[k] = Number.isFinite(v) ? v : 0; notes.push(`${k}:type`); }
    if (k in bornes) {
      const [lo, hi] = bornes[k];
      if (!Number.isFinite(o[k])) { o[k] = lo; notes.push(`${k}:non-fini`); }   // hypothèse conservatrice : non fini → borne basse (moins de maîtrise)
      else if (o[k] < lo) { o[k] = lo; notes.push(`${k}:trop-petit`); }
      else if (o[k] > hi) { o[k] = hi; notes.push(`${k}:trop-grand`); }
    }
  }
  return { o, notes };
}

// ───────────────────────────── identifiants déterministes ─────────────────────────────

/** Forme UUIDv7 (RFC 9562) remplie par une empreinte : l'identifiant est déterministe, pas horodaté. @param {string} hex */
export function uuid7De(hex) {
  const h = hex.slice(0, 32).split('');
  h[12] = '7'; h[16] = '89ab'[parseInt(h[16], 16) & 3];
  return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20, 32).join('')}`;
}
/** Appareil auteur des opérations d'import : un seul, réservé, indépendant de l'appareil réel (INV-07). */
export const devImport = async () => `dev:${uuid7De(await sha256(DEV_IMPORT_LIBELLE))}`;

/**
 * Construit une opération d'import déterministe. @param {{famille: string, id: string, type: string, subject: string, payload: object, t: number, tu: boolean, seq: number, dev: string}} a
 */
async function construireOp({ famille, id, type, subject, payload, t, tu, seq, dev }) {
  const contenu = { subject, payload, t, tu };
  const h = await sha256(canonical({ n: NORM, f: famille, id, ty: type, c: contenu, q: seq }));
  // HLC réservé [0, c] : `c` suit l'ORDRE CHRONOLOGIQUE (jour de l'opération, puis rang), pas une empreinte. Le moteur
  // de consolidation rejoue les réponses d'une facette dans l'ordre HLC : l'état dérivé ne dépend alors pas du hasard
  // des identifiants. `c` ne dépend que du contenu de l'opération (même opération, même HLC).
  const o = { op: `op:${uuid7De(h)}`, type, s: SCHEMA, hlc: [0, Math.floor(t / 864e5) * 4096 + (seq % 4096)], t, dev, subject, payload, origin: 'v1-import' };
  if (tu) o.tu = true;
  const e = validate(o);
  if (e.length) throw Object.assign(new Error(`opération d’import invalide (${famille} ${id}) : ${e.join(' ; ')}`), { code: 'op-invalide' });
  return o;
}

// ───────────────────────────── conversion des états ─────────────────────────────

/** Plans de conversion d'état : voir core/migration-v1-etat.js (formule, hypothèses, limites). Ces deux fonctions renvoient les seules réponses. */
export const reponsesSm2 = (s, o) => planSm2(s, o).reponses;
export const reponsesFsrs = (c, o) => planFsrs(c, o).reponses;

/**
 * Règle « par carte complète » appliquée à des états d'une même carte venus de plusieurs appareils (08 §12.4) :
 * l'état retenu est celui d'une source entière, jamais un mélange de champs. Plus récent ; si une seule source a
 * une date, elle ; sans date, ou à moins d'une heure d'écart, le plus prudent (rang le plus bas). Les autres sont gardés.
 * @param {{source: string, derniere: number|null, rang: number}[]} etats
 */
export function choisirEtatCarte(etats, { ecartMs = 36e5 } = {}) {
  if (!etats.length) throw new Error('aucun état à départager');
  const prudent = (l) => [...l].sort((a, b) => a.rang - b.rang || cmp(a.source, b.source))[0];
  const datees = etats.filter((e) => Number.isFinite(e.derniere));
  const signaux = [];
  let retenu;
  if (!datees.length) { retenu = prudent(etats); if (etats.length > 1) signaux.push('dates-absentes'); }
  else {
    const max = Math.max(...datees.map((e) => e.derniere));
    const proches = datees.filter((e) => max - e.derniere < ecartMs);
    retenu = proches.length > 1 ? prudent(proches) : proches[0];
    if (proches.length > 1) signaux.push('dates-trop-proches');
    if (datees.length < etats.length) signaux.push('dates-partielles');
  }
  return { retenu, autres: etats.filter((e) => e !== retenu).sort((a, b) => cmp(a.source, b.source)), signaux };
}

// ───────────────────────────── plafond M3 ─────────────────────────────

/**
 * Garde du plafond M3 (D-66) : aucune opération d'import ne porte `fresh`, `mob` ni `prv` ≥ 7, et le moteur de
 * consolidation, appliqué aux opérations, ne place aucune facette en M4 ni en M5.
 * @param {any[]} ops
 */
export function verifierPlafondM3(ops) {
  const violations = [];
  for (const o of ops) {
    const p = o.payload || {};
    if (o.origin === 'v1-import' && (p.fresh !== undefined || p.mob !== undefined || (p.prv ?? 0) >= 7)) violations.push({ op: o.op, raison: 'preuve-interdite' });
  }
  const c = consolidate(derive(ops));
  const repartition = {};
  for (const r of Object.values(c.facets)) {
    repartition[r.state] = (repartition[r.state] || 0) + 1;
    if (ORDER.indexOf(r.state) > ORDER.indexOf(PLAFOND)) violations.push({ facette: r.subject, raison: `etat-${r.state}` });
  }
  return { ok: violations.length === 0, violations, repartition, anomalies: c.anomalies };
}

// ───────────────────────────── catalogue ─────────────────────────────

/**
 * Table de correspondance fournie par le catalogue (08 §5.3) : elle n'existe pas encore en V2. Sans elle, tout
 * élément à rattacher est « non rattaché » : l'outil n'invente jamais une cible.
 * @param {{unites?: string[], cartes?: Record<string,string>, ankid?: Record<string,string>, kanjiImportes?: Record<string,string>, jmdict?: Record<string,string>}} [c]
 */
export function normaliserCatalogue(c = {}) {
  const table = (t, nom) => {
    const m = new Map();
    for (const [k, v] of Object.entries(t || {})) {
      if (!(isKc(v) || /^anki:[A-Za-z0-9._~:#@-]+$/.test(v))) throw new Error(`catalogue invalide (${nom}) : cible « ${v} » pour « ${k} »`);
      m.set(k, v);
    }
    return m;
  };
  return { unites: new Set((c.unites || []).map(String)), cartes: table(c.cartes, 'cartes'), ankid: table(c.ankid, 'ankid'), kanjiImportes: table(c.kanjiImportes, 'kanjiImportes'), jmdict: table(c.jmdict, 'jmdict') };
}

// ───────────────────────────── conversion ─────────────────────────────

/**
 * Convertit un export V1 lu en opérations, alias et inventaire. Aucune écriture, aucune mutation de l'entrée.
 * @param {Awaited<ReturnType<typeof lireExportV1>>} lu résultat OK de `lireExportV1`
 * @param {{catalogue?: any, appareil: string}} o `appareil` : appareil dont vient l'export (alias seulement)
 */
export async function convertirV1(lu, { catalogue, appareil }) {
  if (!lu.ok) throw Object.assign(new Error(lu.message), { code: lu.code });
  const cat = normaliserCatalogue(catalogue);
  const dev = await devImport();
  const S = structuredClone(lu.state);          // la normalisation n'a lieu que sur la copie
  const v = S.v;
  const avertissements = [...lu.avertissements];
  const inventaire = [], ops = [], aliasListe = [], aliasVus = new Set();
  const ajouter = (type, id, statut, extra = {}) => inventaire.push({ cle: `${type}:${id}`, type, id, statut, ...extra });
  const avert = (code, detail) => avertissements.push({ code, detail });
  // Champs inconnus d'un élément : agrégés par type et par nom (jamais un avertissement par carte).
  const inconnus = new Map();
  const noterInconnus = (type, obj, connus) => { for (const k of Object.keys(obj)) if (!connus.includes(k)) inconnus.set(`${type}.${k}`, (inconnus.get(`${type}.${k}`) || 0) + 1); };

  const U = renommer(S.units, v, etapesUnite), C = renommer(S.srs, v, etapesCarte);
  for (const c of U.collisions) ajouter('unite', c.cle, 'non-rattache', { raison: 'collision-de-renommage', vers: c.vers });
  for (const c of C.collisions) ajouter('carte', c.cle, 'non-rattache', { raison: 'collision-de-renommage', vers: c.vers });

  // ── unités (S.units) : section terminée → réponse de preuve faible (prv 2), jamais « acquise » (08 §12.3)
  for (const n of Object.keys(U.sortie).sort()) {
    const u = U.sortie[n], idOrigine = U.origine[n] ?? null;
    const extra = idOrigine ? { idOrigine } : {};
    if (!objet(u)) { ajouter('unite', n, 'non-rattache', { raison: 'forme-invalide', ...extra }); continue; }
    if (!cat.unites.has(n)) { ajouter('unite', n, 'non-rattache', { raison: 'unite-inexistante', ...extra }); continue; }
    noterInconnus('unite', u, CHAMPS_UNITE);
    const subject = `kc:unite:${n}`;
    const done = objet(u.done) ? Object.keys(u.done).filter((k) => u.done[k]).sort() : [];
    let at = u.at; if (at !== undefined && at !== null && typeof at !== 'number') { const x = +at; at = Number.isFinite(x) ? x : 0; avert('type-corrige', `unite ${n} at`); }
    if (at != null && !dateValide(at) && at !== 0) avert('hors-bornes', `unite ${n} at`);
    let nb = 0;
    for (let q = 0; q < done.length; q++) {
      const sec = done[q];
      if (!tok(sec)) { avert('section-invalide', `unite ${n} : « ${sec} »`); continue; }
      const date = sec === 'test' && dateValide(at);
      ops.push(await construireOp({ famille: 'unite', id: n, type: 'answer', subject, payload: { ok: true, ctx: 'verification', prv: 2, fmt: sec }, t: date ? at : 0, tu: !date, seq: q, dev }));
      nb++;
    }
    ajouter('unite', n, nb ? 'converti' : 'sans-etat', { cible: subject, ops: nb, ...extra });
  }

  // ── cartes (S.srs), états SM-2
  // Date de référence (export, à défaut `updated`) : une dernière révision estimée ne la dépasse pas. Aucune horloge.
  const exporteMs = lu.exporte ? Date.parse(lu.exporte) : NaN;
  const ref = dateValide(exporteMs) ? exporteMs : dateValide(S.updated) ? S.updated : null;
  const candidats = [];
  const traiterCarte = async (id, brut, { type, bornes, plan, champsSeen }) => {
    const idOrigine = (type === 'carte' ? C.origine[id] : null) ?? null;
    const extra = idOrigine ? { idOrigine } : {};
    const fam = familyOf(id);
    if (!fam) { ajouter(type, id, 'non-rattache', { raison: 'famille-inconnue', ...extra }); return; }
    if (!objet(brut)) { ajouter(type, id, 'non-rattache', { raison: 'forme-invalide', famille: fam, ...extra }); return; }
    noterInconnus(type, brut, type === 'carte' ? CHAMPS_SRS : CHAMPS_CORE);
    const { o, notes } = lisserNombres(brut, bornes, champsSeen);
    if (notes.length) avert('valeur-corrigee', `${type} ${id} : ${notes.join(', ')}`);
    if (type === 'carte-core' && ![0, 1, 2, 3].includes(o.s)) { ajouter(type, id, 'non-rattache', { raison: 'etat-invalide', famille: fam, ...extra }); return; }
    // cible : table du catalogue, ou clé déterministe d'un mot personnel (DC-6)
    let cible = null, regle, facette = null;
    if (fam === 'mes-mots') { cible = `ku:mot:${(await sha256(`mot:${id.slice(2).normalize('NFC')}`)).slice(0, 32)}`; regle = 'R-MOT-PERSO'; }
    else {
      const table = { 'carte-unite': cat.cartes, ankid: cat.ankid, 'kanji-importe': cat.kanjiImportes, jmdict: cat.jmdict }[fam];
      cible = table.get(id) ?? null; regle = cible ? `R-${fam.toUpperCase()}` : `non-rattache:sans-correspondance`;
      facette = FACETTE_PAR_DEFAUT[fam === 'carte-unite' ? id[0] : fam];
    }
    const cleAlias = `v1:${fam}:${id}@${appareil}`;
    if (!aliasVus.has(cleAlias)) { aliasVus.add(cleAlias); aliasListe.push(makeAlias({ famille: fam, idLu: id, idOrigine, cible, appareil, source: 'v1-export', regle })); }
    if (!cible) { ajouter(type, id, 'non-rattache', { raison: 'sans-correspondance', famille: fam, ...extra }); return; }
    const pl = plan(o, { ref, corriges: notes });
    const subject = cible.startsWith('kc:') ? facetSubject(cible, facette) : cible;
    const projete = pl.reponses.length ? projeterEtat(pl.reponses) : null;
    const derniere = pl.reponses.length ? Math.max(...pl.reponses.map((r) => r.t)) : 0;
    candidats.push({ id, type, fam, cible, subject, extra, pl, projete, source: type === 'carte' ? 'sm2' : 'fsrs-v1', etatSource: Object.fromEntries(Object.keys(o).filter((k) => (type === 'carte' ? CHAMPS_SRS : CHAMPS_CORE).includes(k)).sort().map((k) => [k, o[k]])), derniere: derniere > 0 ? derniere : null, rang: projete?.s ?? 0 });
  };
  for (const id of Object.keys(C.sortie).sort()) await traiterCarte(id, C.sortie[id], { type: 'carte', bornes: BORNES_SRS, plan: planSm2, champsSeen: ['seen'] });

  // ── vocabulaire FSRS du Core (S.core.c) : clé = nid Anki ; alias `@<nid>` (le préfixe est ajouté par la migration)
  if (S.core !== undefined && !objet(S.core)) { ajouter('section', 'core', 'archive-seule', { raison: 'forme-invalide' }); }
  else if (S.core) {
    if (S.core.c !== undefined && !objet(S.core.c)) ajouter('section', 'core.c', 'archive-seule', { raison: 'forme-invalide' });
    const cc = objet(S.core.c) ? S.core.c : {};
    for (const nid of Object.keys(cc).sort()) await traiterCarte(`@${nid}`, cc[nid], { type: 'carte-core', bornes: BORNES_CORE, plan: planFsrs, champsSeen: ['s'] });
    for (const k of Object.keys(S.core).sort()) if (k !== 'c') ajouter('section', `core.${k}`, 'archive-seule', { raison: 'sans-equivalent-v2' });
  }

  // ── règle « par carte complète » (08 §12.4) : une carte de V2 = une seule source. Même cible atteinte par plusieurs
  //    états V1 (même carte dans `srs` et `core.c`, ou deux identifiants que le catalogue rattache à la même cible) :
  //    le plus récent, sinon le plus prudent ; les autres restent inventoriés et dans l'archive brute, non convertis.
  const groupes = new Map();
  for (const c of candidats) { const g = groupes.get(c.cible) || groupes.set(c.cible, []).get(c.cible); g.push(c); }
  const conversions = [];
  for (const cible of [...groupes.keys()].sort()) {
    const g = groupes.get(cible).sort((a, b) => cmp(`${a.type}:${a.id}`, `${b.type}:${b.id}`));
    let retenu = g[0];
    if (g.length > 1) {
      const d = choisirEtatCarte(g.map((c) => ({ source: `${c.type}:${c.id}`, derniere: c.derniere, rang: c.rang })));
      retenu = g.find((c) => `${c.type}:${c.id}` === d.retenu.source);
      avert('doublon-carte', `${cible} : ${g.length} etats V1 (${g.map((c) => `${c.type}:${c.id}`).join(', ')}), retenu ${d.retenu.source}${d.signaux.length ? ` [${d.signaux.join(', ')}]` : ''}`);
      for (const c of g) if (c !== retenu) ajouter(c.type, c.id, 'archive-seule', { raison: 'doublon-ecarte', cible, famille: c.fam, retenu: d.retenu.source, ...c.extra });
    }
    const c = retenu, rep = c.pl.reponses;
    for (let q = 0; q < rep.length; q++) {
      const r = rep[q];
      ops.push(await construireOp({ famille: `${c.type}:${c.fam}`, id: c.id, type: 'answer', subject: c.subject, payload: { ok: r.ok, ctx: 'pratique', prv: 2, fmt: r.fmt }, t: r.t, tu: r.tu, seq: q, dev }));
    }
    ajouter(c.type, c.id, rep.length ? 'converti' : 'sans-etat', { cible, famille: c.fam, ops: rep.length, ...c.extra });
    conversions.push({ id: c.id, type: c.type, source: c.source, cible, sujet: c.subject, regle: c.pl.regle, etatSource: c.etatSource, hypotheses: c.pl.hypotheses, reponses: rep.length, ecartes: g.length - 1, etatProduit: c.projete, relisibleParMoteur: c.subject.startsWith('kf:') });
  }
  conversions.sort((a, b) => cmp(`${a.type}:${a.id}`, `${b.type}:${b.id}`));

  // ── « Mes mots » (S.mots) : le texte reste dans l'archive (objets déterministes à définir) ; l'état est celui de `m:<mot>` ci-dessus
  if (S.mots !== undefined) {
    if (!objet(S.mots)) ajouter('section', 'mots', 'archive-seule', { raison: 'forme-invalide' });
    else for (const k of Object.keys(S.mots).sort()) ajouter('mot', k, 'archive-seule', { raison: 'texte-libre-objets-a-definir' });
  }

  // ── carnet d'erreurs (S.err) : texte libre, sans type d'opération V2 défini
  if (S.err !== undefined) {
    if (!objet(S.err)) ajouter('section', 'err', 'archive-seule', { raison: 'forme-invalide' });
    else for (const k of Object.keys(S.err).sort()) ajouter('erreur', k, 'archive-seule', { raison: 'carnet-sans-type-v2' });
  }

  // ── journal de réponses (S.log, 2 000 au plus) : [horodatage s, unité, compétence, 1|0, début de l'énoncé]
  if (S.log !== undefined) {
    if (!Array.isArray(S.log)) ajouter('section', 'log', 'archive-seule', { raison: 'forme-invalide' });
    else {
      const rangs = new Map();
      for (let i = 0; i < S.log.length; i++) {
        const r = S.log[i], id = String(i);
        if (!Array.isArray(r) || r.length < 4 || !Number.isFinite(+r[0]) || !(+r[0] > 0) || +r[0] * 1000 > TS_MAX || ![0, 1].includes(+r[3]) || !tok(r[2])) { ajouter('journal', id, 'non-rattache', { raison: 'forme-invalide' }); continue; }
        if (!cat.unites.has(String(r[1]))) { ajouter('journal', id, 'non-rattache', { raison: 'unite-inexistante' }); continue; }
        const cle = canonical([+r[0], String(r[1]), r[2], +r[3]]), rang = rangs.get(cle) || 0; rangs.set(cle, rang + 1);
        ops.push(await construireOp({ famille: 'journal', id: cle, type: 'answer', subject: `kc:unite:${r[1]}`, payload: { ok: +r[3] === 1, ctx: 'pratique', fmt: r[2] }, t: Math.round(+r[0] * 1000), tu: false, seq: rang, dev }));
        ajouter('journal', id, 'converti', { cible: `kc:unite:${r[1]}`, ops: 1 });
      }
    }
  }

  // ── réglages : `pref` sous un espace de noms propre à la migration
  const tReglage = dateValide(S.updated) ? S.updated : 0;
  for (const k of REGLAGES) {
    if (S[k] === undefined) continue;
    const val = k === 'rate' ? (typeof S.rate === 'number' && S.rate >= 0.5 && S.rate <= 1.5 ? Math.round(S.rate * 100) : undefined) : (k === 'hes' ? (typeof S.hes === 'boolean' ? S.hes : undefined) : (tok(S[k]) ? S[k] : undefined));
    const sujet = `v1.${k === 'rate' ? 'rate-pct' : k}`;
    if (val === undefined) { ajouter('reglage', k, 'non-rattache', { raison: 'valeur-invalide' }); continue; }
    ops.push(await construireOp({ famille: 'reglage', id: k, type: 'pref', subject: sujet, payload: { v: val }, t: tReglage, tu: tReglage === 0, seq: 0, dev }));
    ajouter('reglage', k, 'converti', { cible: sujet, ops: 1 });
  }

  // ── sections sans équivalent V2 et champs inconnus : archive seule, listés
  for (const k of Object.keys(S).sort()) {
    if (['units', 'srs', 'err', 'log', 'mots', 'core', ...REGLAGES].includes(k)) continue;
    if (k in AVEC_SECTION) ajouter('section', k, 'archive-seule', { raison: AVEC_SECTION[k] });
    else { ajouter('section', k, 'archive-seule', { raison: 'champ-inconnu' }); avert('champ-inconnu', `state.${k}`); }
  }
  // textes de `kotonoha.plus.v1` (export.plus) : un élément par entrée
  if (lu.plus) {
    for (const k of Object.keys(lu.plus).sort()) {
      const v2 = lu.plus[k];
      if (Array.isArray(v2)) v2.forEach((_, i) => ajouter('texte', `${k}[${i}]`, 'archive-seule', { raison: 'texte-libre-objets-a-definir' }));
      else ajouter('texte', k, 'archive-seule', { raison: 'texte-libre-objets-a-definir' });
    }
  }

  for (const [k, n] of [...inconnus].sort(([a], [b]) => cmp(a, b))) avert('champ-inconnu', `${k} (×${n})`);
  ops.sort(cmpOps);
  const uniques = new Set(ops.map((o) => o.op));
  if (uniques.size !== ops.length) throw Object.assign(new Error('identifiants d’opérations en double dans la conversion'), { code: 'doublon-id' });
  inventaire.sort((a, b) => cmp(a.cle, b.cle));
  aliasListe.sort((a, b) => cmp(a.k, b.k));
  const plafond = verifierPlafondM3(ops);
  if (!plafond.ok) throw Object.assign(new Error(`plafond ${PLAFOND} dépassé : ${canonical(plafond.violations)}`), { code: 'plafond-m3', plafond });
  return { ops, alias: aliasListe, inventaire, avertissements, plafond, normalise: S, dev, conversions };
}

// ───────────────────────────── rapport ─────────────────────────────

const compter = (liste, f) => { const m = {}; for (const x of liste) { const k = f(x); m[k] = (m[k] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort(([a], [b]) => cmp(a, b))); };

/**
 * Rapport de migration (08 §12.2, étape E) : volumes avant et après par type, éléments non rattachés, archive
 * seule, avertissements, empreintes. Déterministe : aucune date, aucun aléa ; la même entrée donne le même
 * rapport, octet pour octet (son empreinte `sha256` couvre tout le reste).
 * @param {any} lu @param {Awaited<ReturnType<typeof convertirV1>>} conv @param {{mode: 'blanc'|'ecriture', appareil: string, ecritures?: object}} o
 */
export async function construireRapport(lu, conv, { mode, appareil, ecritures }) {
  const inv = conv.inventaire;
  const avant = {
    unites: Object.keys(lu.state.units).length, cartes: Object.keys(lu.state.srs).length,
    cartesCore: objet(lu.state.core?.c) ? Object.keys(lu.state.core.c).length : 0,
    mots: objet(lu.state.mots) ? Object.keys(lu.state.mots).length : 0, erreurs: objet(lu.state.err) ? Object.keys(lu.state.err).length : 0,
    journal: Array.isArray(lu.state.log) ? lu.state.log.length : 0,
    textes: lu.plus ? Object.values(lu.plus).reduce((n, x) => n + (Array.isArray(x) ? x.length : 1), 0) : 0,
    champsDePremierNiveau: Object.keys(lu.state).length,
  };
  avant.reglages = REGLAGES.filter((k) => lu.state[k] !== undefined).length;
  const attendu = avant.unites + avant.cartes + avant.cartesCore + avant.mots + avant.erreurs + avant.journal + avant.textes + avant.reglages;
  const rapport = {
    rapport: 'migration-v1', version: 1, mode, norm: NORM, plafond: PLAFOND, appareil,
    archive: { sha256: lu.sha256, octets: lu.octets, enveloppe: lu.enveloppe, versionV1: lu.version, format: lu.format, exporte: lu.exporte },
    volumes: {
      avant,
      apres: {
        operations: conv.ops.length, operationsParType: compter(conv.ops, (o) => o.type),
        alias: conv.alias.length, aliasRattaches: conv.alias.filter((a) => a.cible).length, aliasNonRattaches: conv.alias.filter((a) => !a.cible).length,
        inventaire: inv.length, parStatut: compter(inv, (e) => e.statut), parType: compter(inv, (e) => `${e.type}/${e.statut}`),
      },
      // Chaque élément de l'état V1 (hors sections) a une et une seule ligne d'inventaire : sinon, la perte est signalée.
      controle: { elementsAttendus: attendu, elementsInventories: inv.filter((e) => e.type !== 'section').length },
    },
    nonRattaches: inv.filter((e) => e.statut === 'non-rattache').map((e) => ({ type: e.type, id: e.id, raison: e.raison, ...(e.idOrigine ? { idOrigine: e.idOrigine } : {}) })),
    archiveSeule: compter(inv.filter((e) => e.statut === 'archive-seule'), (e) => `${e.type}/${e.raison}`),
    avertissements: [...conv.avertissements].sort((a, b) => cmp(canonical(a), canonical(b))),
    conversionCartes: conv.conversions,
    conversionParRegle: compter(conv.conversions, (c) => c.regle),
    plafondM3: { ok: conv.plafond.ok, repartition: Object.fromEntries(Object.entries(conv.plafond.repartition).sort(([a], [b]) => cmp(a, b))), anomalies: conv.plafond.anomalies },
    empreintes: { operations: await hashOf(conv.ops), alias: await hashOf(conv.alias), inventaire: await hashOf(inv) },
    ecritures: ecritures ?? { operations: 0, alias: 0, archive: 0, inventaire: 0 },
  };
  return { ...rapport, sha256: await hashOf(rapport) };
}

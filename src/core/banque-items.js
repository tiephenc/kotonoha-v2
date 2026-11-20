// KOTONOHA 2.0 · PH-6 : moteur de banque d'items (format versionné, validateur strict, assemblage d'épreuve, rapport).
// Domaine pur : aucun accès au DOM, au stockage, au réseau ni à l'horloge. Ce module ne contient AUCUN contenu pédagogique.
// Il réutilise : `statut-niveau.js` (niveaux et statuts), `selection-evaluation.js` (règles d'examen et plafond de 10 %),
// `melange.js` (mélange déterministe des options) ; l'ensemble des 1 890 identifiants bloqués (`bloques.js`) est fourni par l'appelant.
//
// Règles posées ici (conception 01 F-L04, 02 « règles de la simulation », 03 « banques d'évaluation » ; roadmap Q-46) :
//  - le statut de certification du niveau est un des cinq statuts de `statut-niveau.js` ; la valeur « validé par un humain »
//    n'existe pas et est refusée ; le statut de relecture de l'item est un champ distinct, qui ne certifie pas le niveau ;
//  - un item ne porte jamais un identifiant bloqué (fail-closed : l'ensemble des bloqués est OBLIGATOIRE) ;
//  - un item déjà exposé à l'apprenant n'est jamais servi comme « inédit » ;
//  - plus de 2 % d'items incertains : la banque est bloquée.
import { LEVELS, STATUSES } from './statut-niveau.js';
import { selectionner } from './selection-evaluation.js';
import { melangerOptions } from './melange.js';

export const FORMAT = 'kotonoha-banque-items';
export const VERSION_FORMAT = 1;
export const SECTIONS = Object.freeze(['文字語彙', '文法', '読解', '聴解']);
export const TYPES = Object.freeze(['qcm']);
export const LICENCES = Object.freeze(['libre', 'sous_licence', 'droits_a_verifier', 'proprietaire_kotonoha']);
export const RELECTURES = Object.freeze(['non-relue', 'en-relecture', 'relue']);
/** Part maximale d'items incertains ; au-delà (strictement), la banque est bloquée. */
export const SEUIL_INCERTAINS = 0.02;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;
const CHAMPS = Object.freeze(['version', 'id', 'niveau', 'statut', 'section', 'type', 'consigne', 'options', 'reponse',
  'provenance', 'licence', 'relecture', 'inedit', 'incertain', 'synthetique', 'audio']);
const txt = (v) => typeof v === 'string' && v.trim() !== '';
const norm = (s) => s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Contrôle d'un item. Rend la liste des écarts `{id, code, message}` ; ne modifie rien.
 * @param {any} it @param {ReadonlySet<string>} bloquesNorm identifiants bloqués, en minuscules
 */
function ecartsItem(it, bloquesNorm) {
  const e = [], id = typeof it?.id === 'string' ? it.id : '(sans identifiant)';
  const bad = (code, message) => e.push({ id, code, message });
  if (it === null || typeof it !== 'object' || Array.isArray(it)) { bad('item-invalide', 'item : objet attendu'); return e; }
  for (const k of Object.keys(it)) if (!CHAMPS.includes(k)) bad('champ-inconnu', `champ inconnu : ${k}`);
  if (it.version !== VERSION_FORMAT) bad('version', `version d'item attendue : ${VERSION_FORMAT}`);
  // Le contrôle des bloqués passe AVANT celui de la forme : certains bloqués (LEGACY-…-1課-…) ne respectent pas la forme.
  if (typeof it.id === 'string' && bloquesNorm.has(it.id.toLowerCase())) bad('id-bloque', 'identifiant parmi les 1 890 bloqués : refusé');
  else if (typeof it.id !== 'string' || !ID.test(it.id)) bad('id', 'identifiant absent ou de forme invalide');
  if (!STATUSES.includes(it.statut)) bad('statut', `statut de niveau inconnu : ${String(it.statut)} (la valeur « validé par un humain » n'existe pas)`);
  if (it.statut === 'non-disponible') { if (it.niveau !== null) bad('niveau', 'statut non-disponible : niveau null attendu'); }
  else if (!LEVELS.includes(it.niveau)) bad('niveau', 'niveau N5 à N1 attendu');
  if (!SECTIONS.includes(it.section)) bad('section', 'section inconnue');
  if (!TYPES.includes(it.type)) bad('type', 'type de question inconnu');
  if (!txt(it.consigne)) bad('consigne', 'consigne absente');
  const opts = it.options;
  if (!Array.isArray(opts) || opts.length < 2 || opts.length > 6 || !opts.every(txt)) bad('options', 'options : 2 à 6 textes non vides');
  else {
    if (new Set(opts.map(norm)).size !== opts.length) bad('options-doublons', 'options non distinctes');
    if (!Number.isInteger(it.reponse) || it.reponse < 0 || it.reponse >= opts.length) bad('cle', 'clé : un seul index entier, dans les options');
  }
  const p = it.provenance;
  if (p === null || typeof p !== 'object' || Array.isArray(p) || !txt(p.source)) bad('provenance', 'provenance obligatoire : { source } non vide');
  if (!LICENCES.includes(it.licence)) bad('licence', 'licence absente ou hors régimes connus');
  if (!RELECTURES.includes(it.relecture)) bad('relecture', 'statut de relecture inconnu');
  if (typeof it.inedit !== 'boolean') bad('inedit', 'drapeau inedit : booléen obligatoire');
  if (typeof it.incertain !== 'boolean') bad('incertain', 'drapeau incertain : booléen obligatoire');
  if (it.synthetique !== undefined && typeof it.synthetique !== 'boolean') bad('synthetique', 'synthetique : booléen');
  if (it.synthetique === true && it.statut === 'verifie') bad('synthetique-verifie', 'un item synthétique ne peut pas avoir un niveau vérifié');
  if (it.section === '聴解' && !txt(it.audio)) bad('audio', 'section 聴解 : référence audio obligatoire');
  if (it.audio !== undefined && !txt(it.audio)) bad('audio', 'audio : texte non vide');
  return e;
}

/**
 * Validateur strict d'une banque. Fail-closed : `bloques` (ensemble des 1 890 identifiants) est obligatoire.
 * @param {any} banque
 * @param {{bloques: ReadonlySet<string>}} o
 * @returns {{ok: boolean, erreurs: {id: string, code: string, message: string}[]}}
 */
export function validerBanque(banque, { bloques } = /** @type {any} */ ({})) {
  if (!(bloques instanceof Set) || bloques.size === 0) throw new Error('validerBanque : ensemble des identifiants bloqués obligatoire et non vide (fail-closed)');
  const erreurs = [], bad = (code, message) => erreurs.push({ id: '(banque)', code, message });
  if (banque === null || typeof banque !== 'object') { bad('banque', 'banque : objet attendu'); return { ok: false, erreurs }; }
  if (banque.format !== FORMAT) bad('format', `format attendu : ${FORMAT}`);
  if (banque.version !== VERSION_FORMAT) bad('version', `version de banque attendue : ${VERSION_FORMAT}`);
  if (!Array.isArray(banque.items)) { bad('items', 'items : tableau attendu'); return { ok: false, erreurs }; }
  const bn = new Set([...bloques].map((b) => String(b).toLowerCase())), vus = new Set();
  for (const it of banque.items) {
    erreurs.push(...ecartsItem(it, bn));
    if (typeof it?.id === 'string') {
      const k = it.id.toLowerCase();
      if (vus.has(k)) erreurs.push({ id: it.id, code: 'id-doublon', message: 'identifiant en double (insensible à la casse)' });
      vus.add(k);
    }
    const nom = it?.id ?? '(sans identifiant)';
    if (banque.synthetique === true && it?.synthetique !== true) erreurs.push({ id: nom, code: 'synthetique-incoherent', message: 'banque synthétique : chaque item doit porter synthetique: true' });
    if (banque.synthetique !== true && it?.synthetique === true) erreurs.push({ id: nom, code: 'synthetique-incoherent', message: 'item synthétique dans une banque non marquée synthétique' });
  }
  return { ok: erreurs.length === 0, erreurs };
}

/** Seuils du khi-deux à p = 0,001, par degrés de liberté (1 à 5 : 2 à 6 options). */
export const SEUIL_KHI2 = Object.freeze({ 1: 10.828, 2: 13.816, 3: 16.266, 4: 18.467, 5: 20.515 });

/**
 * Position de la clé après mélange : comptes par position, khi-deux contre l'uniforme et critère §5.7 (100/n ± 5 points).
 * Groupé par nombre d'options. `evaluable` : effectif attendu >= 5 par position (sinon `uniforme` vaut null).
 * @param {{options: string[], reponse: number}[]} items
 */
export function positionsCle(items) {
  const groupes = new Map();
  for (const it of items) { const n = it.options.length; if (!groupes.has(n)) groupes.set(n, Array(n).fill(0)); groupes.get(n)[it.reponse]++; }
  const out = [];
  for (const [n, comptes] of [...groupes].sort((a, b) => a[0] - b[0])) {
    const total = comptes.reduce((a, b) => a + b, 0), attendu = total / n;
    const khi2 = comptes.reduce((s, c) => s + (c - attendu) ** 2 / attendu, 0);
    const evaluable = attendu >= 5, pct = comptes.map((c) => (100 * c) / total);
    out.push({ options: n, total, comptes, khi2, ddl: n - 1, seuil: SEUIL_KHI2[n - 1], evaluable,
      uniforme: evaluable ? khi2 <= SEUIL_KHI2[n - 1] && pct.every((p) => Math.abs(p - 100 / n) <= 5) : null });
  }
  return out;
}

/**
 * Assemble une épreuve : tirage déterministe par graine, quotas par section, exclusion des items exposés, mélange des options.
 * La banque est validée d'abord (échec = exception). Les règles de statut viennent de `selectionner` (examen : `verifie` seul ;
 * entraînement : plafond unique de 10 % d'estimés). Sont écartés dans tous les cas : `droits_a_verifier`, `incertain`,
 * `inedit: false`, identifiant déjà exposé ; en mode examen, tout item non `relue`.
 * @param {{items: any[]}} banque
 * @param {{quotas: Record<string, number>, graine: string|number, bloques: ReadonlySet<string>, exposes?: Iterable<string>,
 *   mode?: 'examen'|'entrainement', niveau?: string}} o
 */
export function assemblerEpreuve(banque, { quotas, graine, bloques, exposes = [], mode = 'entrainement', niveau } = /** @type {any} */ ({})) {
  const v = validerBanque(banque, { bloques });
  if (!v.ok) throw new Error(`banque invalide (${v.erreurs.length} écart(s)) : ${v.erreurs[0].id} · ${v.erreurs[0].message}`);
  if (graine === undefined || graine === null || graine === '') throw new Error('graine obligatoire');
  if (quotas === null || typeof quotas !== 'object') throw new Error('quotas obligatoires');
  for (const [s, n] of Object.entries(quotas)) {
    if (!SECTIONS.includes(s)) throw new Error(`section inconnue dans les quotas : ${s}`);
    if (!Number.isInteger(n) || n < 0) throw new Error(`quota invalide pour ${s} : ${n}`);
  }
  if (niveau !== undefined && !LEVELS.includes(niveau)) throw new Error(`niveau invalide : ${niveau}`);
  const exp = new Set([...exposes].map((x) => String(x).toLowerCase()));
  const exclusions = [], admissibles = [];
  for (const it of banque.items) {
    let r = null;
    if (niveau !== undefined && it.niveau !== niveau) r = 'autre-niveau';
    else if (it.licence === 'droits_a_verifier') r = 'droits-a-verifier';
    else if (it.incertain) r = 'incertain';
    else if (!it.inedit || exp.has(it.id.toLowerCase())) r = 'expose';
    else if (mode === 'examen' && it.relecture !== 'relue') r = 'non-relue';
    if (r) exclusions.push({ id: it.id, raison: r }); else admissibles.push(it);
  }
  const items = [], parSection = {};
  for (const s of SECTIONS) {
    if (quotas[s] === undefined) continue;
    const res = selectionner(admissibles.filter((it) => it.section === s), { mode, n: quotas[s], graine: `${graine}|${s}` });
    parSection[s] = { demande: quotas[s], retenus: res.items.length, complet: res.rapport.complet, motif: res.rapport.motif };
    for (const it of res.items) items.push(melangerOptions(it, `${graine}|${s}`));
  }
  const parRaison = {};
  for (const x of exclusions) parRaison[x.raison] = (parRaison[x.raison] || 0) + 1;
  return {
    items,
    aExposer: items.map((it) => it.id).sort(),
    complet: Object.values(parSection).every((x) => x.complet),
    rapport: { mode, graine, niveau: niveau ?? null, parSection, parRaison, positionCle: positionsCle(items) },
  };
}

/**
 * Rapport de banque : comptes par niveau, section, statut de niveau, relecture ; items non relus ; taux d'incertains ;
 * blocage strict au-delà de 2 % (2 sur 100 n'est pas bloquant). Une banque invalide est signalée, jamais corrigée.
 * @param {any} banque @param {{bloques: ReadonlySet<string>}} o
 */
export function rapportBanque(banque, { bloques } = /** @type {any} */ ({})) {
  const validation = validerBanque(banque, { bloques });
  const items = Array.isArray(banque?.items) ? banque.items.filter((i) => i && typeof i === 'object') : [];
  const cmp = (champ) => { const o = {}; for (const it of items) { const k = String(it[champ]); o[k] = (o[k] || 0) + 1; } return o; };
  const total = items.length, incertains = items.filter((i) => i.incertain === true).length;
  const trop = incertains * 100 > total * 2;
  const raisons = [];
  if (!validation.ok) raisons.push(`banque invalide : ${validation.erreurs.length} écart(s)`);
  if (trop) raisons.push(`${incertains} item(s) incertain(s) sur ${total} : au-delà de ${SEUIL_INCERTAINS * 100} %`);
  return {
    total, synthetique: banque?.synthetique === true,
    parNiveau: cmp('niveau'), parSection: cmp('section'), parStatut: cmp('statut'), parRelecture: cmp('relecture'),
    inedits: items.filter((i) => i.inedit === true).length, exposes: items.filter((i) => i.inedit === false).length,
    nonRelus: items.filter((i) => i.relecture !== 'relue').map((i) => i.id).sort(),
    incertains, tauxIncertains: total ? incertains / total : 0, seuilIncertains: SEUIL_INCERTAINS,
    valide: validation.ok, erreurs: validation.erreurs, bloquee: trop || !validation.ok, raisons,
  };
}

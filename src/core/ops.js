// KOTONOHA 2.0 · MOD-02 core/ops — opérations immuables, validation, versions de schéma
// (08 §6.2, §11, §19.1, §19.2 ; D-61, D-68). Domaine pur.
import { isId, newId } from './ids.js';
import { isHlc } from './hlc.js';
import { canonical } from './canon.js';

/** Version de schéma écrite par ce client (08 §11). */
export const SCHEMA = 2;
export const ORIGINS = Object.freeze(['v2', 'v1-import', 'anki-import', 'restauration']);
export const MAX_CUT_OPS = 5000;      // [Hyp] 08 §19.2 : au-delà, coupure découpée en parties
export const MAX_ERASE_OBJS = 1000;   // [Hyp] 08 §19.16 (N)
const MAX_STR = 200;                  // aucun texte libre dans une opération (08 §19.1)
const MAX_BYTES = 4096, MAX_BYTES_LIST = 300_000;

const HEX64 = /^[0-9a-f]{64}$/;
const str = (s, max = MAX_STR) => typeof s === 'string' && s.length > 0 && s.length <= max;
const objRef = (o) => !!o && typeof o === 'object' && isId(o.id, 'ku', 'obj') && HEX64.test(o.h) && Object.keys(o).length === 2;
const opList = (a, max) => Array.isArray(a) && a.length >= 1 && a.length <= max && a.every((x) => isId(x, 'op')) && new Set(a).size === a.length;
const nat = (n) => Number.isSafeInteger(n) && n >= 0;
const keys = (o, allowed) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => allowed.includes(k));
// Valeurs de préférence ou de plan : jeton court, entier ou booléen ; jamais une phrase (08 §19.1).
const scalar = (v) => v === null || typeof v === 'boolean' || Number.isSafeInteger(v) || (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(v));
// Preuves d'une réponse (02 §11.5, §12.1 ; schéma 2) : item présenté, format, niveau de preuve PRV-1 à PRV-7,
// aide reçue, item inédit, mobilisation en contexte. Jetons courts, jamais de texte libre.
const tok = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,31}$/.test(v);
const proof = (p) => (p.item === undefined || ref(p.item)) && (p.fmt === undefined || tok(p.fmt)) && (p.prv === undefined || (Number.isSafeInteger(p.prv) && p.prv >= 1 && p.prv <= 7)) && (p.aid === undefined || ['aucune', 'partielle', 'decisive'].includes(p.aid)) && (p.fresh === undefined || p.fresh === true) && (p.mob === undefined || p.mob === true);
// Sujet d'un événement d'apprentissage : identifiant du catalogue, de facette, de l'apprenant ou d'Anki.
const ref = (s) => typeof s === 'string' && s.length <= MAX_STR && /^(kc|kf|ku|anki):[A-Za-z0-9._~:#@-]+$/.test(s);

/**
 * Types d'opérations de la règle 1. Catégories de 08 §3 ; SYS : opérations qui agissent sur la
 * dérivation (coupures). `answer` est un événement d'apprentissage générique : le modèle FSRS et les
 * facettes relèvent de PH-3 (MOD-04) : depuis le schéma 2, une réponse peut porter ses preuves, et
 * `expose` trace la présentation d'une facette dans une séquence suivie (état M1). Une opération de
 * schéma 1 reste lisible telle quelle : les champs ajoutés sont facultatifs.
 * @type {Record<string, {cat: string, subject: (s: string) => boolean, payload: (p: any) => boolean}>}
 */
export const TYPES = Object.freeze({
  answer: { cat: 'DC-2', subject: ref, payload: (p) => keys(p, ['ok', 'ms', 'ctx', 'obj', 'item', 'fmt', 'prv', 'aid', 'fresh', 'mob']) && typeof p.ok === 'boolean' && (p.ms === undefined || nat(p.ms)) && (p.ctx === undefined || ['pratique', 'verification', 'evaluation', 'simulation'].includes(p.ctx)) && (p.obj === undefined || objRef(p.obj)) && proof(p) },
  expose: { cat: 'DC-2', subject: (s) => ref(s) && s.startsWith('kf:'), payload: (p) => keys(p, ['seq']) && (p.seq === undefined || ref(p.seq)) },
  session: { cat: 'DC-2', subject: (s) => isId(s, 'ku', 'ses'), payload: (p) => keys(p, ['start', 'end', 'active']) && nat(p.start) && nat(p.end) && p.end >= p.start && nat(p.active) },
  pref: { cat: 'DC-4', subject: (s) => /^[a-z][a-z0-9._-]{0,63}$/.test(s), payload: (p) => keys(p, ['v']) && 'v' in p && scalar(p.v) },
  plan: { cat: 'DC-5', subject: (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}\|/.test(s) && ref(s.slice(11)), payload: (p) => keys(p, ['v']) && 'v' in p && scalar(p.v) },
  'doc.rev': { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'doc'), payload: (p) => keys(p, ['obj', 'parent']) && objRef(p.obj) && (p.parent === null || isId(p.parent, 'ku', 'obj')) },
  trash: { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'doc'), payload: (p) => keys(p, []) },
  untrash: { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'doc'), payload: (p) => keys(p, ['trash']) && opList(p.trash, 1000) },
  erase: { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'era'), payload: (p) => keys(p, ['objs']) && Array.isArray(p.objs) && p.objs.length >= 1 && p.objs.length <= MAX_ERASE_OBJS && p.objs.every((x) => isId(x, 'ku', 'obj')) },
  // Annulation locale d'un effacement en préparation (E2 → E0, 08 §19.16) : sujet = l'effacement visé.
  'erase.cancel': { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'era'), payload: (p) => keys(p, []) },
  // Annulation constatée par un appareil AUTRE que l'auteur, après acceptation de `unerase/` par le serveur (E3 → E0, 08 §19.16) :
  // sujet = l'effacement visé, aucun contenu. N'a de portée que sur la vue du journal ; l'état d'un objet se lit aussi sur le serveur.
  'erase.revoke': { cat: 'DC-6', subject: (s) => isId(s, 'ku', 'era'), payload: (p) => keys(p, []) },
  cut: { cat: 'SYS', subject: (s) => isId(s, 'ku', 'cut'), payload: (p) => keys(p, ['kind', 'ops', 'part', 'parts', 'cats', 'since']) && ['restart', 'date', 'undo-restore'].includes(p.kind) && opList(p.ops, MAX_CUT_OPS) && Number.isSafeInteger(p.parts) && p.parts >= 1 && Number.isSafeInteger(p.part) && p.part >= 1 && p.part <= p.parts && (p.kind !== 'date' || (Array.isArray(p.cats) && p.cats.length >= 1 && p.cats.every((c) => ['DC-2', 'DC-4', 'DC-5', 'DC-6'].includes(c)) && nat(p.since))) && (p.kind === 'date' || (p.cats === undefined && p.since === undefined)) },
  uncut: { cat: 'SYS', subject: (s) => isId(s, 'ku', 'cut'), payload: (p) => keys(p, []) },
  restore: { cat: 'DC-10', subject: (s) => isId(s, 'ku', 'bak'), payload: (p) => keys(p, ['mode', 'added', 'from']) && ['union', 'partielle'].includes(p.mode) && nat(p.added) && (p.from === null || str(p.from, 64)) },
});

/** @param {string} type */
export const categoryOf = (type) => TYPES[type]?.cat;

/**
 * Valide une opération. Retourne la liste des défauts (vide si valide).
 * @param {any} o @returns {string[]}
 */
export function validate(o) {
  const e = [];
  if (!o || typeof o !== 'object') return ['pas un objet'];
  const allowed = ['op', 'type', 's', 'hlc', 't', 'tu', 'dev', 'subject', 'payload', 'origin'];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) e.push(`champ inconnu : ${k}`);
  if (!isId(o.op, 'op')) e.push('op : identifiant invalide');
  if (!Number.isSafeInteger(o.s) || o.s < 1) e.push('s : version invalide');
  else if (o.s > SCHEMA) e.push(`schéma plus récent : ${o.s}`);
  if (!isHlc(o.hlc)) e.push('hlc invalide');
  if (!nat(o.t)) e.push('t invalide');
  if (o.tu !== undefined && o.tu !== true) e.push('tu invalide');
  if (!isId(o.dev, 'dev')) e.push('dev invalide');
  if (!ORIGINS.includes(o.origin)) e.push('origine invalide');
  const T = TYPES[o.type];
  if (!T) e.push(`type inconnu : ${o.type}`);
  else {
    if (!T.subject(o.subject)) e.push('sujet invalide');
    try { if (!T.payload(o.payload)) e.push('contenu invalide'); } catch { e.push('contenu invalide'); }
  }
  if (!e.length) {
    const n = canonical(o).length;
    if (n > (o.type === 'cut' || o.type === 'erase' || o.type === 'untrash' ? MAX_BYTES_LIST : MAX_BYTES)) e.push(`taille excessive : ${n}`);
  }
  return e;
}

/**
 * Lecture d'une opération stockée ou reçue, avec conversion des schémas antérieurs par des fonctions
 * pures (08 §11). Le schéma 2 n'ajoute que des champs facultatifs : une opération de schéma 1 est lue
 * sans conversion.
 * @param {any} raw
 */
export function readOp(raw) {
  const e = validate(raw);
  if (e.length) { const err = new Error(`opération refusée : ${e.join(' ; ')}`); err.code = e.some((x) => x.startsWith('schéma plus récent')) ? 'schema-newer' : 'invalid'; throw err; }
  return raw;
}

/**
 * Crée une opération (non persistée).
 * @param {{type: string, subject: string, payload: object, dev: string, hlc: [number, number], t: number, origin?: string, tu?: boolean}} a
 */
export function makeOp({ type, subject, payload, dev, hlc, t, origin = 'v2', tu }) {
  const o = { op: newId('op', undefined, t), type, s: SCHEMA, hlc, t, dev, subject, payload, origin };
  if (tu) o.tu = true;
  return readOp(o);
}

/** Clé d'ordre total : (HLC, appareil, identifiant d'opération) (08 §7.4, INV-08). @param {any} a @param {any} b */
export function cmpOps(a, b) {
  return a.hlc[0] - b.hlc[0] || a.hlc[1] - b.hlc[1] || (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0) || (a.op < b.op ? -1 : a.op > b.op ? 1 : 0);
}

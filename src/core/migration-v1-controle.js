// KOTONOHA 2.0 · MOD-20 core/migration-v1-controle — contrôle de compatibilité PRÉALABLE et bilan d'intégrité
// AVANT/APRÈS de la migration V1 → V2 (PH-5, 07 §17.11, 08 §12). Domaine pur : aucun accès au stockage, au réseau,
// à l'horloge ni à l'aléa. Rien n'est écrit ici ; ces fonctions ne font que LIRE un export V1 et un résultat de conversion.
//
// 1. `controleCompatibilite(entree)` : verdict avant toute conversion. Trois niveaux : `compatible`, `reserves`
//    (migration possible, avec des constats à lire) et `refus` (rien n'est converti, rien n'est écrit).
// 2. `bilanIntegrite(lu, conv, o)` : comparaison de ce que contient l'export (avant) et de ce que produit la conversion
//    (après) : comptes, empreinte de l'archive, identifiants V1, GUID/nid Anki, identifiants bloqués.
//
// Seuils PROVISOIRES (décision technique de PH-5, documentée dans v2/RAPPORT-MIGRATION-A-BLANC.md §5) : 64 Mio et profondeur 64.
// Le plus gros jeu synthétique éprouvé pèse 11,5 Mio ; une sauvegarde V1 réelle est de l'ordre de quelques centaines de Kio.
import { lireExportV1, VERSION_V1_MAX } from './migration-v1.js';
import { verifierCollisions } from './bloques.js';

export const SEUILS = Object.freeze({ octetsMax: 64 * 1024 * 1024, profondeurMax: 64 });
/** Clés d'objet qui piègent les tables ordinaires (hérités d'Object.prototype). */
const CLES_SPECIALES = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
const objet = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const SECTIONS_OBJET = ['units', 'srs', 'err', 'mots', 'decks', 'g', 'rh', 'x', 'prof'];

/** Profondeur maximale et chaînes/clés d'un arbre JSON, par pile explicite (aucune récursion : un export hostile ne fait pas déborder la pile). */
function parcourir(racine, { profondeurMax, collecter = null }) {
  let max = 0;
  const pile = [[racine, 1]];
  while (pile.length) {
    const [v, d] = pile.pop();
    if (d > max) max = d;
    if (d > profondeurMax) return { profondeur: d, depasse: true };
    if (typeof v === 'string') { collecter?.(v); continue; }
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) for (const x of v) pile.push([x, d + 1]);
      else for (const k of Object.keys(v)) { collecter?.(k); pile.push([v[k], d + 1]); }
    }
  }
  return { profondeur: max, depasse: false };
}

/**
 * Identifiants V1 lus dans un état (même définition que le rapport à blanc) : clés d'unités, de cartes SM-2, de cartes
 * Core (préfixées `@`), de mots ; et, à part, GUID de kanji importés (`g<hex>`) et nid Anki (`@<chiffres>`).
 * @param {any} S état V1
 */
export function identifiantsV1(S) {
  const ids = [];
  for (const k of Object.keys(objet(S?.units) ? S.units : {})) ids.push(`unite:${k}`);
  for (const k of Object.keys(objet(S?.srs) ? S.srs : {})) ids.push(`srs:${k}`);
  for (const k of Object.keys(objet(S?.core?.c) ? S.core.c : {})) ids.push(`core:@${k}`);
  for (const k of Object.keys(objet(S?.mots) ? S.mots : {})) ids.push(`mot:${k}`);
  const cartes = Object.keys(objet(S?.srs) ? S.srs : {}), core = Object.keys(objet(S?.core?.c) ? S.core.c : {});
  const guids = cartes.filter((k) => /^g(?:[0-9a-f]{2})+$/.test(k) && k.length > 3);
  const nid = [...new Set([...cartes.filter((k) => /^@\d+$/.test(k)), ...core.map((k) => `@${k}`).filter((k) => /^@\d+$/.test(k))])];
  return { ids, guids, nid };
}

/** Identifiants bloqués qui apparaissent tels quels (clé ou valeur texte entière) n'importe où dans l'export. */
function bloquesPresents(lu, bloques, profondeurMax) {
  if (!bloques) return [];
  const trouves = new Set();
  const collecter = (s) => { if (bloques.has(s)) trouves.add(s); };
  parcourir(lu.state, { profondeurMax, collecter }); if (lu.plus) parcourir(lu.plus, { profondeurMax, collecter });
  return [...trouves].sort();
}

/**
 * Contrôle de compatibilité préalable. Ne convertit rien et n'écrit rien.
 * @param {string|object} entree export V1 (texte ou objet)
 * @param {{bloques?: ReadonlySet<string>|null, seuils?: Partial<typeof SEUILS>}} [o]
 * @returns {Promise<{ok: boolean, niveau: 'compatible'|'reserves'|'refus', code?: string, message?: string, constats: {code: string, gravite: 'info'|'reserve'|'bloquant', detail?: any}[], stats: any, lu: any}>}
 */
export async function controleCompatibilite(entree, { bloques = null, seuils = {} } = {}) {
  const S_ = { ...SEUILS, ...seuils };
  const constats = [];
  const refus = (lu, code, message, stats = {}) => ({ ok: false, niveau: 'refus', code, message, constats: [...constats, { code, gravite: 'bloquant', detail: message }], stats: { octets: lu?.octets ?? null, sha256: lu?.sha256 ?? null, ...stats }, lu });
  // Taille d'abord, sur le texte : on ne lit pas un fichier démesuré.
  const brut = typeof entree === 'string' ? entree : null;
  if (brut !== null && brut.length > S_.octetsMax) return refus(null, 'trop-gros', `Fichier trop volumineux pour cet outil (plus de ${S_.octetsMax} caractères) : conversion refusée, rien n’est écrit.`, { octets: brut.length });
  const lu = await lireExportV1(entree);
  if (!lu.ok) return refus(lu, lu.code, lu.message);
  if (lu.octets > S_.octetsMax) return refus(lu, 'trop-gros', `Fichier trop volumineux pour cet outil (${lu.octets} octets, plafond ${S_.octetsMax}) : conversion refusée, rien n’est écrit.`);
  const p = parcourir(lu.state, { profondeurMax: S_.profondeurMax });
  const pp = lu.plus ? parcourir(lu.plus, { profondeurMax: S_.profondeurMax }) : { profondeur: 0, depasse: false };
  if (p.depasse || pp.depasse) return refus(lu, 'trop-profond', `Structure trop imbriquée (plus de ${S_.profondeurMax} niveaux) : fichier probablement corrompu ou hostile, conversion refusée, rien n’est écrit.`);

  const S = lu.state, reserve = (code, detail) => constats.push({ code, gravite: 'reserve', detail }), info = (code, detail) => constats.push({ code, gravite: 'info', detail });
  for (const a of lu.avertissements) reserve(a.code, a.detail);
  if (lu.version < VERSION_V1_MAX) reserve('version-ancienne', `V1 version ${lu.version} : les renommages de migrate, mig3 et mig4 sont rejoués sur une copie`);
  if (lu.enveloppe === 'etat-nu') info('etat-nu', 'état sans enveloppe d’export');
  // Formes inattendues : tolérées (l'élément est inventorié « non rattaché » ou « archive seule »), jamais perdues.
  for (const s of SECTIONS_OBJET) if (S[s] !== undefined && !objet(S[s])) reserve('section-forme-invalide', s);
  if (S.core !== undefined && !objet(S.core)) reserve('section-forme-invalide', 'core');
  else if (objet(S.core) && S.core.c !== undefined && !objet(S.core.c)) reserve('section-forme-invalide', 'core.c');
  if (S.log !== undefined && !Array.isArray(S.log)) reserve('section-forme-invalide', 'log');
  const invalides = (t) => (objet(t) ? Object.values(t).filter((v) => !objet(v)).length : 0);
  const nInvalides = { units: invalides(S.units), srs: invalides(S.srs), 'core.c': invalides(S.core?.c), mots: invalides(S.mots) };
  for (const [s, n] of Object.entries(nInvalides)) if (n) reserve('elements-forme-invalide', `${s} : ${n}`);
  const absentes = ['core', 'g', 'mots', 'err', 'log'].filter((s) => S[s] === undefined);
  if (absentes.length) info('sauvegarde-partielle', `sections absentes : ${absentes.join(', ')}`);
  const cles = [...Object.keys(objet(S.units) ? S.units : {}), ...Object.keys(objet(S.srs) ? S.srs : {}), ...Object.keys(objet(S.core?.c) ? S.core.c : {}), ...Object.keys(objet(S.mots) ? S.mots : {})];
  const speciales = cles.filter((k) => CLES_SPECIALES.has(k)), vides = cles.filter((k) => k === '').length;
  if (speciales.length) reserve('cle-speciale', [...new Set(speciales)].sort().join(', '));
  if (vides) reserve('cle-vide', String(vides));
  const bl = bloquesPresents(lu, bloques, S_.profondeurMax);
  if (bl.length) info('identifiants-bloques-presents', bl);

  const { ids, guids, nid } = identifiantsV1(S);
  const stats = {
    octets: lu.octets, sha256: lu.sha256, version: lu.version, enveloppe: lu.enveloppe, profondeur: Math.max(p.profondeur, pp.profondeur),
    unites: Object.keys(objet(S.units) ? S.units : {}).length, cartes: Object.keys(objet(S.srs) ? S.srs : {}).length,
    cartesCore: Object.keys(objet(S.core?.c) ? S.core.c : {}).length, mots: Object.keys(objet(S.mots) ? S.mots : {}).length,
    erreurs: objet(S.err) ? Object.keys(S.err).length : 0, journal: Array.isArray(S.log) ? S.log.length : 0,
    identifiants: ids.length, nidAnki: nid.length, guidKanji: guids.length, bloquesPresents: bl,
  };
  const niveau = constats.some((c) => c.gravite === 'reserve') ? 'reserves' : 'compatible';
  return { ok: true, niveau, constats, stats, lu };
}

/**
 * Bilan d'intégrité avant/après : l'« avant » est ce que contient l'export, l'« après » ce que produit la conversion
 * (inventaire, alias, opérations, archive). Chaque contrôle est `{ok, detail?}`.
 * @param {any} lu export lu OK @param {any} conv résultat de `convertirV1` @param {{bloques?: ReadonlySet<string>|null, rapport?: any}} [o]
 */
export function bilanIntegrite(lu, conv, { bloques = null, rapport = null } = {}) {
  const c = {}, verif = (cle, ok, detail) => { c[cle] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) }; };
  const S = lu.state, { ids, guids, nid } = identifiantsV1(S);
  // Identifiants V1 : chacun doit figurer dans l'inventaire (identifiant ou identifiant d'origine) ou dans un alias.
  const connus = new Set();
  for (const e of conv.inventaire) { connus.add(e.id); if (e.idOrigine) connus.add(e.idOrigine); }
  for (const a of conv.alias) { connus.add(a.idLu); if (a.idOrigine) connus.add(a.idOrigine); }
  const perdus = ids.filter((x) => !connus.has(x.slice(x.indexOf(':') + 1)));
  verif('aucun-identifiant-v1-perdu', perdus.length === 0, perdus.length ? perdus.slice(0, 5) : `${ids.length} lus`);
  // nid et GUID Anki : présents, à l'identique, dans l'inventaire ou les alias.
  const idLus = connus;   // alias ou inventaire : un élément de forme invalide n'a pas d'alias mais reste inventorié
  const nidPerdus = nid.filter((k) => !idLus.has(k)), guidPerdus = guids.filter((k) => !idLus.has(k));
  verif('aucun-nid-anki-perdu', nidPerdus.length === 0, nidPerdus.length ? nidPerdus.slice(0, 5) : `${nid.length} lus`);
  verif('aucun-guid-kanji-perdu', guidPerdus.length === 0, guidPerdus.length ? guidPerdus.slice(0, 5) : `${guids.length} lus`);
  const nidSet = new Set(nid), guidSet = new Set(guids);   // ensembles : la très grosse base a 50 000 alias
  verif('aucun-identifiant-anki-invente', conv.alias.filter((x) => x.famille === 'ankid').every((x) => nidSet.has(x.idLu)) && conv.alias.filter((x) => x.famille === 'kanji-importe').every((x) => guidSet.has(x.idLu)));
  // Comptes : chaque élément V1 a une et une seule ligne d'inventaire.
  const inv = conv.inventaire, cles = inv.map((e) => e.cle), uniques = new Set(cles);
  verif('inventaire-sans-doublon', uniques.size === cles.length);
  if (rapport) verif('comptes-avant-egaux-inventaire', rapport.volumes.controle.elementsAttendus === rapport.volumes.controle.elementsInventories, `${rapport.volumes.controle.elementsAttendus} / ${rapport.volumes.controle.elementsInventories}`);
  // Identifiants bloqués : jamais promus. Aucun sujet d'opération, cible d'alias ou d'inventaire ne les porte.
  if (bloques) {
    const produits = [...conv.ops.map((o) => o.subject), ...conv.alias.map((a) => a.cible).filter(Boolean), ...inv.map((e) => e.cible).filter(Boolean)];
    const collisions = verifierCollisions(produits, bloques);
    verif('aucun-identifiant-bloque-produit', collisions.length === 0, collisions.length ? collisions : `${produits.length} identifiants produits vérifiés`);
    verif('manifeste-bloques-intact', bloques.size === 1890, `${bloques.size}`);
  }
  verif('empreinte-archive', /^[0-9a-f]{64}$/.test(lu.sha256) && (!rapport || rapport.archive.sha256 === lu.sha256), lu.sha256);
  return { ok: Object.values(c).every((x) => x.ok), controles: c, avant: { identifiants: ids.length, nidAnki: nid.length, guidKanji: guids.length }, apres: { alias: conv.alias.length, inventaire: inv.length, operations: conv.ops.length } };
}

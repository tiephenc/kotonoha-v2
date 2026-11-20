// KOTONOHA 2.0 · MOD-15 infra/backup — sauvegarde, vérification, restauration par union, chaîne
// automatique (08 §10, §19.1, §19.10 C-16 ; 07 §17.6 ; SV-03). Format documenté dans FORMAT-SAUVEGARDE.md.
import { canonical, hashOf } from '../core/canon.js';
import { readOp, validate, categoryOf, SCHEMA } from '../core/ops.js';
import { derive, prepare, viewHash, RULES } from '../core/derive.js';
import { newId } from '../core/ids.js';
import { objectValid } from '../core/objects.js';

export const BACKUP_FORMAT = 'kotonoha2-sauvegarde';
/** Version 2 : partie « corpus » (fiches Anki importées) présente. Une sauvegarde sans corpus reste écrite en version 1, à l'identique. */
export const BACKUP_VERSION = 2;
/** Taille maximale d'un fichier de sauvegarde accepté en lecture, en octets décimaux [Hyp] : contrôlée AVANT toute lecture du fichier. */
export const BACKUP_MAX_BYTES = 100_000_000;

const sortObjs = (objs) => [...objs].sort((a, b) => (a.id < b.id ? -1 : 1));

/** Résumé chiffré du corpus Anki (DC-7) d'une sauvegarde. @param {any} c */
const corpusParts = async (c) => ({ versions: c.versions.length, lignees: c.lignees.length, notes: c.notes.length, cartes: c.cartes.length, revisions: c.revisions.length, journal: c.journal.length, meta: c.meta.length, sha256: await hashOf(c) });
const CORPUS_CLES = ['versions', 'lignees', 'notes', 'cartes', 'revisions', 'journal', 'meta'];

/**
 * Construit une sauvegarde complète. Le corpus Anki (DC-7), s'il est fourni, forme la partie « corpus » (version 2 du format) ;
 * sinon cette partie est `null` (version 1, inchangée). L'archive V1 (DC-11) n'existe pas en V2 : sa partie est `null`.
 * @param {{account: string|null, dev: string, ops: any[], objs: any[], aliases?: any[], t: number, kind?: string, corpus?: any}} a
 */
export async function buildBackup({ account, dev, ops, objs, aliases = [], t, kind = 'complete', corpus = null }) {
  const sorted = prepare(ops).sorted, o2 = sortObjs(objs), al = [...aliases].sort((a, b) => (a.k < b.k ? -1 : 1));
  const d = derive(sorted);
  const c = corpus && CORPUS_CLES.some((k) => corpus[k]?.length) ? Object.fromEntries(CORPUS_CLES.map((k) => [k, corpus[k] || []])) : null;
  const header = { format: BACKUP_FORMAT, version: c ? 2 : 1, createdAt: t, account, dev, schema: SCHEMA, rules: RULES, catalog: null, kind };
  const parts = {
    ops: { count: sorted.length, sha256: await hashOf(sorted) },
    objs: { count: o2.length, sha256: await hashOf(o2) },
    aliases: { count: al.length, sha256: await hashOf(al) },
    derived: { n: d.view.n, stateHash: await viewHash(d.view) },
    corpus: c ? await corpusParts(c) : null, v1: null,
  };
  const b = { header, parts, sha256: await hashOf({ header, parts }), ops: sorted, objs: o2, aliases: al };
  if (c) b.corpus = c;
  return b;
}

/** Sérialisation du fichier (JSON lisible sans KOTONOHA). @param {any} b */
export const serialize = (b) => JSON.stringify(b, null, 1);

/**
 * Vérifie une sauvegarde (08 §10.3) : lecture, format, schéma, empreintes de chaque partie et de
 * l'ensemble, validité de chaque opération et de chaque objet, puis dérivation à blanc comparée à
 * l'empreinte enregistrée. Aucune écriture. Une sauvegarde faite sous des règles de dérivation plus
 * anciennes (`header.rules` < RULES) reste valide : son état dérivé n'est pas comparable (il dépend des
 * règles), son intégrité repose sur les empreintes des parties ; la vérification le signale (`notes`).
 * @param {string|any} input @returns {Promise<{ok: boolean, errors: string[], notes?: string[], code?: string, backup?: any}>}
 */
export async function verifyBackup(input) {
  let b;
  if (typeof input === 'string' && input.length > BACKUP_MAX_BYTES) return { ok: false, errors: [`fichier trop volumineux (plus de ${BACKUP_MAX_BYTES / 1e6} Mo)`], code: 'trop-gros' };
  try { b = typeof input === 'string' ? JSON.parse(input) : input; } catch { return { ok: false, errors: ['fichier illisible'], code: 'illisible' }; }
  // Un fichier fabriqué (éléments nuls, imbrication démesurée) ne doit jamais lever d'exception : refus net, rien n'est écrit.
  try { return await verifyParsed(b); } catch { return { ok: false, errors: ['structure invalide'], code: 'format' }; }
}

async function verifyParsed(b) {
  const errors = [];
  const h = b?.header;
  if (!h || h.format !== BACKUP_FORMAT) return { ok: false, errors: ['pas une sauvegarde KOTONOHA 2'], code: 'format' };
  if (!(h.version <= BACKUP_VERSION)) return { ok: false, errors: [`format ${h.version} plus récent que l’application`], code: 'schema-newer' };
  if (!(h.schema <= SCHEMA)) return { ok: false, errors: [`schéma ${h.schema} plus récent que l’application`], code: 'schema-newer' };
  if (!(Number.isInteger(h.rules) && h.rules >= 1)) return { ok: false, errors: ['version des règles absente ou invalide'], code: 'format' };
  if (h.rules > RULES) return { ok: false, errors: [`règles ${h.rules} plus récentes que l’application`], code: 'schema-newer' };
  const notes = [];
  if (!Array.isArray(b.ops) || !Array.isArray(b.objs) || !Array.isArray(b.aliases) || !b.parts) return { ok: false, errors: ['structure incomplète'], code: 'format' };
  if ((await hashOf({ header: h, parts: b.parts })) !== b.sha256) errors.push('empreinte générale incorrecte');
  const sorted = prepare(b.ops).sorted;
  if (canonical(sorted) !== canonical(b.ops)) errors.push('opérations non ordonnées ou dupliquées');
  if (b.parts.ops?.count !== b.ops.length || (await hashOf(b.ops)) !== b.parts.ops?.sha256) errors.push('partie « opérations » altérée');
  if (b.parts.objs?.count !== b.objs.length || (await hashOf(b.objs)) !== b.parts.objs?.sha256) errors.push('partie « objets » altérée');
  if (b.parts.aliases?.count !== b.aliases.length || (await hashOf(b.aliases)) !== b.parts.aliases?.sha256) errors.push('partie « alias » altérée');
  if (b.parts.corpus != null) {
    const c = b.corpus;
    if (!c || typeof c !== 'object' || !CORPUS_CLES.every((k) => Array.isArray(c[k]))) errors.push('partie « fiches Anki » absente ou incomplète');
    else { const p = await corpusParts(c); if (canonical(p) !== canonical(b.parts.corpus)) errors.push('partie « fiches Anki » altérée'); }
  } else if (b.corpus !== undefined) errors.push('fiches Anki non déclarées dans l’en-tête');
  for (const o of b.ops) { const e = validate(o); if (e.length) { errors.push(`opération ${o?.op} : ${e[0]}`); break; } }
  for (const o of b.objs) if (!(await objectValid(o))) { errors.push(`objet ${o?.id} : empreinte incorrecte`); break; }
  if (!errors.length && h.rules === RULES) {
    const d = derive(b.ops);
    if (d.view.n !== b.parts.derived?.n || (await viewHash(d.view)) !== b.parts.derived?.stateHash) errors.push('dérivation à blanc différente');
  } else if (!errors.length) notes.push(`sauvegarde faite sous les règles ${h.rules} : état dérivé recalculé selon les règles ${RULES}, sans comparaison`);
  return errors.length ? { ok: false, errors, code: 'altere' } : { ok: true, errors, notes, backup: b };
}

/**
 * Sauvegarde vérifiée de l'état du journal : construite, sérialisée, relue, vérifiée, puis comparée
 * à l'état courant (nombre d'opérations, empreinte de la vue). Refusée si le magasin contient des
 * opérations illisibles par cette version (schéma plus récent ou invalides) : une sauvegarde dite
 * complète ne doit rien omettre en silence.
 * @param {any} journal @param {number} t @param {string} [kind]
 */
export async function backupJournal(journal, t, kind = 'complete', { excludeObjs = [], corpus = null } = {}) {
  const st = journal.status;
  if (st.invalid?.length || st.updateRequired) { const e = new Error(`sauvegarde refusée : ${st.invalid?.length || 0} opération(s) illisible(s) par cette version ; mettez KOTONOHA à jour`); e.code = 'backup-incomplete'; throw e; }
  const skip = new Set(excludeObjs);
  const b = await buildBackup({ account: journal.account, dev: journal.dev, ops: journal.ops, objs: (await journal.objects()).filter((o) => !skip.has(o.id)), aliases: await journal.aliases(), t, kind, corpus });
  const text = serialize(b);
  const v = await verifyBackup(text);
  const agrees = v.ok && b.parts.derived.stateHash === journal.hash && b.ops.length === journal.ops.length;
  if (!v.ok || !agrees) { const e = new Error(`sauvegarde non conforme : ${v.errors.join(' ; ') || 'état différent'}`); e.code = 'backup-check'; throw e; }
  return { backup: b, text };
}

/**
 * Aperçu chiffré d'une restauration (08 §10.4, étape 1). La sauvegarde est revérifiée ici. Aucune
 * écriture. Une sauvegarde d'un autre compte est refusée : l'ajout « comme données d'un autre compte »
 * (08 §10.5) suppose un espace séparé, qui n'existe pas en PH-1.
 * @param {any} journal @param {string|any} input sauvegarde (texte ou objet)
 * @param {{mode?: 'union'|'partielle', cats?: string[]}} [o]
 */
export async function planRestore(journal, input, { mode = 'union', cats = [] } = {}) {
  const refuse = (code, msg) => ({ ok: false, code, message: msg });
  const v = await verifyBackup(input);
  if (!v.ok) return refuse(v.code, `Sauvegarde refusée : ${v.errors.join(' ; ')}. Rien n’a été modifié.`);
  const b = v.backup;
  if (b.header.account !== journal.account) return refuse('autre-compte', 'Cette sauvegarde vient d’un autre compte : elle n’est pas ajoutée à ce compte.');
  const inScope = (o) => mode === 'union' || cats.includes(categoryOf(o.type));
  const have = new Map(journal.ops.map((o) => [o.op, canonical(o)]));
  const candidates = [], identical = [], conflicts = [];
  for (const o of b.ops.filter(inScope)) { const c = have.get(o.op); if (c === undefined) candidates.push(readOp(o)); else if (c === canonical(o)) identical.push(o.op); else conflicts.push(o.op); }
  // ANO-016 : une annulation d'effacement qui prétend venir de CET appareil sans être dans son journal n'a pas pu être écrite ici
  // (le `dev` d'une sauvegarde n'est qu'une déclaration) : isolée, jamais ajoutée, signalée dans l'aperçu.
  const claims = await journal.screenClaims(candidates), own = await journal.screenOwnErases(claims.kept); // ANO-016 n° 3 : une `erase` au `dev` de cet appareil absente du journal est isolée aussi
  const add = own.kept, isolated = [...claims.rejected, ...own.rejected];
  // Registre d'effacement (08 §19.1, INV-09) : un objet désigné n'est jamais réintroduit.
  const after = derive(journal.ops.concat(add));
  const erased = new Set([...Object.keys(after.view.erase), ...(await journal.store.erasedIds?.() || [])]); // registre des destructions (INV-09)
  const haveObjs = new Map((await journal.objects()).map((o) => [o.id, canonical(o)]));
  // Objets référencés par les opérations de la catégorie, déjà présentes ou ajoutées.
  const refs = new Set(after.sorted.filter(inScope).flatMap((o) => (o.payload?.obj ? [o.payload.obj.id] : [])));
  const objs = [], objsRefused = [], objConflicts = [];
  for (const o of b.objs) {
    if (mode === 'partielle' && !refs.has(o.id)) continue;
    if (haveObjs.has(o.id)) { if (haveObjs.get(o.id) !== canonical(o)) objConflicts.push(o.id); continue; }
    if (erased.has(o.id)) objsRefused.push(o.id); else objs.push(o);
  }
  const neu = new Set(after.neutralized);
  const neutralized = add.filter((o) => neu.has(o.op)).map((o) => o.op);
  const byCat = {};
  for (const o of add) byCat[categoryOf(o.type)] = (byCat[categoryOf(o.type)] || 0) + 1;
  const haveAl = new Map((await journal.aliases()).map((a) => [a.k, canonical(a)]));
  const aliases = mode === 'union' ? b.aliases.filter((a) => !haveAl.has(a.k)) : [];
  const aliasConflicts = b.aliases.filter((a) => haveAl.has(a.k) && haveAl.get(a.k) !== canonical(a)).map((a) => a.k);
  return { ok: true, mode, from: b.sha256, add, isolated, identical: identical.length, conflicts, objs, objsRefused, objConflicts, neutralized, byCat, aliases, aliasConflicts };
}

/**
 * Restauration (08 §10.4, étapes 2 à 4) : copie préalable vérifiée et relue, ajout par union,
 * opération `restore` pour la traçabilité, rapport. Ne retire jamais rien. Annulable par
 * `journal.undoRestore`.
 * @param {any} journal @param {any} plan résultat de planRestore, confirmé par l'apprenant @param {number} t
 */
export async function applyRestore(journal, plan, t) {
  if (!plan.ok) throw new Error(plan.message);
  const pre = await backupJournal(journal, t, 'avant-restauration');
  const preId = newId('ku', 'bak', t);
  await journal.store.putBackup({ id: preId, kind: 'avant-restauration', at: t, text: pre.text });
  const reread = (await journal.store.listBackups()).find((x) => x.id === preId);
  if (!reread || !(await verifyBackup(reread.text)).ok) { const e = new Error('copie préalable illisible : restauration abandonnée, rien n’a été ajouté'); e.code = 'backup-check'; throw e; }
  if (plan.aliases?.length) await journal.addAliases(plan.aliases);
  // Revérifié à l'application (un plan fabriqué ou périmé ne contourne pas l'aperçu) ; trace durable des rejets.
  const c1 = await journal.screenClaims(plan.add), c2 = await journal.screenOwnErases(c1.kept), kept = c2.kept, again = [...c1.rejected, ...c2.rejected];
  const rejected = [...new Map([...(plan.isolated || []), ...again].map((o) => [o.op, o])).values()]; // isolées à l'aperçu ET à l'application
  if (rejected.length) await journal.noteRejected(rejected);
  const saved = await journal.write(kept, plan.objs);
  if (!saved) return { ok: false, preBackup: preId, message: 'écriture refusée : les données à restaurer restent en attente sur cet appareil' };
  const trace = await journal.record('restore', newId('ku', 'bak', t), { mode: plan.mode, added: kept.length, from: plan.from });
  return { ok: trace.saved, traceSaved: trace.saved, preBackup: preId, added: kept.map((o) => o.op).concat(trace.op.op), isolated: rejected.map((o) => o.op), objs: plan.objs.length, objsRefused: plan.objsRefused.length, neutralized: plan.neutralized.length };
}

/** Conservation des copies faites avant une action risquée ([Hyp] 08 §10.1 : 90 jours). */
export const RISKY_KEEP_MS = 90 * 864e5;

/**
 * Crochet « avant une action risquée » (08 §10.1) : sauvegarde complète, vérifiée et enregistrée AVANT
 * une coupure ou un effacement (objets à effacer exclus). S'il échoue, l'action n'a pas lieu. Les
 * copies de plus de 90 jours sont retirées. Le corpus (DC-7) n'existe pas encore en V2.
 * @param {() => any} getJournal @param {() => number} now
 */
export function riskyBackupHook(getJournal, now) {
  return async (kind, o = {}) => {
    const j = getJournal(), t = now();
    const { text } = await backupJournal(j, t, kind, o);
    const id = newId('ku', 'bak', t);
    await j.store.putBackup({ id, kind, at: t, text });
    const reread = (await j.store.listBackups()).find((x) => x.id === id);
    if (!reread || !(await verifyBackup(reread.text)).ok) { const e = new Error('copie de sécurité illisible : action abandonnée'); e.code = 'backup-check'; throw e; }
    const old = (await j.store.listBackups()).filter((b) => b.kind.startsWith('avant-') && b.at < t - RISKY_KEEP_MS).map((b) => b.id);
    if (old.length) await j.store.putBackups([], old);
    return id;
  };
}

// ——— Chaîne de sauvegardes automatiques (08 §10.1, §19.10 C-16) ———

const day = (t) => new Date(t).toISOString().slice(0, 10);
const month = (t) => day(t).slice(0, 7);
const week = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const y = d.getUTCFullYear(), j4 = Date.UTC(y, 0, 4); return `${y}-S${1 + Math.round(((d - j4) / 864e5 - 3 + ((new Date(j4).getUTCDay() + 6) % 7)) / 7)}`; };

/** Maillons automatiques, du plus ancien au plus récent. @param {any[]} all */
export const chainOf = (all) => all.filter((b) => b.kind === 'auto').sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));

/** Empreinte cumulée d'un point : identifiants d'opérations et d'objets (objets purgés compris). */
async function cumOf(opIds, objIds) {
  const o = [...opIds].sort(), b = [...objIds].sort();
  return { count: o.length, sha256: await hashOf(o), objs: b.length, objsSha256: await hashOf(b) };
}

/** Exécute f sous un verrou partagé entre onglets (Web Locks), s'il existe. */
const locked = (f) => (globalThis.navigator?.locks ? navigator.locks.request('kotonoha2-sauvegardes', f) : f());

/**
 * Ajoute un maillon (opérations et objets nouveaux depuis le précédent, empreinte cumulée), applique
 * la rotation, puis vérifie toute la chaîne. Sous verrou : deux onglets ne créent jamais deux maillons
 * concurrents.
 * @param {any} journal @param {number} t @returns {Promise<{link: any, rotation: any, check: {ok: boolean, errors: string[]}}>}
 */
export function autoBackup(journal, t) {
  return locked(async () => {
    const links = chainOf(await journal.store.listBackups());
    const seenOps = new Set(links.flatMap((l) => l.ops.map((o) => o.op)));
    const seenObjs = new Set(links.flatMap((l) => l.objs.map((o) => o.id).concat(l.purgedIds || [])));
    const ops = prepare(journal.ops).sorted.filter((o) => !seenOps.has(o.op));
    const objs = sortObjs((await journal.objects()).filter((o) => !seenObjs.has(o.id)));
    // Sous le verrou, un maillon est toujours postérieur au précédent : un onglet qui a lu l'heure avant
    // un autre, mais obtenu le verrou après lui, ne casse pas l'ordre de la chaîne.
    const last = links[links.length - 1];
    const at = last ? Math.max(t, last.at + 1) : t;
    const link = { id: newId('ku', 'bak', at), kind: 'auto', at, prev: last ? last.id : null, ops, objs, purgedIds: [], cum: await cumOf([...seenOps, ...ops.map((o) => o.op)], [...seenObjs, ...objs.map((o) => o.id)]) };
    await journal.store.putBackup(link);
    const rotation = await rotate(journal.store);
    const check = await verifyChain(chainOf(await journal.store.listBackups()));
    return { link, rotation, check };
  });
}

/**
 * Maillons conservés : le plus récent de chacun des 7 derniers jours, des 4 dernières semaines et des
 * 12 derniers mois ([Hyp] 08 §10.1), et toujours le dernier.
 * @param {any[]} links
 */
export function retained(links) {
  const keep = new Set();
  const latest = (keyFn, n) => { const seen = new Map(); for (const l of [...links].reverse()) { const k = keyFn(l.at); if (!seen.has(k) && seen.size < n) seen.set(k, l.id); } for (const id of seen.values()) keep.add(id); };
  latest(day, 7); latest(week, 4); latest(month, 12);
  if (links.length) keep.add(links[links.length - 1].id);
  return keep;
}

/**
 * Rotation (C-16) : un maillon retiré est fusionné dans son successeur avant d'être supprimé, en une
 * seule transaction ; la chaîne reste restaurable à chaque point conservé.
 * @param {any} store
 */
export async function rotate(store) {
  const links = chainOf(await store.listBackups());
  const keep = retained(links);
  const out = [], del = [];
  let carry = null;
  for (const l of links) {
    if (!keep.has(l.id)) { carry = carry ? { ops: carry.ops.concat(l.ops), objs: carry.objs.concat(l.objs), purgedIds: carry.purgedIds.concat(l.purgedIds || []), prev: carry.prev } : { ops: l.ops, objs: l.objs, purgedIds: l.purgedIds || [], prev: l.prev }; del.push(l.id); continue; }
    if (carry) { out.push({ ...l, prev: carry.prev, ops: prepare(carry.ops.concat(l.ops)).sorted, objs: sortObjs(carry.objs.concat(l.objs)), purgedIds: [...carry.purgedIds, ...(l.purgedIds || [])].sort() }); carry = null; }
  }
  if (del.length) await store.putBackups(out, del);
  return { kept: links.length - del.length, removed: del.length };
}

/** Vérifie chaque point : pointeurs, validité des opérations et des objets, empreintes cumulées. @param {any[]} links */
export async function verifyChain(links) {
  const errors = [], ops = new Set(), objs = new Set();
  for (let i = 0; i < links.length; i++) {
    const l = links[i];
    if (!l || !Array.isArray(l.ops) || !Array.isArray(l.objs) || !l.cum) { errors.push(`maillon ${i} : structure incomplète`); continue; }
    if (l.prev !== (i ? links[i - 1].id : null)) errors.push(`maillon ${i} : précédent incorrect`);
    for (const o of l.ops) { if (validate(o).length) errors.push(`maillon ${i} : opération invalide`); ops.add(o.op); }
    for (const o of l.objs) { if (!(await objectValid(o))) errors.push(`maillon ${i} : objet ${o.id} altéré`); objs.add(o.id); }
    for (const id of l.purgedIds || []) objs.add(id);
    const c = await cumOf(ops, objs);
    if (c.count !== l.cum.count || c.sha256 !== l.cum.sha256 || c.objs !== l.cum.objs || c.objsSha256 !== l.cum.objsSha256) errors.push(`maillon ${i} : point non restaurable`);
  }
  return { ok: !errors.length, errors };
}

/**
 * Point i de la chaîne, sous la forme d'une sauvegarde complète vérifiable et restaurable par union.
 * @param {any[]} links @param {number} i @param {{account: string|null, dev: string}} who
 */
export function chainPoint(links, i, who) {
  const s = links.slice(0, i + 1);
  return buildBackup({ account: who.account, dev: who.dev, ops: s.flatMap((l) => l.ops), objs: s.flatMap((l) => l.objs), t: links[i].at, kind: 'point-de-chaine' });
}

/**
 * Retire des maillons automatiques les objets dont l'effacement est DÉFINITIF (E4, 08 §19.16) et
 * garde leur identifiant dans `purgedIds` : la chaîne reste vérifiable. En PH-1, aucun effacement
 * n'atteint E4 sans serveur : la liste est fournie par l'appelant (PH-2). Les copies
 * « avant-restauration » relèvent de la même purge en PH-2 (non traitée ici).
 * @param {any} store @param {Iterable<string>} objIds
 */
export async function purgeErased(store, objIds) {
  const gone = new Set(objIds), links = chainOf(await store.listBackups()), out = [];
  let n = 0;
  for (const l of links) {
    const objs = l.objs.filter((o) => !gone.has(o.id));
    if (objs.length !== l.objs.length) { const ids = l.objs.filter((o) => gone.has(o.id)).map((o) => o.id); n += ids.length; out.push({ ...l, objs, purgedIds: [...(l.purgedIds || []), ...ids].sort() }); }
  }
  if (out.length) await store.putBackups(out);
  return { purged: n };
}

/**
 * Retire des sauvegardes locales les objets dont l'effacement est DÉFINITIF (E4, 08 §19.16) : maillons
 * automatiques (voir `purgeErased`) ET copies de sécurité (« avant-effacement », « avant-restauration »,
 * « avant-coupure »…), dont l'empreinte est recalculée (C-16). Les opérations ne sont jamais modifiées.
 * Une copie illisible est laissée telle quelle et signalée dans `unreadable`.
 * @param {any} store @param {Iterable<string>} objIds
 */
export async function purgeErasedBackups(store, objIds) {
  const gone = new Set(objIds), { purged } = await purgeErased(store, gone), out = [], unreadable = [];
  let n = purged;
  for (const b of await store.listBackups()) {
    if (b.kind === 'auto' || typeof b.text !== 'string') continue;
    let p;
    try { p = JSON.parse(b.text); } catch { unreadable.push(b.id); continue; }
    const hit = (p.objs || []).filter((o) => gone.has(o.id));
    if (!hit.length) continue;
    const rebuilt = await buildBackup({ account: p.header.account, dev: p.header.dev, ops: p.ops, objs: p.objs.filter((o) => !gone.has(o.id)), aliases: p.aliases || [], t: p.header.createdAt, kind: p.header.kind });
    out.push({ ...b, text: serialize(rebuilt) });
    n += hit.length;
  }
  if (out.length) await store.putBackups(out);
  return { purged: n, unreadable };
}

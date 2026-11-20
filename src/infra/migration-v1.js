// KOTONOHA 2.0 · MOD-20 infra/migration-v1 — adaptateur de la migration V1 → V2 (08 §12, D-66 ; 07 §17.11).
// Deux modes. « blanc » (défaut) : aucune écriture, aucun accès au magasin ; renvoie le rapport. « ecriture » :
// seulement vers un magasin de TEST (mémoire, ou base IndexedDB dont le nom commence par `kotonoha2-test-`) ;
// une base V2 réelle (`kotonoha2-local`, `kotonoha2-u-…`) est refusée. Ce module ne lit jamais le stockage d'un
// navigateur : l'entrée est un export V1 déjà obtenu (texte ou objet).
import { convertirV1, construireRapport, uuid7De, verifierPlafondM3 } from '../core/migration-v1.js';
import { canonical, hashOf, sha256 } from '../core/canon.js';
import { derive } from '../core/derive.js';
import { buildBackup, verifyBackup, serialize } from './backup.js';
import { newId } from '../core/ids.js';
import { controleCompatibilite, bilanIntegrite } from '../core/migration-v1-controle.js';

export const ARCHIVE_PREFIX = 'v1:archive:';
export const INVENTAIRE_PREFIX = 'v1:inventaire:';
/** Appareil des alias en mode à blanc quand aucun n'est fourni (rapport reproductible). */
export const appareilBlanc = async () => `dev:${uuid7De(await sha256('kotonoha:v1-migration:a-blanc'))}`;

/** Un magasin de test : mémoire, ou base IndexedDB `kotonoha2-test-…`. Jamais une base V2 réelle. @param {any} store */
export const estMagasinDeTest = (store) => !!store && typeof store.name === 'string' && (store.name === 'memoire' || /^kotonoha2-test-[A-Za-z0-9._-]+$/.test(store.name));

const erreur = (code, message) => Object.assign(new Error(message), { code });
const parId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * État complet et comparable d'un magasin : journal, objets, alias, file d'envoi, appareil. Sert à prouver qu'un
 * retour arrière est exact. Les archives V1 (meta `v1:…`) n'en font pas partie : elles sont permanentes.
 * @param {any} store
 */
export async function etatDuMagasin(store) {
  const ops = (await store.allOps()).sort((a, b) => parId(a.op, b.op)), objs = (await store.allObjs()).sort((a, b) => parId(a.id, b.id));
  const alias = (await store.allAliases()).sort((a, b) => parId(a.k, b.k)), pending = await store.pendingIds();
  const dev = (await store.getMeta('dev')) ?? null;
  const d = derive(ops);
  return { ops: await hashOf(ops), objs: await hashOf(objs), alias: await hashOf(alias), pending, dev, n: ops.length, nObjs: objs.length, nAlias: alias.length, vue: await hashOf(d.view) };
}

/**
 * Sauvegarde vérifiée AVANT une migration (07 §17.11, 08 RD-12) : copie complète, sérialisée, relue depuis le
 * magasin, revérifiée (empreintes, dérivation à blanc) et comparée à l'état courant. Si une étape échoue, rien
 * n'est migré. Renvoie la poignée qui sert au retour arrière.
 * @param {any} store @param {{t: number, account?: string|null}} o
 */
export async function sauvegardeAvantMigration(store, { t, account = null }) {
  const etat = await etatDuMagasin(store);
  const b = await buildBackup({ account, dev: etat.dev ?? (await appareilBlanc()), ops: await store.allOps(), objs: await store.allObjs(), aliases: await store.allAliases(), t, kind: 'complete' });
  const text = serialize(b);
  const v = await verifyBackup(text);
  if (!v.ok) throw erreur('backup-check', `sauvegarde préalable non conforme : ${v.errors.join(' ; ')}`);
  if (b.ops.length !== etat.n || b.objs.length !== etat.nObjs || b.aliases.length !== etat.nAlias) throw erreur('backup-check', 'sauvegarde préalable différente de l’état courant');
  const id = newId('ku', 'bak', t);
  await store.putBackup({ id, kind: 'avant-migration-v1', at: t, text });
  const relue = (await store.listBackups()).find((x) => x.id === id);
  if (!relue || relue.text !== text || !(await verifyBackup(relue.text)).ok) throw erreur('backup-check', 'sauvegarde préalable illisible après enregistrement : migration abandonnée');
  return { id, text, etat, t };
}

/**
 * Migration V1 → V2.
 * Étapes : garde de cible (écriture) → contrôle de compatibilité préalable (`controle`) → conversion → bilan d'intégrité
 * avant/après (`integrite`) → [écriture : sauvegarde vérifiée, écriture, relecture, empreintes]. Tout refus est un résultat
 * `{ok: false, code, message}` sans écriture ; une erreur après la sauvegarde préalable porte `error.sauvegarde` (retour arrière).
 * `bloques` : ensemble des 1 890 identifiants bloqués (core/bloques) ; s'il est fourni, aucun ne doit être produit.
 * @param {{entree: string|object, catalogue?: any, appareil?: string, mode?: 'blanc'|'ecriture', store?: any, now?: () => number, bloques?: ReadonlySet<string>|null}} a
 * @returns {Promise<{ok: boolean, mode: string, code?: string, message?: string, rapport?: any, ops?: any[], alias?: any[], inventaire?: any[], sauvegarde?: any}>}
 */
export async function migrerV1({ entree, catalogue, appareil, mode = 'blanc', store = null, now = () => Date.now(), bloques = null }) {
  if (mode !== 'blanc' && mode !== 'ecriture') throw erreur('mode-inconnu', `mode inconnu : ${mode}`);
  // Garde d'abord, avant toute lecture : une base réelle n'est jamais touchée, même pour un export illisible.
  if (mode === 'ecriture' && !estMagasinDeTest(store)) throw erreur('base-reelle-refusee', 'écriture refusée : seule une base de test (mémoire ou « kotonoha2-test-… ») est admise');
  const controle = await controleCompatibilite(entree, { bloques });
  if (!controle.ok) return { ok: false, mode, code: controle.code, message: controle.message, controle: { niveau: controle.niveau, constats: controle.constats, stats: controle.stats } };
  const lu = controle.lu;
  const resumeControle = { niveau: controle.niveau, constats: controle.constats, stats: controle.stats };
  const app = appareil ?? (mode === 'ecriture' ? await store.getMeta('dev') : null) ?? (await appareilBlanc());
  let conv;
  try { conv = await convertirV1(lu, { catalogue, appareil: app }); } catch (e) { return { ok: false, mode, code: e.code || (e instanceof RangeError ? 'trop-profond' : 'conversion'), message: e instanceof RangeError ? 'Structure trop imbriquée ou trop grande pour la conversion : rien n’est écrit.' : String(e.message), controle: resumeControle }; }

  if (mode === 'blanc') {
    const rapport = await construireRapport(lu, conv, { mode, appareil: app });
    const integrite = bilanIntegrite(lu, conv, { bloques, rapport });
    return { ok: true, mode, rapport, ops: conv.ops, alias: conv.alias, inventaire: conv.inventaire, controle: resumeControle, integrite };
  }
  // Intégrité de la conversion AVANT toute écriture : un bilan en échec arrête la migration, rien n'est écrit.
  const integriteAvant = bilanIntegrite(lu, conv, { bloques });
  if (!integriteAvant.ok) return { ok: false, mode, code: 'integrite-avant', message: `Contrôle d’intégrité avant écriture en échec : ${Object.entries(integriteAvant.controles).filter(([, c]) => !c.ok).map(([k]) => k).join(', ')}. Rien n’a été écrit.`, controle: resumeControle, integrite: integriteAvant };

  // ── mode écriture, magasin de test : réimport tardif d'abord (08 §19.10, C-7), avant toute écriture
  const cleArchive = `${ARCHIVE_PREFIX}${lu.sha256}`, cleInv = `${INVENTAIRE_PREFIX}${lu.sha256}`;
  const autres = (await store.listMeta(ARCHIVE_PREFIX)).filter((a) => a.sha256 !== lu.sha256);
  if (autres.length) return { ok: false, mode, code: 'reimport-tardif-sans-accord', message: 'Une archive V1 différente est déjà enregistrée : un réimport tardif exige l’accord de l’apprenant (non réalisé). Rien n’a été écrit.' };
  const sauvegarde = await sauvegardeAvantMigration(store, { t: now() });
  try {
  const ecritures = { operations: 0, alias: 0, archive: 0, inventaire: 0 };

  const existante = await store.getMeta(cleArchive);
  if (existante) { if (existante.brut !== lu.brut) throw erreur('archive-alteree', 'l’archive enregistrée diffère de l’export lu : migration arrêtée'); }
  else { await store.setMeta(cleArchive, { sha256: lu.sha256, octets: lu.octets, brut: lu.brut, enregistreeA: now() }); ecritures.archive = 1; }

  const avantAlias = new Set((await store.allAliases()).map((a) => a.k));
  ecritures.operations = (await store.appendOps(conv.ops, [], { queue: true })).length;
  await store.addAliases(conv.alias);
  ecritures.alias = conv.alias.filter((a) => !avantAlias.has(a.k)).length;
  const inv = { archive: lu.sha256, inventaire: conv.inventaire };
  const invExistant = await store.getMeta(cleInv);
  if (!invExistant) { await store.setMeta(cleInv, inv); ecritures.inventaire = 1; }
  else if (canonical(invExistant) !== canonical(inv)) throw erreur('inventaire-altere', 'l’inventaire enregistré diffère de celui de cet export');

  // Relecture : tout ce qui devait être écrit l'est, à l'identique, et le plafond tient sur l'ensemble du journal.
  const relues = new Map((await store.allOps()).map((o) => [o.op, canonical(o)]));
  for (const o of conv.ops) if (relues.get(o.op) !== canonical(o)) throw erreur('relecture', `opération absente ou différente après écriture : ${o.op}`);
  const apresAlias = new Map((await store.allAliases()).map((a) => [a.k, canonical(a)]));
  for (const a of conv.alias) if (apresAlias.get(a.k) !== canonical(a)) throw erreur('relecture', `alias absent ou différent après écriture : ${a.k}`);
  const garde = verifierPlafondM3((await store.allOps()).filter((o) => o.origin === 'v1-import'));   // le plafond ne vaut que pour l’import : une facette V2 peut légitimement être en M4
  if (!garde.ok) throw erreur('plafond-m3', 'plafond M3 dépassé dans le journal après écriture');
  const rapport = await construireRapport(lu, conv, { mode, appareil: app, ecritures });
  // Empreinte des opérations relues = empreinte des opérations converties (rapport) : rien n'a été altéré en route.
  const relu = conv.ops.map((o) => relues.get(o.op));
  if (relu.some((x) => x === undefined) || (await hashOf(conv.ops)) !== rapport.empreintes.operations) throw erreur('relecture', 'empreinte des opérations incohérente après écriture');
  const integrite = bilanIntegrite(lu, conv, { bloques, rapport });
  if (!integrite.ok) throw erreur('integrite-apres', 'contrôle d’intégrité après écriture en échec');
  return { ok: true, mode, rapport, ops: conv.ops, alias: conv.alias, inventaire: conv.inventaire, sauvegarde, controle: resumeControle, integrite };
  } catch (e) { if (e && typeof e === 'object') e.sauvegarde = sauvegarde; throw e; }
}

/**
 * Migration d'écriture SÉCURISÉE : si l'écriture échoue après la sauvegarde préalable (panne du magasin, relecture
 * différente, contrôle d'intégrité en échec), la base de départ est reconstruite par `retourArriere` dans une base
 * neuve de test ; l'appelant la substitue. Ne lève jamais : renvoie `{ok: false, code, restauration}`.
 * @param {Parameters<typeof migrerV1>[0] & {creerMagasin: () => Promise<any>}} a
 */
export async function migrerSecurise({ creerMagasin, ...a }) {
  try { return await migrerV1({ ...a, mode: 'ecriture' }); }
  catch (e) {
    const base = { ok: false, mode: 'ecriture', code: e?.code || 'ecriture-echouee', message: String(e?.message ?? e) };
    if (!e?.sauvegarde) return { ...base, restauration: { tentee: false, raison: 'aucune sauvegarde préalable : rien n’a été écrit' } };
    const r = await retourArriere({ sauvegarde: e.sauvegarde, creerMagasin, magasinMigre: a.store });
    return { ...base, restauration: { tentee: true, ok: r.ok, code: r.code, store: r.store, etat: r.etat } };
  }
}

/**
 * Retour arrière (07 §17.11) : rend l'état V2 antérieur EXACTEMENT, dans une base neuve de test, à partir de la
 * sauvegarde vérifiée prise avant la migration. Le journal est en ajout seul : on ne retire rien de la base
 * migrée, on en reconstruit une autre (l'appelant la substitue, puis supprime l'ancienne s'il le décide).
 * Contrôles : sauvegarde intacte (empreintes) et conforme à la poignée ; cible de test et VIDE ; après
 * restauration, journal, objets, alias, file d'envoi et appareil identiques à ceux d'avant. Les archives V1
 * (permanentes) sont recopiées dans la base restaurée. En cas d'échec avant écriture, rien n'est modifié.
 * @param {{sauvegarde: {text: string, etat: any}, creerMagasin: () => Promise<any>, magasinMigre?: any}} a
 */
export async function retourArriere({ sauvegarde, creerMagasin, magasinMigre = null }) {
  const v = await verifyBackup(sauvegarde.text);
  if (!v.ok) return { ok: false, code: 'sauvegarde-altere', message: `sauvegarde refusée : ${v.errors.join(' ; ')}. Rien n’a été modifié.` };
  const b = v.backup;
  if (b.ops.length !== sauvegarde.etat.n || b.objs.length !== sauvegarde.etat.nObjs || b.aliases.length !== sauvegarde.etat.nAlias) return { ok: false, code: 'sauvegarde-differente', message: 'la sauvegarde ne correspond pas à l’état noté avant la migration. Rien n’a été modifié.' };
  const cible = await creerMagasin();
  if (!estMagasinDeTest(cible)) return { ok: false, code: 'base-reelle-refusee', message: 'la cible n’est pas une base de test. Rien n’a été modifié.' };
  if ((await cible.allOps()).length || (await cible.allObjs()).length || (await cible.allAliases()).length) return { ok: false, code: 'cible-non-vide', message: 'la base cible n’est pas vide. Rien n’a été modifié.' };
  await cible.appendOps(b.ops, b.objs, { queue: false });
  if (b.aliases.length) await cible.addAliases(b.aliases);
  if (sauvegarde.etat.dev) await cible.setMeta('dev', sauvegarde.etat.dev);
  if (sauvegarde.etat.pending.length) await cible.requeue(sauvegarde.etat.pending);
  let archives = 0;
  if (magasinMigre) {
    for (const r of await magasinMigre.listMeta(ARCHIVE_PREFIX)) { await cible.setMeta(`${ARCHIVE_PREFIX}${r.sha256}`, r); archives++; }
    for (const r of await magasinMigre.listMeta(INVENTAIRE_PREFIX)) await cible.setMeta(`${INVENTAIRE_PREFIX}${r.archive}`, r);
  }
  const apres = await etatDuMagasin(cible), avant = sauvegarde.etat;
  const ecarts = Object.keys(avant).filter((k) => canonical(avant[k]) !== canonical(apres[k]));
  if (ecarts.length) return { ok: false, code: 'etat-different', message: `l’état restauré diffère de l’état d’avant : ${ecarts.join(', ')}`, store: cible, ecarts };
  return { ok: true, store: cible, etat: apres, archivesConservees: archives };
}

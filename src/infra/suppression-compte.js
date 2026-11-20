// KOTONOHA 2.0 · MOD-11c infra/suppression-compte — client de la suppression différée du compte (08 §19.11).
// Demande → délai de rétractation de D = 72 h → gel des écritures (terme `T`) → suppressions permises à partir de
// `T + M` → le registre des effacements en dernier. L'heure vient de `remote.serverTime()`, jamais de l'appareil.
//
// Port distant (en plus de celui de MOD-11 et de effacement.js) :
//   createDeletion() → {requestedAt}   getDeletion() → {requestedAt}|null   deleteDeletion() (refusé à partir de T)
//   listDocIds(coll) → ids   purgeDelete(coll, id) (refusé avant T + M)    coll ∈ lots, obj, erase-lot, erased, unerase
//
//   supprimerCompteAuth() → {deja}   suppression du compte d'authentification (REST accounts:delete, connexion récente exigée, V-AUTH-02) ;
//                                    erreurs : 'reauth' (connexion récente requise), 'auth', 'offline'
//
// LIMITES (voir v2/LISEZMOI.md §6) : `deletion/{uid}` n'est jamais supprimé ; les instantanés et métadonnées du serveur n'existent
// pas encore ; l'interface (bannière, confirmation, « Déconnecter partout ») n'est pas faite ; rien n'a été éprouvé sur le fournisseur réel.
import { D_MS, M_MS, dateTerme } from './effacement-etat.js';
import { dbName, DB_PREFIX } from './store-idb.js';
import { POINTER_KEY } from './storage.js';

const typed = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });
/** Collections du compte, dans l'ordre de suppression : lots et objets d'abord, le registre des effacements en dernier. */
export const ORDRE = Object.freeze([['lots', 'objets'], ['obj', 'objets'], ['erased', 'registre'], ['erase-lot', 'registre'], ['unerase', 'registre']]);

/**
 * @param {{remote: any}} o
 */
export function createAccountDeletion({ remote }) {
  /** Phase : `aucune`, `differee` (annulable, bannière), `gel` (T atteint, rien ne se synchronise, rien n'est encore supprimé), `purgeable` (T + M atteint). */
  async function status() {
    const t = await remote.serverTime(), d = await remote.getDeletion();
    if (!d) return { phase: 'aucune' };
    const terme = d.requestedAt + D_MS;
    const phase = t < terme ? 'differee' : t < terme + M_MS ? 'gel' : 'purgeable';
    const texte = phase === 'differee' ? `Suppression du compte prévue le ${dateTerme(terme)}.` : 'Suppression du compte en cours';
    return { phase, requestedAt: d.requestedAt, terme, texte };
  }

  /** Demande la suppression : crée `deletion/{uid}` (création seule). Déjà demandée : renvoie l'état. */
  async function demander() {
    try { await remote.createDeletion(); } catch (e) { if (e.code !== 'exists') throw e; }
    return status();
  }

  /** Annule avant le terme. Après : `suppression-definitive`, rien n'est modifié. */
  async function annuler() {
    const st = await status();
    if (st.phase === 'aucune') throw typed('suppression-inconnue', 'Aucune suppression du compte n’est demandée.');
    if (st.phase !== 'differee') throw typed('suppression-definitive', `La suppression du compte est devenue définitive le ${dateTerme(st.terme)}. Elle ne peut plus être annulée.`, { terme: st.terme });
    try { await remote.deleteDeletion(); } catch (e) {
      if (e.code === 'denied') { // le terme est passé entre la lecture et la demande
        const apres = await status();
        if (apres.phase !== 'differee' && apres.phase !== 'aucune') throw typed('suppression-definitive', `La suppression du compte est devenue définitive le ${dateTerme(apres.terme)}. Elle ne peut plus être annulée.`, { terme: apres.terme });
      }
      throw e;
    }
    return status();
  }

  /** Les appareils ne synchronisent plus rien à partir du terme (gel). À brancher sur `createSync({halt})` et `createErasure({halt})`. */
  async function gele() { const st = await status(); return st.phase === 'gel' || st.phase === 'purgeable'; }

  /**
   * Procédure de suppression, reprenable : lots, objets, puis le registre des effacements. Refusée avant T + M.
   * Le registre n'est touché qu'une fois les lots et objets vides (relus). `deletion/{uid}` reste.
   * @returns {Promise<{done: boolean, supprimes: Record<string, number>}>}
   */
  async function purger() {
    const st = await status();
    if (st.phase !== 'purgeable') throw typed('suppression-non-ouverte', st.phase === 'aucune' ? 'Aucune suppression du compte n’est demandée.' : 'La suppression des données n’est pas encore ouverte.');
    const supprimes = {};
    for (const [coll, groupe] of ORDRE) {
      if (groupe === 'registre') { // le registre en dernier : relire les lots et objets, ils doivent être vides
        const reste = (await remote.listDocIds('lots')).length + (await remote.listDocIds('obj')).length;
        if (reste) return { done: false, supprimes };
      }
      for (const id of await remote.listDocIds(coll)) { await remote.purgeDelete(coll, id); supprimes[coll] = (supprimes[coll] || 0) + 1; }
    }
    return { done: true, supprimes };
  }

  return { status, demander, annuler, gele, purger };
}

/**
 * Branchement du gel au démarrage de l'application. À appeler AVANT de créer la synchronisation et le cycle des effacements :
 * `halt` se passe à `createSync({halt})` et à `createErasure({halt})`, qui n'envoient plus rien dès le terme (08 §19.11).
 * La phase est lue sur l'heure du serveur ; hors ligne, elle est inconnue (`phase: 'inconnue'`, `gele: false`) : le gel est alors
 * décidé par le serveur, dont les règles refusent toute écriture après le terme, et relu à chaque cycle par `halt`.
 * @param {{remote: any, deletion?: ReturnType<typeof createAccountDeletion>}} o
 * @returns {Promise<{deletion: any, halt: () => Promise<boolean>, etat: {phase: string, gele: boolean, texte?: string, terme?: number, erreur?: string}}>}
 */
export async function demarrerSuppression({ remote, deletion = createAccountDeletion({ remote }) }) {
  const halt = () => deletion.gele();
  let etat;
  try {
    const st = await deletion.status();
    etat = { ...st, gele: st.phase === 'gel' || st.phase === 'purgeable' };
  } catch (e) { etat = { phase: 'inconnue', gele: false, erreur: e.code || 'erreur' }; }
  return { deletion, halt, etat };
}

/** Attente de la fin d'une requête de suppression de base (réussite, erreur, blocage prolongé). */
function supprimerBase(idb, name, delaiMs) {
  return new Promise((res, rej) => {
    const req = idb.deleteDatabase(name);
    const t = setTimeout(() => rej(typed('base-bloquee', 'Une autre fenêtre garde la base ouverte : fermez les autres onglets de KOTONOHA, puis recommencez.')), delaiMs);
    req.onsuccess = () => { clearTimeout(t); res(true); };
    req.onerror = () => { clearTimeout(t); rej(typed('base-erreur', 'La base de cet appareil n’a pas pu être supprimée.')); };
    // onblocked : les autres onglets ferment leur connexion au changement de version (store-idb) ; on attend onsuccess.
  });
}

/**
 * Suppression des données de CET appareil pour un compte : la base IndexedDB `kotonoha2-u-<compte>` (journal, objets, file
 * d'envoi, instantanés, sauvegardes, registre des destructions, enregistrements d'effacement, session) et l'entrée du pointeur
 * de `localStorage`. La base sans compte (`kotonoha2-local`) et les clés de la V1 ne sont jamais touchées.
 * À ne lancer qu'une fois la suppression serveur terminée (`terminer`) ou sur décision explicite de l'apprenant.
 * @param {{account: string, closeJournal?: () => any, indexedDB?: IDBFactory, storage?: Storage|null, delaiMs?: number}} o
 * @returns {Promise<{base: string, supprimee: boolean, pointeur: boolean, restantes: string[]|null}>}
 */
export async function supprimerDonneesLocales({ account, closeJournal, indexedDB: idb = globalThis.indexedDB, storage = globalThis.localStorage ?? null, delaiMs = 10_000 }) {
  if (typeof account !== 'string' || !account) throw typed('compte-requis', 'Aucun compte : la base de cet appareil sans compte n’est jamais supprimée ici.');
  const name = dbName(account);
  if (!name.startsWith(DB_PREFIX) || name === dbName(null)) throw typed('base-refusee', 'Base hors de l’espace du compte.');
  try { await closeJournal?.(); } catch { /* déjà fermé */ }
  await supprimerBase(idb, name, delaiMs);
  let pointeur = false;
  try {
    const p = JSON.parse(storage?.getItem(POINTER_KEY) || 'null');
    if (p && typeof p === 'object' && name in p) { delete p[name]; if (Object.keys(p).length) storage.setItem(POINTER_KEY, JSON.stringify(p)); else storage.removeItem(POINTER_KEY); pointeur = true; }
  } catch { /* stockage indisponible : sans conséquence sur la suppression de la base */ }
  const restantes = idb.databases ? (await idb.databases()).map((d) => d.name).filter((n) => n === name) : null;
  return { base: name, supprimee: !restantes || restantes.length === 0, pointeur, restantes };
}

/**
 * Fin de la suppression du compte, reprenable, dans l'ordre de 08 §19.11 : (1) documents du serveur (`purger`), (2) compte
 * d'authentification (`remote.supprimerCompteAuth`, qui peut exiger une connexion récente), (3) données de cet appareil.
 * Une étape qui échoue arrête la suite : rien de local n'est supprimé tant que le compte d'authentification existe.
 * @param {{remote: any, account: string, deletion?: any, closeJournal?: () => any, auth?: {signOut: () => Promise<void>}|null, indexedDB?: IDBFactory, storage?: Storage|null}} o
 * @returns {Promise<{done: boolean, etape: 'serveur'|'authentification'|'appareil'|'fini', supprimes?: any, erreur?: {code: string, message: string}, local?: any}>}
 */
export async function terminer({ remote, account, deletion = createAccountDeletion({ remote }), closeJournal, auth = null, indexedDB: idb, storage }) {
  const p = await deletion.purger();
  if (!p.done) return { done: false, etape: 'serveur', supprimes: p.supprimes };
  if (typeof remote.supprimerCompteAuth !== 'function') return { done: false, etape: 'authentification', supprimes: p.supprimes, erreur: { code: 'port-absent', message: 'La suppression du compte d’authentification n’est pas disponible.' } };
  try { await remote.supprimerCompteAuth(); } catch (e) {
    return { done: false, etape: 'authentification', supprimes: p.supprimes, erreur: { code: e.code || 'erreur', message: e.code === 'reauth' ? 'Reconnectez-vous, puis relancez la suppression : le service de comptes exige une connexion récente.' : String(e.message || e) } };
  }
  try { await auth?.signOut(); } catch { /* jetons déjà invalides */ }
  const local = await supprimerDonneesLocales({ account, closeJournal, indexedDB: idb, storage });
  return { done: local.supprimee, etape: local.supprimee ? 'fini' : 'appareil', supprimes: p.supprimes, local };
}

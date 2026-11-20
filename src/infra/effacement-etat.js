// KOTONOHA 2.0 · cycle de vie d'un effacement, partie sans entrée-sortie (08 §19.16, normatif).
// Constantes du serveur, enregistrement local d'un effacement, refus d'annulation. Partagé par le
// journal (cancelErase), la synchronisation et le client du cycle de vie (effacement.js).

/** Délai avant le terme `T = createdAt + D` ; marge de sûreté `M` ; taille maximale d'un lot `N`. [Hyp] 08 §19.16. */
export const D_MS = 72 * 3600_000;
export const M_MS = 3600_000;
export const N_LOT = 1000;

/** Préfixe des enregistrements locaux d'effacement (méta du magasin). */
export const EFF = 'eff:e:';
export const effKey = (eraseId) => EFF + eraseId;

/**
 * Marque d'ORIGINE LOCALE (ANO-016, correctif n° 2) : un enregistrement `eff:l:<effacement>` = `{id, objs, cancelled}` par
 * effacement écrit sur CET appareil (`journal.write` d'une `erase` portant son `dev`, ou rattrapage d'une base antérieure).
 * Le `dev`, le `hlc`, les `objs` et l'identifiant d'une opération REÇUE ne sont que des déclarations ; cette marque, écrite
 * par l'appareil lui-même, est la seule source de « cet objet est effacé par l'auteur ». Elle ne se lève que par une annulation
 * LOCALE (`cancelErase`) ou la confirmation du serveur (`unerase/`, enregistrement `eff:e:` à l'état `annule`).
 */
export const LOC = 'eff:l:';
export const locKey = (eraseId) => LOC + eraseId;
/** Rejets d'opérations usurpées (trace durable, une entrée par opération rejetée ; `resumed` : l'apprenant a repris l'effacement). */
export const REJ = 'eff:rej:';
export const rejKey = (opId) => REJ + opId;

/**
 * États de l'enregistrement local d'un effacement :
 *  - `fige`     : lot figé (identifiant et liste enregistrés AVANT l'envoi) ; `tentative` dit qu'un envoi a été essayé ;
 *  - `lot`      : lot accepté par le serveur (E3), marqueurs encore à créer ;
 *  - `marques`  : marqueurs créés (E3 stable) ;
 *  - `definitif`: heure du serveur >= T observée (E4), rien n'est encore détruit ;
 *  - `detruit`  : copies locales détruites et suppression serveur acceptée ;
 *  - `annule`   : `unerase/` accepté par le serveur (retour en E0) ;
 *  - `annule-local` : annulation en E2 avant tout envoi ;
 *  - `refuse`   : création du lot refusée par le serveur.
 */
export const STATUTS = Object.freeze(['fige', 'lot', 'marques', 'definitif', 'detruit', 'annule', 'annule-local', 'refuse']);
/** Statuts dont les objets sont masqués et ne repartent jamais vers le serveur. */
export const ACTIFS = Object.freeze(['fige', 'lot', 'marques', 'definitif', 'detruit']);
/** Statuts qui supposent que le serveur détient (ou peut détenir) le lot : plus d'annulation locale. */
export const ENGAGES = Object.freeze(['lot', 'marques', 'definitif', 'detruit']);

/** Date lisible d'un terme, en UTC (jamais l'horloge de l'appareil). */
export const dateTerme = (t) => new Date(t).toISOString().replace('T', ' à ').slice(0, 19) + ' UTC';

/**
 * L'annulation locale (journal seul) est-elle permise pour cet enregistrement ?
 * @param {any} rec enregistrement ou undefined @returns {null|{code: string, message: string}} null si permise
 */
export function refusAnnulationLocale(rec) {
  if (!rec) return null;
  if (rec.status === 'definitif' || rec.status === 'detruit') return { code: 'erase-definitif', message: 'Cet effacement est définitif : il ne peut plus être annulé.' };
  if (ENGAGES.includes(rec.status)) return { code: 'erase-engage', message: 'Cet effacement est déjà enregistré sur le serveur : il ne s’annule plus sur cet appareil seul. Utilisez l’annulation d’un effacement en attente.' };
  if (rec.status === 'fige' && rec.tentative) return { code: 'erase-incertain', message: 'Le lot d’effacement a peut-être déjà été envoyé au serveur : il faut d’abord le vérifier. Rien n’a été modifié.' };
  return null;
}

/** Statuts d'enregistrement `eff:e:` qui lèvent la marque locale : `unerase/` constaté, ou annulation locale d'un lot figé. */
const LEVEES = Object.freeze(['annule', 'annule-local']);

/**
 * Annulation constatée sur le serveur mais NON demandée par cet appareil auteur (`distant`, ANO-016 correctif n° 3) : tant que
 * l'apprenant ne l'a pas confirmée sur cet appareil (`confirmed`), elle ne lève rien : un `unerase/` écrit par un tiers du compte
 * ne fait jamais partir un texte effacé ici.
 */
export const enAttenteDeConfirmation = (r) => r.status === 'annule' && !!r.distant && !r.confirmed;
/** Ce statut d'enregistrement lève-t-il la marque d'origine locale ? */
export const leveLaMarque = (r) => LEVEES.includes(r.status) && !enAttenteDeConfirmation(r);

/**
 * Objets masqués par la seule marque d'origine locale : ceux des effacements écrits ici, non annulés localement, sans
 * `unerase/` constaté. Ne lit AUCUNE opération du journal. @param {any} store @param {{recs?: any[]}} [o]
 * @returns {Promise<Set<string>>}
 */
export async function maskedByLocal(store, { recs } = {}) {
  recs = recs || await store.listMeta(EFF);
  const lifted = new Set(recs.filter(leveLaMarque).map((r) => r.id)), out = new Set();
  for (const l of await store.listMeta(LOC)) if (!l.cancelled && !lifted.has(l.id)) for (const id of l.objs) out.add(id);
  return out;
}

/**
 * Objets masqués par les enregistrements et le registre des destructions. Avec `journal` : aussi les objets d'un effacement
 * que le journal dit révoqué par un AUTRE appareil (`erase.revoke`) tant que cet appareil n'a pas lui-même constaté
 * `unerase/` sur le serveur (enregistrement `annule`) : une révocation forgée ne rend aucun texte aux échanges.
 * @param {any} store @param {any} [journal] @param {{local?: boolean}} [o] `local: false` : sans la marque d'origine locale (figement des lots)
 * @returns {Promise<Set<string>>}
 */
export async function maskedFromStore(store, journal, { local = true } = {}) {
  const out = new Set(await store.erasedIds?.() || []), recs = await store.listMeta(EFF);
  for (const r of recs) if (ACTIFS.includes(r.status)) for (const id of r.objs) out.add(id);
  if (local) for (const id of await maskedByLocal(store, { recs })) out.add(id);
  if (journal) {
    const confirmed = new Set(recs.filter((r) => r.status === 'annule').map((r) => r.id));
    for (const e of journal.derived.acc.eras) if (e.revokedBy && !confirmed.has(e.id)) for (const id of e.objs) out.add(id);
  }
  return out;
}

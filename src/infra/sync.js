// KOTONOHA 2.0 · MOD-11 infra/sync — protocole de lots, réception, réconciliation, états de la
// synchronisation (08 §7.1 à §7.7 ; D-101 ; INV-07, INV-08). Le fournisseur est derrière un port
// (`remote`, MOD-12) : ce module ne connaît ni Firestore ni le réseau.
//
// Port distant attendu (toutes les méthodes sont asynchrones ; une erreur porte `code`) :
//   createLot(lot) → {receivedAt}      lot = {id, dev, schema, n, sha256, body} ; création seule
//   getLot(id) → lot | null            listLots({since}) → lots (receivedAt ≥ since, croissant)
//   listLotIds() → string[]            createObj(obj) → {receivedAt} ; création seule
//   getObj(id) → obj | null
//   codes : 'exists' (déjà créé), 'offline', 'auth' (jeton refusé), 'denied' (règle), 'invalid'.
import { canonical, hashOf } from '../core/canon.js';
import { readOp, SCHEMA } from '../core/ops.js';
import { objectValid } from '../core/objects.js';
import { newId } from '../core/ids.js';
import { maskedFromStore } from './effacement-etat.js';

export const LOT_MAX_OPS = 200;              // [Hyp] 08 §7.3 : taille d'un lot
export const LOT_MAX_BYTES = 600_000;        // sous la limite de 1 Mio d'un document Firestore
export const OVERLAP_MS = 10 * 60_000;       // [Hyp] recouvrement de lecture (V-REG-04 le mesurera)
export const RECONCILE_MS = 24 * 3600_000;   // [Hyp] réconciliation complète au moins quotidienne
export const STATES = Object.freeze(['local', 'reconciliation', 'a-jour', 'en-attente', 'hors-ligne', 'session-expiree', 'mise-a-jour-requise', 'erreur', 'suppression-compte']);

const K = { cursor: 'sync:curseur', reconciled: 'sync:reconcilie', missing: 'sync:objets-manquants', unsent: 'sync:objets-retenus' };
const lotKey = 'lot:';

/** Attente avant une nouvelle tentative : croissante, plafonnée, avec une part aléatoire. */
export const backoff = (attempt, random = Math.random, base = 2_000, max = 5 * 60_000) => Math.round(Math.min(max, base * 2 ** attempt) * (0.5 + random() / 2));

/** Corps d'un lot : forme canonique des opérations ; l'empreinte porte sur ce corps exact. */
export async function lotBody(ops) { const body = canonical(ops); return { body, sha256: await hashOf(ops) }; }

/** Vérifie un lot reçu et en extrait les opérations. @returns {Promise<{ok: boolean, ops?: any[], newer?: boolean, why?: string}>} */
export async function readLot(lot) {
  let ops;
  try { ops = JSON.parse(lot.body); } catch { return { ok: false, why: 'corps illisible' }; }
  if (!Array.isArray(ops) || ops.length !== lot.n || canonical(ops) !== lot.body || (await hashOf(ops)) !== lot.sha256) return { ok: false, why: 'empreinte ou taille incorrecte' };
  if (lot.schema > SCHEMA || ops.some((o) => o?.s > SCHEMA)) return { ok: false, newer: true, why: 'schéma plus récent' };
  try { return { ok: true, ops: ops.map(readOp) }; } catch (e) { return { ok: false, why: e.message }; }
}

/**
 * @param {{journal: any, remote: any, now?: () => number, random?: () => number, log?: (e: any) => void, halt?: (() => Promise<boolean>)|null}} o
 */
export function createSync({ journal, remote, now = () => Date.now(), random = Math.random, log = () => {}, halt = null }) {
  const store = journal.store, listeners = new Set();
  let state = remote ? 'reconciliation' : 'local', received = false, attempt = 0, updateRequired = false, lastError = null;
  const anomalies = [];
  const set = (s, detail) => { if (s !== state) { state = s; for (const f of listeners) f({ state, detail }); } };
  const anomaly = (type, detail) => { const a = { type, at: now(), ...detail }; anomalies.push(a); log(a); };
  const records = async () => new Map((await store.listMeta(lotKey)).map((r) => [r.id, r]));
  const byId = () => new Map(journal.ops.map((o) => [o.op, o]));

  /** Objets référencés par des opérations (révisions de documents, réponses avec texte). */
  const refsOf = (ops) => ops.flatMap((o) => (o.payload?.obj ? [o.payload.obj] : []));

  /**
   * Objets que des annulations d'effacement (`erase.cancel`, R5) peuvent rendre visibles. Ils n'ont été ni
   * envoyés ni reçus tant qu'ils étaient masqués (E2), et l'annulation ne porte aucune référence d'objet.
   * Les appelants écartent ceux qui restent masqués (annulation sans effet, autre effacement actif).
   */
  function uncoveredRefs(ops) {
    const cancels = new Set(ops.filter((o) => o.type === 'erase.cancel' || o.type === 'erase.revoke').map((o) => o.subject));
    if (!cancels.size) return [];
    const refs = new Map(refsOf(journal.derived.sorted).map((r) => [r.id, r]));
    return journal.derived.acc.eras.filter((e) => cancels.has(e.id)).flatMap((e) => e.objs.filter((id) => refs.has(id)).map((id) => refs.get(id)));
  }

  // ——— Envoi ———

  async function sendObjects(ops) {
    const local = new Map((await journal.objects()).map((x) => [x.id, x]));
    const erased = journal.view.erase, masked = await maskedFromStore(store, journal); // E2 (journal), E3 et E4 (cycle de vie), détruits (registre)
    const held = new Set((await store.getMeta(K.unsent)) || []);
    for (const ref of refsOf(ops).concat(uncoveredRefs(ops))) {
      const obj = local.get(ref.id);
      if (!obj) continue;
      if (erased[ref.id] || masked.has(ref.id)) { held.add(ref.id); continue; } // effacé (E2 à E4) : jamais envoyé, mais retenu pour plus tard si l'effacement est annulé
      await uploadObject(obj); held.delete(ref.id);
    }
    // Objets retenus, devenus visibles sans nouvelle opération qui les cite (annulation faite par un autre appareil) : envoyés maintenant.
    for (const id of [...held]) {
      const obj = local.get(id);
      if (!obj) { held.delete(id); continue; }
      if (erased[id] || masked.has(id)) continue;
      await uploadObject(obj); held.delete(id);
    }
    await store.setMeta(K.unsent, [...held].sort());
  }

  async function uploadObject(obj) {
    try { await remote.createObj(obj); } catch (e) {
      if (e.code !== 'exists') throw e;
      const there = await remote.getObj(obj.id);
      if (!there || canonical({ id: there.id, salt: there.salt, content: there.content, h: there.h }) !== canonical(obj)) anomaly('objet-different', { obj: obj.id });
    }
  }

  /** Lot figé inutilisable : abandonné ; ses opérations encore présentes repartent dans un nouveau lot. */
  const abandon = (rec) => store.setMeta(lotKey + rec.id, { ...rec, status: 'abandonne' });

  /** Envoie un lot figé, à l'identique ; un refus « existe déjà » est un succès si l'empreinte concorde. */
  async function sendLot(rec) {
    const all = byId(), ops = rec.ops.map((id) => all.get(id));
    if (ops.some((o) => !o)) { anomaly('lot-incomplet', { lot: rec.id }); await abandon(rec); return false; }
    const { body, sha256 } = await lotBody(ops);
    if (sha256 !== rec.sha256) { anomaly('lot-modifie', { lot: rec.id }); await abandon(rec); return false; }
    await sendObjects(ops);
    let receivedAt;
    try { ({ receivedAt } = await remote.createLot({ id: rec.id, dev: rec.dev, schema: SCHEMA, n: ops.length, sha256, body })); } catch (e) {
      if (e.code !== 'exists') throw e;
      const there = await remote.getLot(rec.id);
      if (!there) throw Object.assign(new Error('lot annoncé existant mais illisible'), { code: 'invalid' });
      if (there.sha256 === sha256) receivedAt = there.receivedAt;
      else {
        // Ne devrait pas arriver avec un lot figé (08 §7.3) : on garde ce que le serveur détient, le reste repart dans un nouveau lot.
        const r = await readLot(there), onServer = new Set(r.ok ? r.ops.map((o) => o.op) : []);
        const acked = rec.ops.filter((id) => onServer.has(id));
        anomaly('lot-different', { lot: rec.id, reconnues: acked.length, renvoyees: rec.ops.length - acked.length });
        await store.ackLot({ ...rec, status: 'reconnu-partiel', ops: acked, receivedAt: there.receivedAt }, acked);
        return true;
      }
    }
    await store.ackLot({ ...rec, status: 'reconnu', receivedAt }, rec.ops);
    return true;
  }

  /** Fige le prochain lot : identifiant, liste et empreinte enregistrés AVANT le premier envoi. */
  async function freeze() {
    const recs = await records();
    const frozen = new Set([...recs.values()].filter((r) => r.status === 'fige').flatMap((r) => r.ops));
    const pending = new Set(await store.pendingIds());
    const ops = journal.derived.sorted.filter((o) => pending.has(o.op) && !frozen.has(o.op));
    if (!ops.length) return null;
    const take = [];
    let bytes = 2;
    for (const o of ops) { const n = canonical(o).length + 1; if (take.length && (take.length >= LOT_MAX_OPS || bytes + n > LOT_MAX_BYTES)) break; take.push(o); bytes += n; }
    const rec = { id: newId('lot', undefined, now()), dev: journal.dev, ops: take.map((o) => o.op), sha256: (await lotBody(take)).sha256, n: take.length, status: 'fige', at: now() };
    await store.setMeta(lotKey + rec.id, rec);
    return rec;
  }

  async function push() {
    if (!received) return { sent: 0, reason: 'premiere-reception-attendue' }; // démarrage sûr (08 §7.7)
    if (updateRequired) return { sent: 0, reason: 'mise-a-jour-requise' };
    let sent = 0;
    if ((await store.getMeta(K.unsent))?.length) await sendObjects([]); // objets retenus par un effacement, devenus visibles
    for (const rec of [...(await records()).values()].filter((r) => r.status === 'fige').sort((a, b) => a.at - b.at)) if (await sendLot(rec)) sent++;
    for (let rec = await freeze(); rec; rec = await freeze()) { if (await sendLot(rec)) sent++; else break; }
    return { sent };
  }

  // ——— Réception ———

  async function fetchObjects(ops, wanted) {
    const local = new Set((await journal.objects()).map((x) => x.id)), erased = journal.view.erase, masked = await maskedFromStore(store, journal), out = [], missing = [];
    for (const ref of refsOf(ops).concat(wanted)) {
      if (local.has(ref.id) || erased[ref.id] || masked.has(ref.id) || out.some((x) => x.id === ref.id)) continue;
      const obj = await remote.getObj(ref.id);
      if (!obj) { missing.push(ref); continue; }
      const clean = { id: obj.id, salt: obj.salt, content: obj.content, h: obj.h };
      if (clean.h !== ref.h || !(await objectValid(clean))) { anomaly('objet-altere', { obj: ref.id }); continue; }
      out.push(clean);
    }
    return { objs: out, missing };
  }

  async function pull({ full = false } = {}) {
    const cursor = full ? 0 : (await store.getMeta(K.cursor)) || 0;
    const lots = await remote.listLots({ since: Math.max(0, cursor - OVERLAP_MS) });
    const recs = await records();
    let next = cursor, hold = Infinity, got = 0, newer = false;
    const accepted = [];
    const prevMissing = (await store.getMeta(K.missing)) || [];
    for (const lot of lots) {
      const mine = recs.get(lot.id);
      if (mine && mine.status === 'fige' && mine.sha256 === lot.sha256) { await store.ackLot({ ...mine, status: 'reconnu', receivedAt: lot.receivedAt }, mine.ops); continue; } // réponse perdue
      if (mine) { next = Math.max(next, lot.receivedAt); continue; }
      const r = await readLot(lot);
      if (!r.ok) {
        if (r.newer) { newer = true; hold = Math.min(hold, lot.receivedAt); continue; } // gardé pour après la mise à jour
        anomaly('lot-refuse', { lot: lot.id, why: r.why });
        await store.setMeta(lotKey + lot.id, { id: lot.id, status: 'refuse', why: r.why, receivedAt: lot.receivedAt });
        next = Math.max(next, lot.receivedAt); continue;
      }
      accepted.push({ lot, ops: r.ops, ...(await fetchObjects(r.ops, [])) });
    }
    // ANO-016 : une annulation d'effacement prétendant venir de cet appareil sans être dans son journal est rejetée par le journal ; signalée ici.
    const signal = (r) => { const rej = new Set(r?.rejected || []); for (const id of rej) anomaly('operation-usurpee', { op: id }); return rej; };
    // Une seule insertion (une dérivation) pour tous les lots ; en cas de conflit, lot par lot.
    // Seules les opérations ACCEPTÉES par le journal comptent : une annulation rejetée ne rend aucun objet « récupérable ».
    const done = async (a, rej = new Set()) => { if (a.missing.length) prevMissing.push(...a.missing); prevMissing.push(...uncoveredRefs(a.ops.filter((o) => !rej.has(o.op)))); await store.setMeta(lotKey + a.lot.id, { id: a.lot.id, dev: a.lot.dev, status: 'recu', sha256: a.lot.sha256, n: a.lot.n, receivedAt: a.lot.receivedAt }); next = Math.max(next, a.lot.receivedAt); got++; };
    const refuse = async (a, e) => { anomaly('lot-en-conflit', { lot: a.lot.id, why: e.message }); await store.setMeta(lotKey + a.lot.id, { id: a.lot.id, status: 'refuse', why: 'conflit', receivedAt: a.lot.receivedAt }); next = Math.max(next, a.lot.receivedAt); };
    if (accepted.length) {
      try { const rej = signal(await journal.receive(accepted.flatMap((a) => a.ops), accepted.flatMap((a) => a.objs))); for (const a of accepted) await done(a, rej); } catch (e) {
        if (e.code !== 'conflict') throw e;
        for (const a of accepted) { try { await done(a, signal(await journal.receive(a.ops, a.objs))); } catch (x) { if (x.code !== 'conflict') throw x; await refuse(a, x); } }
      }
    }
    // Objets arrivés après leur opération : nouvel essai à chaque réception.
    if (prevMissing.length) { const { objs, missing } = await fetchObjects([], prevMissing); if (objs.length) await journal.receive([], objs); await store.setMeta(K.missing, missing); }
    updateRequired = newer;
    await store.setMeta(K.cursor, Math.min(next, hold === Infinity ? next : hold - 1));
    received = true;
    return { received: got, newer };
  }

  /** Réconciliation complète (08 §7.3) : listes de lots locale et distante comparées. */
  async function reconcile() {
    const remoteIds = new Set(await remote.listLotIds()), recs = await records();
    const unknown = [...remoteIds].filter((id) => !recs.has(id));
    if (unknown.length) await pull({ full: true });
    let requeued = 0;
    for (const r of recs.values()) {
      if ((r.status === 'reconnu' || r.status === 'reconnu-partiel') && !remoteIds.has(r.id)) {
        anomaly('lot-perdu-sur-le-serveur', { lot: r.id }); // impossible par les règles : seul un incident du fournisseur l'explique
        await store.requeue(r.ops); await store.setMeta(lotKey + r.id, { ...r, status: 'perdu' }); requeued += r.ops.length;
      }
      if (r.status === 'recu' && !remoteIds.has(r.id)) anomaly('lot-recu-absent-du-serveur', { lot: r.id });
    }
    await store.setMeta(K.reconciled, now());
    return { unknown: unknown.length, requeued };
  }

  /** Un cycle complet : réception, envoi, réconciliation si elle date. Ne lève jamais : l'état dit ce qui se passe. */
  async function cycle() {
    if (!remote) { set('local'); return { state }; }
    set(received ? state : 'reconciliation');
    try {
      if (halt && (await halt())) { set('suppression-compte'); return { state, retryIn: null }; } // suppression du compte arrivée à son terme (08 §19.11) : rien ne se synchronise plus
      const first = !received;
      if (first) await reconcile();
      await pull();
      if (!first && now() - ((await store.getMeta(K.reconciled)) || 0) > RECONCILE_MS) await reconcile();
      await push();
      attempt = 0; lastError = null;
      const pending = (await store.pendingIds()).length;
      set(updateRequired ? 'mise-a-jour-requise' : pending ? 'en-attente' : 'a-jour', { pending });
    } catch (e) {
      lastError = { code: e.code || 'erreur', message: String(e.message || e) };
      attempt++;
      set(e.code === 'offline' ? 'hors-ligne' : e.code === 'auth' ? 'session-expiree' : 'erreur', lastError);
    }
    return { state, retryIn: state === 'hors-ligne' || state === 'erreur' ? backoff(attempt - 1, random) : null };
  }

  /** Verrou entre onglets : un seul cycle à la fois pour une même base. */
  const run = () => (globalThis.navigator?.locks ? navigator.locks.request(`kotonoha2-sync-${store.name}`, cycle) : cycle());

  return {
    get state() { return state; },
    get anomalies() { return [...anomalies]; },
    get lastError() { return lastError; },
    get firstReceptionDone() { return received; },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    cycle: run, pull, push, reconcile,
    /** Libellé de 08 §7.7 : « Synchronisé » seulement si la file est vide ET la réconciliation récente. */
    async label() {
      const pending = (await store.pendingIds()).length, at = (await store.getMeta(K.reconciled)) || 0;
      switch (state) {
        case 'local': return 'Sur cet appareil seulement';
        case 'reconciliation': return 'Mise à jour…';
        case 'hors-ligne': return 'Hors ligne · vos actions sont enregistrées sur cet appareil';
        case 'session-expiree': return `Reconnectez-vous pour envoyer vos ${pending} actions`;
        case 'mise-a-jour-requise': return 'Une version plus récente de KOTONOHA a été utilisée sur un autre appareil. Vos nouvelles actions sont enregistrées sur cet appareil et seront envoyées après la mise à jour.';
        case 'suppression-compte': return 'Suppression du compte en cours';
        case 'erreur': return 'Erreur de synchronisation : exportez maintenant ou réessayez';
        default: return pending ? `${pending} actions en attente d’envoi` : now() - at < RECONCILE_MS ? 'Synchronisé' : 'Envoyé · vérification en attente';
      }
    },
  };
}

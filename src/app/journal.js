// KOTONOHA 2.0 · MOD-09 app — journal de l'apprenant : commandes, tampon d'échec, onglets,
// coupures, instantanés (07 §4.3, 08 §7, §8.3, §10.7, §19.1, §19.2). Source de vérité locale : le
// journal ; l'interface ne modifie jamais un état dérivé.
import { newId } from '../core/ids.js';
import { Clock, cmpHlc } from '../core/hlc.js';
import { makeOp, readOp, categoryOf, MAX_CUT_OPS } from '../core/ops.js';
import { derive, deriveFrom, makeSnapshot, viewHash } from '../core/derive.js';
import { makeObject, objectValid } from '../core/objects.js';
import { exclusif } from '../infra/verrou.js';
import { canonical } from '../core/canon.js';
import { effKey, refusAnnulationLocale, EFF, LOC, locKey, REJ, rejKey } from '../infra/effacement-etat.js';
export { makeObject, objectValid } from '../core/objects.js';

const SNAPS_KEPT = 5;
/**
 * Ouvre le journal sur un magasin (IndexedDB ou mémoire).
 * @param {{store: any, account?: string|null, now?: () => number, channel?: BroadcastChannel|null, onSaved?: (n: number) => void}} o
 */
export async function openJournal({ store, account = null, now = () => Date.now(), channel = null, onSaved, beforeRisky = null }) {
  let dev = await store.getMeta('dev');
  if (!dev) { dev = newId('dev', undefined, now()); await store.setMeta('dev', dev); }
  const clock = new Clock([0, 0], now);
  const listeners = new Set();
  const status = { erasedRefused: [], readOnly: null, buffer: [], bufferObjs: [], exported: false, lastError: null, updateRequired: false, invalid: [], evicted: null, usurped: [], foreignErases: [], unprovenMarks: [] };
  let ops = [], d = null, hash = '';
  /** Marques d'origine locale (`eff:l:`) et rejets (`eff:rej:`), relus du magasin à chaque chargement (ANO-016, correctif n° 2). */
  let locals = new Map(), rejs = new Map();
  const isClaim = (o) => o.type === 'erase.cancel' || o.type === 'erase.revoke';
  /** Opérations créées ICI par `op()` (donc par `record`) : seules celles-là peuvent poser une marque d'origine locale (ni réception, ni restauration, ni transfert entre onglets). */
  const created = new WeakSet();
  const MIGRE = 'eff:l-migre'; // drapeau durable : le rattrapage d'une base antérieure à la marque ne s'exécute qu'UNE fois

  const emit = (type, detail) => { for (const f of listeners) f({ type, detail }); };

  async function load() {
    const raw = await store.allOps();
    const ok = [], invalid = [];
    for (const r of raw) { try { ok.push(readOp(r)); } catch (e) { invalid.push(r?.op); if (e.code === 'schema-newer') status.updateRequired = true; } }
    status.invalid = invalid;
    for (const o of ok) if (cmpHlc(o.hlc, clock.h) > 0) clock.recv(o.hlc);
    ops = ok;
    // Entrées du tampon enregistrées entre-temps (par un autre onglet) : retirées du tampon.
    if (status.buffer.length) {
      const have = new Set(ops.map((o) => o.op));
      status.buffer = status.buffer.filter((o) => !have.has(o.op));
      if (!status.buffer.length) { status.bufferObjs = []; status.exported = false; status.lastError = null; }
    }
    // Démarrage : instantané le plus récent utilisable, sinon dérivation complète (08 §7.6).
    const snaps = (await store.listSnaps()).sort((a, b) => b.t - a.t);
    let r = null;
    for (const s of snaps) { r = await deriveFrom(s, ops); if (r) break; }
    await loadLocal();
    d = derive(ops);
    hash = await viewHash(d.view);
    return { fromSnapshot: !!r, snapshotAgrees: r ? (await viewHash(r.view)) === hash : null };
  }
  /**
   * Marques d'origine locale et rejets. Rattrapage d'une base antérieure à la marque, UNE SEULE FOIS (drapeau durable `eff:l-migre`) :
   * une `erase` portant le `dev` de cet appareil et sans marque en reçoit une SEULEMENT si elle est prouvée locale (présente dans
   * la file d'envoi ou dans un lot envoyé par cet appareil, `lot:`.ops) ; elle n'est annulée que si l'état LOCAL le prouve
   * (enregistrement `annule` / `annule-local`, ou annulation du même `dev` présente dans la file ou un lot envoyé). Toute autre
   * `erase` au `dev` de cet appareil sans marque (reçue, restaurée) est ÉTRANGÈRE : jamais adoptée, signalée (`status.foreignErases`).
   */
  async function loadLocal() {
    locals = new Map((await store.listMeta(LOC)).map((l) => [l.id, l]));
    const mine = ops.filter((o) => o.type === 'erase' && o.dev === dev && !locals.has(o.subject));
    if (!(await store.getMeta(MIGRE))) {
      if (mine.length || locals.size) {
      const recs = new Map((await store.listMeta(EFF)).map((r) => [r.id, r]));
      const sent = new Set([...(await store.pendingIds()), ...(await store.listMeta('lot:')).flatMap((r) => r?.ops || [])]);
      for (const o of mine) {
        if (locals.has(o.subject) || !sent.has(o.op)) continue; // non prouvée locale : étrangère
        const objs = [...new Set(ops.filter((x) => x.type === 'erase' && x.dev === dev && x.subject === o.subject && sent.has(x.op)).flatMap((x) => x.payload.objs))].sort();
        const lifted = ['annule', 'annule-local'].includes(recs.get(o.subject)?.status) || ops.some((c) => c.type === 'erase.cancel' && c.subject === o.subject && c.dev === dev && sent.has(c.op));
        const m = { id: o.subject, objs, cancelled: lifted };
        try { await store.setMeta(locKey(o.subject), m); } catch { /* lecture seule : la marque reste en mémoire, rattrapée au prochain chargement */ }
        locals.set(o.subject, m);
      }
      // Marques DÉJÀ posées (n° 2) : conservées telles quelles (les supprimer démasquerait), mais les objets dont aucune `erase` de cet
      // appareil n'est prouvée locale sont signalés (`unproven`) : masqués, jamais envoyés ni détruits.
      for (const l of [...locals.values()]) {
        if (l.cancelled || l.unproven) continue;
        const proven = new Set(ops.filter((x) => x.type === 'erase' && x.dev === dev && x.subject === l.id && sent.has(x.op)).flatMap((x) => x.payload.objs));
        const unproven = l.objs.filter((id) => !proven.has(id)).sort();
        if (!unproven.length) continue;
        const m = { ...l, unproven };
        try { await store.setMeta(locKey(l.id), m); } catch { /* lecture seule : la marque reste en mémoire, réexaminée au prochain chargement */ }
        locals.set(l.id, m);
      }
      }
      try { await store.setMeta(MIGRE, true); } catch { /* lecture seule : refait au prochain chargement */ }
    }
    status.unprovenMarks = [...locals.values()].filter((l) => l.unproven?.length).map((l) => ({ id: l.id, objs: [...l.unproven] })).sort((a, b) => (a.id < b.id ? -1 : 1));
    status.foreignErases = ops.filter((o) => o.type === 'erase' && o.dev === dev && (!locals.has(o.subject) || o.payload.objs.some((id) => !locals.get(o.subject).objs.includes(id)))).map((o) => ({ op: o.op, subject: o.subject }));
    rejs = new Map((await store.listMeta(REJ)).map((r) => [r.op, r]));
    status.usurped = [...rejs.values()].sort((a, b) => a.at - b.at || (a.op < b.op ? -1 : 1)).map((r) => ({ op: r.op, type: r.type, subject: r.subject, at: r.at }));
  }
  const started = await load();

  /** Marque d'origine locale écrite AVANT l'opération `erase` de cet appareil (dans `write`, jamais dans `receive`). */
  async function noteLocalErases(batch) {
    for (const o of batch) {
      if (o.type !== 'erase' || o.dev !== dev || !created.has(o)) continue; // ni restauration ni transfert : seule une opération créée ici par op()
      const cur = locals.get(o.subject) || await store.getMeta(locKey(o.subject));
      const objs = [...new Set([...(cur?.objs || []), ...o.payload.objs])].sort();
      if (cur && canonical(cur.objs) === canonical(objs)) { locals.set(o.subject, cur); continue; }
      const m = { id: o.subject, objs, cancelled: !!cur?.cancelled, ...(cur?.resumed ? { resumed: true } : {}), ...(cur?.unproven ? { unproven: cur.unproven } : {}) };
      await store.setMeta(locKey(o.subject), m); locals.set(o.subject, m);
    }
  }

  /**
   * Écarte les annulations (`erase.cancel`, `erase.revoke`) qui prétendent venir de CET appareil sans être, À L'IDENTIQUE, dans
   * son journal local : le `dev` d'une opération reçue ou restaurée n'est qu'une déclaration. Retour : `{kept, rejected}`.
   * @param {any[]} list opérations déjà validées (`readOp`)
   */
  async function screenClaims(list) {
    if (!list.some((o) => isClaim(o) && o.dev === dev)) return { kept: list, rejected: [] };
    const have = new Map((await store.allOps()).map((r) => [r?.op, canonical(r)]));
    const rejected = list.filter((o) => isClaim(o) && o.dev === dev && have.get(o.op) !== canonical(o));
    if (!rejected.length) return { kept: list, rejected };
    const drop = new Set(rejected.map((o) => o.op));
    return { kept: list.filter((o) => !drop.has(o.op)), rejected };
  }
  /**
   * Écarte les `erase` qui portent le `dev` de CET appareil sans être, À L'IDENTIQUE, dans son journal (restauration) : une opération
   * ne peut être écrite ici que par `op()` ; le `dev` d'une sauvegarde n'est qu'une déclaration. Retour : `{kept, rejected}`.
   */
  async function screenOwnErases(list) {
    if (!list.some((o) => o.type === 'erase' && o.dev === dev)) return { kept: list, rejected: [] };
    const have = new Map((await store.allOps()).map((r) => [r?.op, canonical(r)]));
    const rejected = list.filter((o) => o.type === 'erase' && o.dev === dev && have.get(o.op) !== canonical(o));
    if (!rejected.length) return { kept: list, rejected };
    const drop = new Set(rejected.map((o) => o.op));
    return { kept: list.filter((o) => !drop.has(o.op)), rejected };
  }
  /** Trace durable des rejets (méta du magasin) ; la liste `status.usurped` est relue de là. */
  async function noteRejected(rejected) {
    for (const o of rejected) {
      if (rejs.has(o.op)) continue;
      const r = { id: o.op, op: o.op, type: o.type, subject: o.subject, at: now(), resumed: false };
      await store.setMeta(rejKey(o.op), r); rejs.set(o.op, r);
    }
    status.usurped = [...rejs.values()].sort((a, b) => a.at - b.at || (a.op < b.op ? -1 : 1)).map((r) => ({ op: r.op, type: r.type, subject: r.subject, at: r.at }));
    emit('operation-usurpee', { ops: rejected.map((o) => o.op) });
  }

  async function refresh() { d = derive(ops); hash = await viewHash(d.view); emit('change', { n: ops.length }); }

  /** Registre des destructions (08 §19.16, INV-09) : un objet détruit n'est jamais stocké de nouveau ; le refus est signalé. */
  async function refuseDetruits(objs) {
    if (!objs.length) return objs;
    const gone = new Set(await store.erasedIds?.() || []), kept = objs.filter((b) => !gone.has(b.id)), refused = objs.filter((b) => gone.has(b.id)).map((b) => b.id);
    if (refused.length) { status.erasedRefused = [...(status.erasedRefused || []), ...refused]; emit('objet-efface-refuse', { ids: refused }); }
    return kept;
  }

  /** Écrit des opérations ; en cas d'échec, tout reste dans le tampon et rien n'est perdu (08 §10.7). */
  async function write(newOps, objs = []) {
    objs = await refuseDetruits(objs);
    const batch = [...status.buffer, ...newOps], batchObjs = [...status.bufferObjs, ...objs];
    try {
      await noteLocalErases(batch);
      await store.appendOps(batch, batchObjs);
    } catch (e) {
      status.buffer = batch; status.bufferObjs = batchObjs; status.exported = false; status.lastError = { code: e.code || e.name || 'erreur', message: String(e.message || e) };
      emit('write-failed', { pending: batch.length, error: status.lastError });
      return false;
    }
    status.buffer = []; status.bufferObjs = []; status.exported = false; status.lastError = null;
    ops = ops.concat(batch.filter((o) => !ops.some((x) => x.op === o.op)));
    await refresh();
    onSaved?.(ops.length);
    channel?.postMessage({ type: 'ecrit', db: store.name, ids: batch.map((o) => o.op) });
    emit('saved', { ids: batch.map((o) => o.op) });
    return true;
  }

  function op(type, subject, payload, origin = 'v2') {
    if (status.readOnly) { const e = new Error('lecture seule : rechargez la page'); e.code = 'read-only'; throw e; }
    const o = makeOp({ type, subject, payload, dev, hlc: clock.tick(), t: now(), origin, tu: clock.frozen || undefined });
    created.add(o); return o;
  }

  /** Commande générique : une action = une opération, écrite dans une transaction. */
  async function record(type, subject, payload, { objs = [], origin } = {}) {
    const o = op(type, subject, payload, origin);
    const saved = await write([o], objs);
    return { op: o, saved };
  }

  // Coordination entre onglets (07 §17.9) : un onglet relit le magasin quand un autre a écrit.
  if (channel) channel.addEventListener('message', async (ev) => {
    const m = ev.data;
    if (!m || m.db !== store.name || store.closed) return;
    if (m.type === 'ecrit') { await load(); emit('change', { n: ops.length, from: 'onglet' }); }
    // Tampon confié par un onglet qui se ferme sans avoir pu écrire (C-13) : validé, puis écrit ici.
    if (m.type === 'tampon' && !status.readOnly && Array.isArray(m.ops) && Array.isArray(m.objs)) {
      try {
        const valid = m.ops.map(readOp), objs = [];
        for (const b of m.objs) if (await objectValid(b)) objs.push(b);
        await load(); // état du magasin à jour AVANT de décider ce qui est nouveau
        const fresh = valid.filter((o) => !ops.some((x) => x.op === o.op));
        // N° 5 : seules les opérations que l'onglet émetteur déclare avoir CRÉÉES lui-même par op() (`m.mine`) reçoivent la marque d'origine
        // locale ; le reste du tampon (restauration, transfert, reçu) est écrit sans marque. Canal de même origine (limite (e)).
        const mine = new Set(Array.isArray(m.mine) ? m.mine.filter((x) => typeof x === 'string') : []);
        for (const o of fresh) if (mine.has(o.op)) created.add(o);
        await write(fresh, objs);
      } catch { emit('handoff-refused', { n: m.ops.length }); }
    }
  });

  /** Opérations actives connues, d'une catégorie donnée. */
  const activeOps = (pred) => { const neu = new Set(d.neutralized); return d.sorted.filter((o) => !neu.has(o.op) && categoryOf(o.type) !== 'SYS' && pred(o)); };

  /** Coupure découpée en parties de MAX_CUT_OPS opérations au plus (08 §19.2). */
  async function cut(kind, ids, extra = {}) {
    if (!ids.length) return { cut: null, saved: true, parts: 0 };
    if (status.readOnly) { const e = new Error('lecture seule : rechargez la page'); e.code = 'read-only'; throw e; }
    await beforeRisky?.('avant-coupure'); // 08 §10.1 : copie vérifiée AVANT l'action ; un échec l'empêche
    const cutId = newId('ku', 'cut', now()), parts = Math.ceil(ids.length / MAX_CUT_OPS), list = [];
    for (let i = 0; i < parts; i++) list.push(op('cut', cutId, { kind, ops: ids.slice(i * MAX_CUT_OPS, (i + 1) * MAX_CUT_OPS).sort(), part: i + 1, parts, ...extra }));
    return { cut: cutId, saved: await write(list), parts };
  }

  return {
    account, dev,
    get name() { return store.name; },
    get ops() { return ops; },
    get view() { return d.view; },
    get derived() { return d; },
    get hash() { return hash; },
    get status() { return { ...status, buffer: status.buffer.length, bufferObjs: status.bufferObjs.length }; },
    started,
    clock,
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    record,
    write,
    /**
     * Opérations reçues d'un autre appareil (PH-2) ou d'un échange de test : validées, jamais mises en file.
     * ANO-016 : une annulation d'effacement (`erase.cancel`, `erase.revoke`) qui prétend venir de CET appareil (`dev` = le nôtre)
     * sans être déjà dans notre journal, À L'IDENTIQUE (identifiant ET contenu canonique), n'a pas pu être écrite ici : le `dev` d'une
     * opération reçue n'est qu'une déclaration (les règles du serveur n'inspectent ni `dev` ni le corps d'un lot). Elle est REJETÉE,
     * tracée durablement (`eff:rej:`, `status.usurped`, événement `operation-usurpee`) et jamais stockée. Défense en profondeur : la
     * décision d'envoi d'un texte effacé ne repose PAS sur ce rejet mais sur la marque d'origine locale (`eff:l:`). Retour : `{rejected}`.
     */
    async receive(list, objs = []) {
      const { kept, rejected } = await screenClaims(list.map(readOp));
      if (rejected.length) await noteRejected(rejected);
      objs = await refuseDetruits(objs); await store.appendOps(kept, objs, { queue: false }); await load(); emit('change', { n: ops.length, from: 'reception' });
      return { rejected: rejected.map((o) => o.op) };
    },
    screenClaims, screenOwnErases, noteRejected,
    /** Aucune nouvelle activité tant que le tampon n'est ni enregistré ni exporté (08 §10.7). */
    canStartActivity: () => !status.readOnly && (status.buffer.length === 0 || status.exported),
    async retry() { return status.buffer.length ? write([]) : true; },
    exportBuffer: () => JSON.stringify({ format: 'kotonoha2-tampon', version: 1, at: now(), dev, ops: status.buffer, objs: status.bufferObjs }),
    /** Marque l'export du tampon : la nouvelle activité redevient possible, le tampon reste en mémoire et en file. */
    bufferExported() { status.exported = true; },
    /** Confie le tampon aux autres onglets ouverts sur la même base (fermeture de page). Le tampon reste ici. */
    handOff() { if (!channel || !status.buffer.length) return false; channel.postMessage({ type: 'tampon', db: store.name, ops: status.buffer, objs: status.bufferObjs, mine: status.buffer.filter((o) => created.has(o)).map((o) => o.op) }); return true; },
    setReadOnly(reason) { status.readOnly = reason; emit('read-only', { reason }); },
    pendingCount: () => store.pendingCount(),
    reload: load,

    // Documents personnels (DC-6, FU-06, §19.1)
    newDocId: () => newId('ku', 'doc', now()),
    async revise(docId, text, parent = null) { const { obj, ref } = await makeObject(text, now()); return { ...(await record('doc.rev', docId, { obj: ref, parent }, { objs: [obj] })), obj: ref }; },
    trash: (docId) => record('trash', docId, {}),
    untrash: (docId, trashOps) => record('untrash', docId, { trash: trashOps }),
    /** Effacement définitif demandé : état E2 en local (masqué, rien n'est détruit). E3 et E4 relèvent de PH-2. */
    async erase(objIds) { if (status.readOnly) { const e = new Error('lecture seule : rechargez la page'); e.code = 'read-only'; throw e; } await beforeRisky?.('avant-effacement', { excludeObjs: objIds }); return record('erase', newId('ku', 'era', now()), { objs: objIds }); },
    /** Effacements en préparation (E2) créés sur cet appareil, annulables localement. */
    pendingErases: () => [...locals.values()].filter((l) => !l.cancelled && d.acc.eras.some((e) => e.id === l.id)).map((l) => ({ id: l.id, objs: [...l.objs], ...(l.unproven?.length ? { unproven: [...l.unproven] } : {}) })),
    /**
     * Effacements de cet appareil SUSPENDUS : une annulation prétendant venir d'ici a été rejetée (usurpation, ou annulation légitime
     * absente d'une base restaurée plus ancienne) ; le lot n'est ni figé ni envoyé tant que l'apprenant n'a pas tranché
     * (`cancelErase` ou `resumeErase`). Les textes restent masqués.
     */
    async suspendedErases() {
      const recs = new Set((await store.listMeta(EFF)).map((r) => r.id));
      return [...locals.values()].filter((l) => !l.cancelled && !recs.has(l.id) && !l.resumed && [...rejs.values()].some((r) => r.subject === l.id && !r.resumed && (r.type === 'erase.cancel' || r.type === 'erase.revoke'))).map((l) => l.id).sort();
    },
    /** L'apprenant reprend un effacement suspendu : les rejets qui le concernent ne le suspendent plus (rien n'est levé du masquage). */
    async resumeErase(eraseId) {
      const l = locals.get(eraseId); // mémorisé dans la marque : aucun rejet ultérieur sur ce sujet ne suspend plus (D4)
      if (l && !l.resumed) { const m = { ...l, resumed: true }; await store.setMeta(locKey(eraseId), m); locals.set(eraseId, m); }
      for (const r of [...rejs.values()].filter((x) => x.subject === eraseId && !x.resumed)) { const m = { ...r, resumed: true }; await store.setMeta(rejKey(r.op), m); rejs.set(r.op, m); }
    },
    /** Le serveur a confirmé `unerase/` (effacement.js) : la marque d'origine locale cesse de masquer. */
    async confirmCancelled(eraseId) {
      const l = locals.get(eraseId);
      if (l && !l.cancelled) { const m = { ...l, cancelled: true }; await store.setMeta(locKey(eraseId), m); locals.set(eraseId, m); }
    },
    /**
     * Annulation locale d'un effacement en préparation (E2 → E0, 08 §19.16 ; R5). Rien n'est supprimé :
     * l'annulation s'ajoute au journal, l'effacement y reste, et la copie « avant-effacement » est gardée.
     * Seul l'appareil auteur annule. PH-2 : dès que le lot peut exister sur le serveur (enregistrement
     * local `eff:e:<id>` à l'état engagé, définitif, ou envoi tenté sans réponse connue), la commande
     * REFUSE sans rien écrire (codes `erase-engage`, `erase-definitif`, `erase-incertain`) : l'annulation
     * en E3 passe par `unerase/` (effacement.js, `annuler`), jamais par le journal seul. La décision est prise
     * sous le verrou de la base, après relecture du magasin : deux onglets ne s'entrecroisent pas.
     * @param {string} eraseId
     */
    async cancelErase(eraseId) {
      const fail = (code, m) => { const e = new Error(m); e.code = code; throw e; };
      return exclusif(store, async () => {
        await load(); // autre onglet : annulation ou lot figé entre-temps
        const e = d.acc.eras.find((x) => x.id === eraseId); // lecture seule : refusée par op(), comme toute écriture
        const loc = locals.get(eraseId); // marque d'origine locale : seule preuve que CET appareil est l'auteur
        if (!e) fail('unknown-erase', `effacement inconnu : ${eraseId}`);
        if (loc ? loc.cancelled : e.cancelled) fail('already-cancelled', 'cet effacement est déjà annulé');
        if (!loc) fail('not-author', 'seul l’appareil qui a demandé l’effacement peut l’annuler ici');
        const rec = await store.getMeta(effKey(eraseId));
        const refus = refusAnnulationLocale(rec);
        if (refus) fail(refus.code, refus.message);
        const o = op('erase.cancel', eraseId, {}); // refusée en lecture seule, avant toute écriture
        const lifted = { ...loc, cancelled: true }; await store.setMeta(locKey(eraseId), lifted); locals.set(eraseId, lifted); // annulation LOCALE : la seule qui lève le masquage (avec `unerase/`)
        if (rec && (rec.status === 'fige' || rec.status === 'refuse')) await store.setMeta(effKey(eraseId), { ...rec, status: 'annule-local' }); // lot figé ou refusé, jamais accepté : abandonné (n° 6 : `refuse` aussi)
        return { op: o, saved: await write([o]) };
      });
    },
    async objects() { return store.allObjs(); },
    /** Alias V1 (D-64) : ajout seul, jamais de suppression. */
    addAliases: (list) => store.addAliases(list),
    aliases: () => store.allAliases(),

    // Coupures (FU-09, §8.3, §19.2)
    restart: () => cut('restart', activeOps((o) => categoryOf(o.type) === 'DC-2').map((o) => o.op)),
    backToDate: (since, cats = ['DC-2', 'DC-5']) => cut('date', activeOps((o) => cats.includes(categoryOf(o.type)) && o.t >= since).map((o) => o.op), { cats, since }),
    undoRestore: (ids) => cut('undo-restore', ids),
    uncut: (cutId) => record('uncut', cutId, {}),

    /** Instantané (cache) ; les cinq plus récents sont conservés. */
    async snapshot() {
      const s = await makeSnapshot(d, now());
      await store.putSnap(s);
      const old = (await store.listSnaps()).sort((a, b) => b.t - a.t).slice(SNAPS_KEPT);
      for (const x of old) await store.deleteSnap(x.id);
      return s;
    },
    store,
  };
}

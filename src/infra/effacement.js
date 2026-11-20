// KOTONOHA 2.0 · MOD-11b infra/effacement — client du cycle de vie d'un effacement : états E3 (en attente)
// et E4 (définitif), annulation par `unerase/`, destruction locale (08 §19.16 ; INV-09). Le fournisseur est
// derrière le même port `remote` que MOD-11 ; l'heure du serveur vient de `remote.serverTime()`, jamais de
// l'horloge de l'appareil (08 §7.4).
//
// Port distant ajouté (toutes les méthodes sont asynchrones ; une erreur porte `code`, comme en MOD-11) :
//   serverTime() → ms                          createEraseLot({id, objIds}) → {createdAt} ; création seule
//   getEraseLot(id) → {id, objIds, createdAt}|null        listEraseLots() → lots (tous, croissant)
//   createUnerase(id) → {createdAt}            listUnerase() → identifiants d'effacements annulés
//   createErased(objId, eraseId)               replaceErased(objId, eraseId)   (après annulation de l'ancien effacement)
//   getErased(objId) → {id, eraseId}|null      listErased() → marqueurs
//   deleteObj(objId)                           idempotent ; refusé par les règles avant T + M
//
// État local : un enregistrement par effacement, `eff:e:<eraseId>` dans la méta du magasin (voir effacement-etat.js).
// Il est écrit AVANT chaque étape qui quitte l'appareil : après une coupure, un rechargement ou une réponse
// perdue, la reprise rejoue l'étape sans rien perdre ni doubler (création seule, « existe déjà » relu).
//
// Décisions de conception (écarts et limites, voir v2/LISEZMOI.md §6) :
//  - l'opération `erase` du journal part avec les lots ordinaires, comme en PH-1 (et non après les marqueurs) :
//    les autres appareils masquent plus tôt, ce qui est plus prudent ; l'état fait foi côté serveur ;
//  - l'état d'un objet se lit par `etatObjet` / `masque` (journal + serveur), pas par la vue du journal seule :
//    une annulation faite par un autre appareil que l'auteur n'est pas une opération du journal ;
//  - lecture complète (et non incrémentale) des lots, annulations et marqueurs à chaque cycle.
import { exclusif } from './verrou.js';
import { D_MS, M_MS, EFF, effKey, ACTIFS, dateTerme, maskedFromStore, maskedByLocal, LOC, locKey, enAttenteDeConfirmation, leveLaMarque } from './effacement-etat.js';
import { purgeErasedBackups } from './backup.js';

const MISSING = 'sync:objets-manquants'; // même clé que MOD-11 : objets à récupérer à la prochaine réception
const typed = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

/**
 * @param {{journal: any, remote: any, now?: () => number, log?: (e: any) => void, halt?: (() => Promise<boolean>)|null}} o
 */
export function createErasure({ journal, remote, now = () => Date.now(), log = () => {}, halt = null }) {
  const store = journal.store;
  const anomalies = [];
  let state = 'local', lastError = null;
  const anomaly = (type, detail) => { const a = { type, at: now(), ...detail }; anomalies.push(a); log(a); };
  const vues = new Set(); // anomalies de lecture du serveur : une seule par lot et par motif, pas une à chaque refresh
  const anomalyOnce = (type, detail) => { const k = type + ':' + detail.lot; if (vues.has(k)) return; vues.add(k); anomaly(type, detail); };
  const getRec = (id) => store.getMeta(effKey(id));
  const putRec = async (rec) => { await store.setMeta(effKey(rec.id), rec); return rec; };
  const allRecs = () => store.listMeta(EFF);
  const termeOf = (rec) => rec.createdAt + D_MS;

  // ——— Étape 1 : figer les lots des effacements de CET appareil (E2 → lot figé) ———

  /** Un lot par effacement en préparation, identifiant et liste enregistrés AVANT tout envoi. Sous verrou. */
  async function freeze() {
    await journal.reload(); // une annulation faite par un autre onglet entre-temps est vue ici
    const masked = await maskedFromStore(store, undefined, { local: false }); // la marque d'origine locale de CET effacement ne doit pas le refuser lui-même
    const suspended = new Set(await journal.suspendedErases());
    let n = 0;
    // Effacements de cet appareil encore en préparation d'après la MARQUE D'ORIGINE LOCALE (`pendingErases`), jamais d'après les
    // annulations reçues : une annulation ou une révocation forgée n'annule rien ; une révocation légitime se heurte à `unerase/`
    // (lot refusé, annulation constatée par sendLot). Un effacement SUSPENDU (une annulation prétendant venir de cet appareil a été
    // rejetée : usurpation, ou annulation légitime absente d'une base plus ancienne) n'est pas figé : l'apprenant tranche.
    for (const p of journal.pendingErases()) {
      if (await getRec(p.id)) continue;
      if (suspended.has(p.id)) continue;
      // Un objet déjà masqué par un autre effacement actif n'entre pas dans un nouveau lot (08 §19.16).
      // Objets d'une marque d'avant le n° 4 dont aucune `erase` de cet appareil n'est prouvée locale (`unproven`) : jamais figés ni envoyés.
      const objs = p.objs.filter((id) => !masked.has(id) && !(p.unproven || []).includes(id)).sort();
      if (!objs.length && p.unproven?.length) continue; // rien de prouvé : les objets restent masqués par la marque
      if (!objs.length) { await putRec({ id: p.id, objs: [...p.objs].sort(), status: 'refuse', why: 'deja-efface', dev: journal.dev }); continue; }
      await putRec({ id: p.id, objs, status: 'fige', tentative: false, dev: journal.dev });
      n++;
    }
    return n;
  }

  // ——— Étape 2 : le lot (E2 → E3) ———

  async function sendLot(rec) {
    if (!rec.tentative) rec = await putRec({ ...rec, tentative: true }); // enregistré AVANT l'envoi : « envoyé, non confirmé »
    let createdAt;
    try { ({ createdAt } = await remote.createEraseLot({ id: rec.id, objIds: rec.objs })); } catch (e) {
      if (e.code === 'exists') { // réponse perdue, ou lot créé par un envoi précédent : relu, comparé, adopté
        const there = await remote.getEraseLot(rec.id);
        if (!there) throw typed('invalid', 'lot annoncé existant mais illisible');
        if (!sameSet(there.objIds, rec.objs)) { anomaly('lot-different', { lot: rec.id }); return putRec({ ...rec, status: 'refuse', why: 'lot-different' }); }
        createdAt = there.createdAt;
      } else if (e.code === 'denied') {
        if ((await remote.listUnerase()).includes(rec.id)) return annulerChezSoi(rec); // annulé ailleurs : le lot ne peut plus être créé
        return putRec({ ...rec, status: 'refuse', why: 'refuse-par-les-regles' });
      } else throw e;
    }
    return putRec({ ...rec, status: 'lot', createdAt });
  }

  // ——— Étape 3 : les marqueurs (tout appareil qui lit le lot les crée, tant qu'aucun `unerase/` n'existe) ———

  async function markers(rec) {
    const skipped = [], unerased = new Set(await remote.listUnerase());
    if (unerased.has(rec.id)) return annulerChezSoi(rec);
    for (const id of rec.objs) {
      try { await remote.createErased(id, rec.id); } catch (e) {
        if (e.code === 'exists') {
          const mk = await remote.getErased(id);
          if (mk?.eraseId === rec.id) continue; // déjà posé avec ce même effacement : pas une erreur
          if (mk && unerased.has(mk.eraseId)) { // ancien effacement annulé : seul remplacement permis
            try { await remote.replaceErased(id, rec.id); continue; } catch (e2) { if (e2.code !== 'denied') throw e2; }
          }
          skipped.push(id); // objet qui relève d'un autre effacement actif : sans effet ici
        } else if (e.code === 'denied') {
          if ((await remote.listUnerase()).includes(rec.id)) return annulerChezSoi(rec);
          throw e;
        } else throw e;
      }
    }
    return putRec({ ...rec, status: 'marques', skipped });
  }

  // ——— Annulation (E3 → E0) : `unerase/` accepté par le serveur, puis seulement le journal ———

  /** Effacement annulé côté serveur : retour en E0 ; l'auteur publie son annulation au journal ; les objets sont redemandés. */
  async function annulerChezSoi(rec) {
    // ANO-016 correctif n° 3 : un `unerase/` que CET appareil auteur n'a pas demandé (`requested`, écrit par `annuler`) peut venir d'un
    // tiers du compte : l'état devient `annule` + `distant`, SANS lever la marque locale, publier d'annulation ni redemander les
    // objets. Seule la confirmation de l'apprenant (`confirmerAnnulationDistante`) ou sa propre demande les libère.
    // N° 4 : de même un effacement au `dev` de CET appareil SANS marque (transfert, lot ou sauvegarde forgés) : à confirmer, jamais publié
    // ni renvoyé seul. La liste enregistrée vient de la marque locale (ou, à défaut, de l'opération `erase`), jamais de `rec.objs`.
    // Une demande d'avant le n° 3 (`wantUnerase` sans `requested`) est une demande de cet appareil.
    const loc = await store.getMeta(locKey(rec.id)), voulue = rec.requested || rec.wantUnerase;
    const propre = !loc && journal.derived.acc.eras.find((x) => x.id === rec.id && x.dev === journal.dev);
    if (!voulue && ((loc && !loc.cancelled) || propre)) {
      return putRec({ ...rec, status: 'annule', wantUnerase: false, distant: true, confirmed: false, objs: [...(loc ? loc.objs : propre.objs)].sort() });
    }
    rec = await putRec({ ...rec, status: 'annule', wantUnerase: false });
    await publierAnnulation(rec);
    await redemander(rec.objs);
    return rec;
  }

  /**
   * L'apprenant confirme sur CET appareil une annulation venue d'ailleurs (« Effacement annulé depuis un autre appareil : renvoyer
   * ces textes ? ») : la marque locale est levée, l'annulation publiée, les objets redemandés et renvoyés. Sans effet (null) si
   * aucune annulation à distance n'attend de confirmation pour cet effacement.
   */
  async function confirmerSousVerrou(eraseId) {
    let rec = await getRec(eraseId);
    if (!rec || !enAttenteDeConfirmation(rec)) return null;
    rec = await putRec({ ...rec, confirmed: true });
    await publierAnnulation(rec);
    await redemander(rec.objs);
    return rec;
  }
  const confirmerAnnulationDistante = (eraseId) => exclusif(store, () => confirmerSousVerrou(eraseId));

  /** Annulations constatées sur le serveur, non demandées ici, en attente de confirmation (pour une interface). */
  async function annulationsDistantes() {
    const out = [];
    for (const r of (await allRecs()).filter(enAttenteDeConfirmation)) { const loc = await store.getMeta(locKey(r.id)); out.push({ id: r.id, objs: [...r.objs], origineLocale: !!loc && !loc.cancelled }); }
    return out;
  }

  /** Annulation d'un effacement ÉTRANGER sans lot ni enregistrement local (D3) : `unerase/`, puis `erase.revoke` (ou `erase.cancel` si le `dev` est le nôtre sans marque). */
  async function annulerEtranger(era) {
    if (!remote) throw typed('hors-ligne', 'Annulation impossible sans connexion au serveur.');
    return exclusif(store, async () => {
      try { await remote.createUnerase(era.id); } catch (e) { if (e.code !== 'exists') throw e; }
      await annulerChezSoi({ id: era.id, objs: [...era.objs].sort(), status: 'fige', requested: true, foreign: true, dev: journal.dev });
      return { ok: true, eraseId: era.id };
    });
  }

  /**
   * L'annulation entre au journal APRÈS l'acceptation de `unerase/` par le serveur (08 §19.16) : `erase.cancel` pour l'appareil
   * auteur, `erase.revoke` pour tout autre appareil du compte (la vue du journal converge sans attendre l'auteur). Sans effet si
   * l'effacement n'est pas (ou plus) actif au journal ; reprenable : rejouée à chaque cycle pour les enregistrements `annule`.
   */
  async function publierAnnulation(rec) {
    if (enAttenteDeConfirmation(rec)) return; // annulation à distance non confirmée ici : rien n'est levé ni publié
    await journal.confirmCancelled(rec.id); // `unerase/` constaté : la marque d'origine locale cesse de masquer
    const era = journal.derived.acc.eras.find((x) => x.id === rec.id && !x.cancelled);
    if (era) await journal.record(era.dev === journal.dev ? 'erase.cancel' : 'erase.revoke', rec.id, {});
  }

  /**
   * Rattrapage : un enregistrement `annule` dont l'effacement reste actif au journal (coupure entre les deux écritures, opération
   * `erase` arrivée après l'annulation) est publié ; un `unerase/` que ce cycle n'a jamais vu sans lot ni enregistrement (annulé
   * avant l'envoi du lot, par un autre appareil) est inscrit et publié de la même façon.
   */
  async function rattraper(unerased) {
    const have = new Map((await allRecs()).map((r) => [r.id, r]));
    for (const era of journal.derived.acc.eras) {
      if (era.cancelled || have.has(era.id) || !unerased.has(era.id)) continue;
      const loc = await store.getMeta(locKey(era.id)); // effacement écrit ICI, `unerase/` non demandé ici : à confirmer (n° 3)
      const distant = (!!loc && !loc.cancelled) || (!loc && era.dev === journal.dev); // sans marque, un effacement à notre `dev` n'est pas prouvé nôtre (n° 4)
      have.set(era.id, await putRec({ id: era.id, objs: [...(loc && distant ? loc.objs : era.objs)].sort(), status: 'annule', wantUnerase: false, foreign: era.dev !== journal.dev, ...(distant ? { distant: true, confirmed: false } : {}) }));
    }
    for (const r of have.values()) if (r.status === 'annule') await publierAnnulation(r); // `publierAnnulation` ignore une annulation à distance non confirmée
  }

  /** Objets devenus visibles sans qu'aucune opération ne les référence de nouveau : à récupérer à la prochaine réception. */
  async function redemander(ids) {
    const want = new Set(ids), local = new Set((await journal.objects()).map((x) => x.id)), prev = (await store.getMeta(MISSING)) || [];
    const have = new Set(prev.map((r) => r.id)), add = [];
    for (const o of journal.derived.sorted) { const r = o.payload?.obj; if (r && want.has(r.id) && !local.has(r.id) && !have.has(r.id)) { add.push(r); have.add(r.id); } }
    if (add.length) await store.setMeta(MISSING, [...prev, ...add]);
  }

  async function doUnerase(rec) {
    try { await remote.createUnerase(rec.id); } catch (e) {
      if (e.code !== 'exists') {
        if (e.code === 'denied') { // le serveur refuse : le terme est-il passé ?
          const lot = await remote.getEraseLot(rec.id), t = await remote.serverTime();
          if (lot && t >= lot.createdAt + D_MS) {
            await putRec({ ...rec, status: 'definitif', createdAt: lot.createdAt, wantUnerase: false }); // la demande locale est supprimée
            throw typed('erase-definitif', `L’effacement est devenu définitif le ${dateTerme(lot.createdAt + D_MS)}. Il ne peut plus être annulé.`, { terme: lot.createdAt + D_MS });
          }
        }
        throw e; // coupure : la demande reste enregistrée (`wantUnerase`) et sera rejouée au cycle suivant
      }
    }
    return annulerChezSoi(rec);
  }

  /**
   * Annule un effacement, quel que soit son état. E2 (lot jamais envoyé) : annulation locale du journal.
   * E3 : `unerase/` ; accepté → E0, refusé après le terme → `erase-definitif` (« L'effacement est devenu définitif le … »).
   * E4 : refusé, `erase-definitif`. Une coupure laisse la demande enregistrée (`wantUnerase`) et lève l'erreur réseau.
   * @param {string} eraseId
   */
  async function annuler(eraseId) {
    const first = await getRec(eraseId);
    if (!first) { // effacement sans enregistrement : le nôtre (E2, annulation locale) ou ÉTRANGER (D3 : voie unerase/ + erase.revoke)
      await journal.reload();
      const era = journal.derived.acc.eras.find((x) => x.id === eraseId && !x.cancelled);
      if (era && !(await store.getMeta(locKey(eraseId)))) return annulerEtranger(era);
    }
    if (!first || (first.status === 'fige' && !first.tentative) || first.status === 'refuse' || first.status === 'annule-local') return journal.cancelErase(eraseId);
    if (!remote) throw typed('hors-ligne', 'Annulation impossible sans connexion au serveur : l’effacement est déjà engagé.');
    return exclusif(store, async () => {
      let rec = await getRec(eraseId);
      if (enAttenteDeConfirmation(rec)) { await putRec({ ...rec, requested: true }); const r = await confirmerSousVerrou(eraseId); return { ok: true, eraseId, confirmed: !!r }; }
      if (rec.status === 'annule') throw typed('already-cancelled', 'cet effacement est déjà annulé');
      if (rec.status === 'definitif' || rec.status === 'detruit') throw typed('erase-definitif', `L’effacement est devenu définitif le ${dateTerme(termeOf(rec))}. Il ne peut plus être annulé.`, { terme: termeOf(rec) });
      rec = await putRec({ ...rec, wantUnerase: true, requested: true }); // demande durable de CET appareil : seule elle autorise un `unerase/` à lever la marque
      await doUnerase(rec);
      return { ok: true, eraseId };
    });
  }

  // ——— Lecture du serveur : l'état se déduit des seuls documents du serveur ———

  /** Lots, annulations et heure du serveur. L'heure est lue AVANT les annulations (08 §19.16, « Heure du serveur »). */
  async function refresh() {
    const time = await remote.serverTime();
    const lots = await remote.listEraseLots(), unerased = new Set(await remote.listUnerase());
    const byId = new Map((await allRecs()).map((r) => [r.id, r]));
    for (const lot of lots) {
      let rec = byId.get(lot.id);
      if (!rec) { // lot inconnu du journal (autre appareil, ou jeton volé) : il fait autorité (08 §19.16)
        // N° 4 : sauf si cet appareil détient une marque d'origine locale pour cet identifiant et que le lot n'en porte pas EXACTEMENT les
        // objets (hors objets non prouvés) : lot forgé, non adopté (ni marqueurs ni destruction), signalé.
        const loc = await store.getMeta(locKey(lot.id));
        // Ordre (n° 5) : un effacement ANNULÉ localement (E2) n'adopte jamais un lot du serveur, même aux mêmes objets ; un effacement
        // SUSPENDU n'en adopte pas tant que l'apprenant n'a pas tranché (`resumeErase` ou annulation) : anomalie, ni marqueurs ni destruction.
        if (loc && loc.cancelled) { anomalyOnce('lot-annule-localement', { lot: lot.id }); continue; }
        if (loc && !sameSet(lot.objIds, loc.objs.filter((id) => !(loc.unproven || []).includes(id)))) { anomalyOnce('lot-different', { lot: lot.id }); continue; }
        if (loc && (await journal.suspendedErases()).includes(lot.id)) { anomalyOnce('lot-suspendu', { lot: lot.id }); continue; }
        rec = await putRec({ id: lot.id, objs: [...lot.objIds].sort(), status: 'lot', createdAt: lot.createdAt, foreign: true });
        byId.set(lot.id, rec);
      } else if (rec.status === 'fige' || rec.status === 'refuse') {
        // n° 6 : même règle que la branche précédente : un effacement annulé localement n'adopte jamais un lot du serveur.
        if ((await store.getMeta(locKey(lot.id)))?.cancelled) { anomalyOnce('lot-annule-localement', { lot: lot.id }); continue; }
        if (sameSet(lot.objIds, rec.objs)) rec = await putRec({ ...rec, status: 'lot', createdAt: lot.createdAt, why: undefined }); // lot créé, réponse perdue
        else { anomaly('lot-different', { lot: lot.id }); continue; }
        byId.set(lot.id, rec);
      }
    }
    for (const rec of byId.values()) {
      if (!ACTIFS.includes(rec.status)) continue;
      if (unerased.has(rec.id)) {
        if (rec.status === 'detruit') { anomaly('annule-apres-destruction', { lot: rec.id }); continue; } // impossible par les règles
        await annulerChezSoi(rec); continue;
      }
      if ((rec.status === 'lot' || rec.status === 'marques') && time >= termeOf(rec)) await putRec({ ...rec, status: 'definitif', wantUnerase: false }); // E4 : heure du serveur >= T
    }
    await rattraper(unerased);
    return time;
  }

  // ——— E4 : destruction, à partir de T + M, sur preuve de l'heure du serveur ———

  async function destroyOne(rec) {
    const t = await remote.serverTime(); // preuve : heure du serveur >= T + M ; l'horloge de l'appareil n'est jamais utilisée
    if (!(t >= termeOf(rec) + M_MS)) return false;
    if ((await remote.listUnerase()).includes(rec.id)) { await annulerChezSoi(rec); return false; } // relu AU DERNIER MOMENT
    // Un objet de la liste sans marqueur reçoit d'abord son marqueur ; les objets d'un autre effacement sont laissés à celui-ci.
    const mine = [];
    for (const id of rec.objs) {
      const mk = await remote.getErased(id);
      if (!mk) { await remote.createErased(id, rec.id); mine.push(id); } else if (mk.eraseId === rec.id) mine.push(id);
    }
    if (!rec.localDestroyed) {
      await store.destroyObjs(mine); // objets ET registre, dans une transaction
      await purgeErasedBackups(store, mine); // sauvegardes automatiques et copies de sécurité ; empreintes recalculées
      rec = await putRec({ ...rec, localDestroyed: true, destroyed: mine });
    }
    for (const id of rec.destroyed || mine) await remote.deleteObj(id); // idempotent
    await putRec({ ...rec, status: 'detruit' });
    return true;
  }

  async function destroy() {
    let n = 0;
    for (const rec of (await allRecs()).filter((r) => r.status === 'definitif')) if (await destroyOne(rec)) n++;
    return n;
  }

  // ——— Un cycle ———

  /** Un cycle complet : figer, lire le serveur, envoyer, marquer, annuler, détruire. Ne lève jamais : `state` dit ce qui se passe. */
  async function cycle() {
    if (!remote) { state = 'local'; return { state }; }
    return exclusif(store, async () => {
      try {
        if (halt && (await halt())) { state = 'suppression-compte'; return { state }; } // compte gelé (08 §19.11) : aucune écriture ne passerait
        await freeze();
        await refresh();
        for (const rec of await allRecs()) {
          let r = rec;
          if (r.status === 'fige' && r.wantUnerase) { await doUnerase(r); continue; }
          if (r.status === 'fige') r = await sendLot(r);
          if (r.status === 'lot') r = await markers(r);
          if ((r.status === 'lot' || r.status === 'marques') && r.wantUnerase) await doUnerase(r);
        }
        await refresh();
        const destroyed = await destroy();
        state = 'a-jour'; lastError = null;
        return { state, destroyed };
      } catch (e) {
        lastError = { code: e.code || 'erreur', message: String(e.message || e) };
        state = e.code === 'offline' ? 'hors-ligne' : e.code === 'auth' ? 'session-expiree' : e.code === 'erase-definitif' ? 'a-jour' : 'erreur';
        return { state, error: lastError };
      }
    });
  }

  // ——— Lecture de l'état (jamais l'horloge de l'appareil) ———

  /** État d'un effacement : phase E2, E3, E4 ou E0, et sous-état. */
  async function decrire(eraseId) {
    const rec = await getRec(eraseId);
    const era = journal.derived.acc.eras.find((x) => x.id === eraseId);
    if (!rec) return era ? { phase: era.cancelled ? 'E0' : 'E2', sub: era.cancelled ? 'annule' : 'prepare' } : { phase: 'E0', sub: 'inconnu' };
    const T = rec.createdAt ? termeOf(rec) : null;
    switch (rec.status) {
      case 'fige': return { phase: 'E2', sub: rec.tentative ? 'envoye-non-confirme' : 'fige' };
      case 'lot': return { phase: 'E3', sub: 'confirme', terme: T };
      case 'marques': return { phase: 'E3', sub: 'marque', terme: T };
      case 'definitif': return { phase: 'E4', sub: rec.localDestroyed ? 'detruit-localement' : 'confirme', terme: T };
      case 'detruit': return { phase: 'E4', sub: 'detruit', terme: T };
      case 'annule': if (enAttenteDeConfirmation(rec)) { const loc = await store.getMeta(locKey(rec.id)); return { phase: 'E2', sub: 'annule-a-distance', confirmationRequise: true, origineLocale: !!loc && !loc.cancelled }; } return { phase: 'E0', sub: 'annule' };
      case 'annule-local': return { phase: 'E0', sub: 'annule' };
      default: return { phase: 'E2', sub: 'refuse', why: rec.why };
    }
  }

  /** Objets masqués : journal (effacements actifs) et serveur (lots, y compris ceux qu'aucune opération n'annonce), moins les annulés. */
  async function masque() {
    const recs = new Map((await allRecs()).map((r) => [r.id, r])), out = new Set(await store.erasedIds?.() || []);
    for (const e of journal.derived.acc.eras) if (!e.cancelled && recs.get(e.id)?.status !== 'annule') for (const id of e.objs) out.add(id);
    for (const r of recs.values()) if (ACTIFS.includes(r.status)) for (const id of r.objs) out.add(id);
    for (const r of recs.values()) if (enAttenteDeConfirmation(r)) for (const id of r.objs) out.add(id); // annulation à distance non confirmée : masqué, avec ou sans marque locale (L20-14 F2)
    for (const id of await maskedByLocal(store, { recs: [...recs.values()] })) out.add(id); // marque d'origine locale : indépendante du journal
    return out;
  }

  /** État d'un objet : E0 (visible), E2, E3, E4. */
  async function etatObjet(objId) {
    if ((await store.erasedIds?.() || []).includes(objId)) return { phase: 'E4', sub: 'detruit' };
    const order = ['E0', 'E2', 'E3', 'E4'];
    let best = { phase: 'E0', sub: 'visible' };
    for (const rec of await allRecs()) if (rec.objs.includes(objId) && ACTIFS.includes(rec.status)) { const d = await decrire(rec.id); if (order.indexOf(d.phase) > order.indexOf(best.phase)) best = { ...d, eraseId: rec.id }; }
    if (best.phase === 'E0' && journal.derived.acc.eras.some((e) => !e.cancelled && e.objs.includes(objId))) {
      const e = journal.derived.acc.eras.find((x) => !x.cancelled && x.objs.includes(objId));
      if ((await getRec(e.id))?.status !== 'annule') best = { phase: 'E2', sub: 'prepare', eraseId: e.id };
    }
    if (best.phase === 'E0') for (const rec of await allRecs()) if (enAttenteDeConfirmation(rec) && rec.objs.includes(objId)) best = { phase: 'E2', sub: 'annule-a-distance', confirmationRequise: true, eraseId: rec.id };
    if (best.phase === 'E0') { // marque d'origine locale : un journal trompé ne rend pas l'objet visible
      const lifted = new Set((await allRecs()).filter(leveLaMarque).map((r) => r.id));
      const l = (await store.listMeta(LOC)).find((x) => !x.cancelled && !lifted.has(x.id) && x.objs.includes(objId));
      if (l) best = { phase: 'E2', sub: 'prepare', eraseId: l.id };
    }
    return best;
  }

  /**
   * « Effacer à nouveau » : objets d'un effacement ANNULÉ (ici, ailleurs, ou abandonné en préparation) qui peuvent être effacés de
   * nouveau, c'est-à-dire présents sur cet appareil, visibles (aucun effacement actif ni annulation non confirmée ne les masque) et
   * non détruits. Un effacement dont l'annulation distante n'est pas confirmée ici n'en donne aucun : la confirmation vient d'abord.
   */
  async function reeffacables(eraseId) {
    const rec = await getRec(eraseId);
    let objs;
    if (rec) { if (!['annule', 'annule-local'].includes(rec.status) || enAttenteDeConfirmation(rec)) return []; objs = rec.objs; }
    else { await journal.reload(); const era = journal.derived.acc.eras.find((x) => x.id === eraseId && x.cancelled); if (!era) return []; objs = era.objs; }
    const gone = new Set(await store.erasedIds?.() || []), mask = await masque(), here = new Set((await journal.objects()).map((o) => o.id));
    return [...new Set(objs)].filter((id) => here.has(id) && !mask.has(id) && !gone.has(id)).sort();
  }

  /** Efface de nouveau ces objets : une NOUVELLE opération `erase` (nouvel identifiant, nouveau délai) ; l'ancien effacement reste annulé. */
  async function reeffacer(eraseId) {
    const ids = await reeffacables(eraseId);
    if (!ids.length) throw typed('rien-a-effacer', 'Aucun texte de cet effacement ne peut être effacé de nouveau pour le moment : ils sont absents de cet appareil, déjà masqués ou déjà détruits.');
    return journal.erase(ids);
  }

  return {
    get state() { return state; },
    get lastError() { return lastError; },
    get anomalies() { return [...anomalies]; },
    cycle, annuler, reeffacables, reeffacer, decrire, masque, etatObjet, confirmerAnnulationDistante, annulationsDistantes,
    /** Étapes isolées, pour les tests de reprise et pour un appelant qui veut le détail. */
    steps: { freeze: () => exclusif(store, freeze), refresh, destroy },
  };
}

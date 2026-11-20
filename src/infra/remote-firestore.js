// KOTONOHA 2.0 · MOD-12 infra/remote-firestore — port distant de MOD-11 sur Firestore, par l'API REST,
// sans SDK (D-13, recommandation par défaut du registre 11 §7.1 ; D-92). Projet DÉDIÉ à la V2 (Q-36).
// Données : users/{uid}/lots/{lotId} (création seule, D-101) et users/{uid}/obj/{objId}.
// Points à confirmer sur le projet de test réel avant toute validation : V-REG-01 (création seule),
// V-REG-03 (horodatage serveur par `commit` + `REQUEST_TIME`), V-REG-04 (ordre de visibilité), et le
// code d'erreur exact renvoyé pour une création sur un document existant (traité ci-dessous des deux façons).

const API = 'https://firestore.googleapis.com/v1';
const AUTH_API = 'https://identitytoolkit.googleapis.com/v1';
const err = (code, message, extra) => Object.assign(new Error(message), { code, ...extra });

/** Valeurs Firestore ↔ JavaScript, pour les seuls types employés ici. */
const enc = (v) => (typeof v === 'string' ? { stringValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : Number.isSafeInteger(v) ? { integerValue: String(v) } : (() => { throw new Error(`valeur non prise en charge : ${typeof v}`); })());
const dec = (f) => ('stringValue' in f ? f.stringValue : 'integerValue' in f ? Number(f.integerValue) : 'timestampValue' in f ? Date.parse(f.timestampValue) : 'arrayValue' in f ? (f.arrayValue.values || []).map(dec) : undefined);
const fieldsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const fromDoc = (d) => { const o = {}; for (const [k, v] of Object.entries(d.fields || {})) o[k] = dec(v); o.id = decodeURIComponent(d.name.split('/').pop()); return o; };

/**
 * @param {{projectId: string, uid: string, getToken: () => Promise<string>, fetch?: typeof fetch, database?: string, apiKey?: string, authApi?: string}} o
 *   `apiKey` (clé d'API publique du projet) ouvre `supprimerCompteAuth` ; sans elle, cette méthode n'existe pas.
 */
export function firestoreRemote({ projectId, uid, getToken, fetch: f = globalThis.fetch.bind(globalThis), database = '(default)', apiKey = '', authApi = AUTH_API }) {
  if (!/^[a-z0-9-]{4,40}$/.test(projectId)) throw new Error('identifiant de projet invalide');
  if (!/^[A-Za-z0-9]{1,128}$/.test(uid)) throw new Error('identifiant de compte invalide');
  const db = `projects/${projectId}/databases/${database}`;
  const root = `${db}/documents/users/${uid}`;
  // Chemin d'URL (GET) : l'identifiant y est encodé. Nom de ressource dans le corps d'un `commit` : l'identifiant y est BRUT
  // (« lot:… »). L'encoder dans le corps crée un document dont l'identifiant contient « %3A » : les règles ne le reconnaissent
  // pas et la lecture par URL ne le retrouve pas (constaté sur l'émulateur, 2026-11-19).
  const docName = (coll, id) => `${root}/${coll}/${encodeURIComponent(id)}`;
  const resName = (coll, id) => `${root}/${coll}/${id}`;

  async function call(method, path, body) {
    let res;
    try {
      res = await f(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { if (e.code === 'auth') throw e; throw err('offline', 'réseau indisponible'); }
    if (res.status === 404) return null;
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const s = json.error?.status || '';
    if (res.status === 401 || s === 'UNAUTHENTICATED') throw err('auth', 'jeton refusé');
    if (s === 'ALREADY_EXISTS' || res.status === 409) throw err('exists', 'document déjà créé');
    if (res.status === 403 || s === 'PERMISSION_DENIED') throw err('denied', 'refusé par les règles', { status: s });
    if (res.status === 429 || res.status >= 500 || s === 'UNAVAILABLE' || s === 'RESOURCE_EXHAUSTED') throw err('offline', `service indisponible (${res.status})`);
    throw err('invalid', `requête refusée (${res.status} ${s})`, { status: s });
  }

  /** Création seule, horodatage posé par le serveur dans `stamp` (V-REG-03) : `receivedAt` pour lots et objets, `createdAt` pour le registre des effacements ; `null` : aucun. */
  async function create(coll, id, data, stamp = 'receivedAt') {
    const name = resName(coll, id);
    const body = { writes: [{ update: { name, fields: fieldsOf(data) }, ...(stamp ? { updateTransforms: [{ fieldPath: stamp, setToServerValue: 'REQUEST_TIME' }] } : {}), currentDocument: { exists: false } }] };
    try {
      const r = await call('POST', `${db}/documents:commit`, body);
      const ts = r?.writeResults?.[0]?.transformResults?.[0]?.timestampValue;
      return { [stamp || 'receivedAt']: ts ? Date.parse(ts) : null };
    } catch (e) {
      // Sur un document existant, les règles (create refusé, update refusé) peuvent répondre « refusé »
      // plutôt que « existe déjà » : on lève l'ambiguïté par une lecture.
      if (e.code === 'denied' && (await get(coll, id))) throw err('exists', 'document déjà créé');
      throw e;
    }
  }
  async function get(coll, id) { const d = await call('GET', docName(coll, id)); return d ? fromDoc(d) : null; }

  /** Création seule d'un document hors du compte (`deletion/{uid}`), horodatage serveur. */
  async function createAt(parent, id, data, stamp) {
    const name = `${parent}/${id}`, url = `${parent}/${encodeURIComponent(id)}`;
    try {
      const r = await call('POST', `${db}/documents:commit`, { writes: [{ update: { name, fields: fieldsOf(data) }, updateTransforms: [{ fieldPath: stamp, setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }] });
      const ts = r?.writeResults?.[0]?.transformResults?.[0]?.timestampValue;
      return { [stamp]: ts ? Date.parse(ts) : null };
    } catch (e) {
      if (e.code === 'denied' && (await call('GET', url))) throw err('exists', 'document déjà créé');
      throw e;
    }
  }

  /** Liste complète d'une collection du compte, par pages. */
  async function listAll(coll, sortField) {
    const out = [];
    let token = '';
    do {
      const r = await call('GET', `${root}/${coll}?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      for (const d of r?.documents || []) out.push(fromDoc(d));
      token = r?.nextPageToken || '';
    } while (token);
    return out.sort((a, b) => (sortField ? a[sortField] - b[sortField] : 0) || (a.id < b.id ? -1 : 1));
  }

  /**
   * Suppression du compte d'authentification : `accounts:delete` avec le jeton d'identité courant (V-AUTH-02 : le service peut
   * exiger une connexion récente, `CREDENTIAL_TOO_OLD_LOGIN_AGAIN` → code `reauth`). Un compte déjà supprimé (`USER_NOT_FOUND`)
   * est un succès (`deja: true`) : la reprise après une réponse perdue ne bloque pas. NON VÉRIFIÉ sur le service réel.
   */
  async function supprimerCompteAuth() {
    let res;
    try {
      const idToken = await getToken();
      res = await f(`${authApi}/accounts:delete?key=${encodeURIComponent(apiKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
    } catch (e) { if (e.code === 'auth') throw e; throw err('offline', 'réseau indisponible'); }
    if (res.ok) return { deja: false };
    const j = await res.json().catch(() => ({})), raw = String(j.error?.message || '').split(' ')[0].split(':')[0];
    if (raw === 'USER_NOT_FOUND') return { deja: true };
    if (raw === 'CREDENTIAL_TOO_OLD_LOGIN_AGAIN') throw err('reauth', 'connexion récente requise');
    if (raw === 'INVALID_ID_TOKEN' || raw === 'TOKEN_EXPIRED' || res.status === 401) throw err('auth', 'jeton refusé');
    if (res.status === 429 || res.status >= 500) throw err('offline', `service indisponible (${res.status})`);
    throw err('invalid', `requête refusée (${res.status} ${raw})`);
  }

  return {
    kind: 'firestore-rest',
    ...(apiKey ? { supprimerCompteAuth } : {}),
    createLot: ({ id, dev, schema, n, sha256, body }) => create('lots', id, { dev, schema, n, sha256, body }),
    getLot: (id) => get('lots', id),
    async listLots({ since }) {
      const out = [];
      let after = null;
      for (;;) {
        const q = { structuredQuery: { from: [{ collectionId: 'lots' }], where: { fieldFilter: { field: { fieldPath: 'receivedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: new Date(since).toISOString() } } }, orderBy: [{ field: { fieldPath: 'receivedAt' }, direction: 'ASCENDING' }, { field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 300 } };
        if (after) q.structuredQuery.startAt = { values: [{ timestampValue: after.ts }, { referenceValue: after.name }], before: false };
        const rows = ((await call('POST', `${root}:runQuery`, q)) || []).filter((r) => r.document);
        for (const r of rows) out.push(fromDoc(r.document));
        if (rows.length < 300) return out;
        const last = rows[rows.length - 1].document;
        after = { ts: last.fields.receivedAt.timestampValue, name: last.name };
      }
    },
    async listLotIds() {
      const ids = [];
      let token = '';
      do {
        const r = await call('GET', `${root}/lots?pageSize=300&mask.fieldPaths=n${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
        for (const d of r?.documents || []) ids.push(decodeURIComponent(d.name.split('/').pop()));
        token = r?.nextPageToken || '';
      } while (token);
      return ids.sort();
    },
    createObj: ({ id, salt, content, h }) => create('obj', id, { salt, content, h }),
    getObj: (id) => get('obj', id),

    // ——— Cycle de vie d'un effacement (08 §19.16) : erase-lot/, erased/, unerase/. NON VÉRIFIÉ sur le projet réel. ———
    /** Heure du serveur : `readTime` d'une requête (V-REG-07 : à confirmer). Jamais l'horloge de l'appareil. */
    async serverTime() {
      const rows = (await call('POST', `${root}:runQuery`, { structuredQuery: { from: [{ collectionId: 'unerase' }], limit: 1 } })) || [];
      const rt = rows.map((r) => r.readTime).find(Boolean);
      if (!rt) throw err('invalid', 'heure du serveur absente de la réponse');
      return Date.parse(rt);
    },
    createEraseLot: ({ id, objIds }) => create('erase-lot', id, { objIds }, 'createdAt'),
    getEraseLot: (id) => get('erase-lot', id),
    async listEraseLots() { return listAll('erase-lot', 'createdAt'); },
    createUnerase: (id) => create('unerase', id, {}, 'createdAt'),
    async listUnerase() { return (await listAll('unerase', 'createdAt')).map((d) => d.id).sort(); },
    createErased: async (objId, eraseId) => { await create('erased', objId, { eraseId }, null); return {}; },
    /** Seule modification permise du registre : nouvel `eraseId` après l'annulation de l'ancien. */
    async replaceErased(objId, eraseId) {
      await call('POST', `${db}/documents:commit`, { writes: [{ update: { name: resName('erased', objId), fields: fieldsOf({ eraseId }) }, updateMask: { fieldPaths: ['eraseId'] }, currentDocument: { exists: true } }] });
      return {};
    },
    getErased: (id) => get('erased', id),
    async listErased() { return listAll('erased', null); },
    // ——— Suppression différée du compte (08 §19.11) : deletion/{uid}, puis suppressions à partir de T + M. NON VÉRIFIÉ. ———
    async createDeletion() { const r = await createAt(`${db}/documents/deletion`, uid, {}, 'requestedAt'); return r; },
    async getDeletion() { const d = await call('GET', `${db}/documents/deletion/${uid}`); return d ? fromDoc(d) : null; },
    async deleteDeletion() { await call('POST', `${db}/documents:commit`, { writes: [{ delete: `${db}/documents/deletion/${uid}` }] }); return {}; },
    async listDocIds(coll) { return (await listAll(coll, null)).map((d) => d.id).sort(); },
    async purgeDelete(coll, id) { await call('POST', `${db}/documents:commit`, { writes: [{ delete: resName(coll, id) }] }); return {}; },
    /** Suppression idempotente ; refusée par les règles avant T + M (renvoie `denied`). */
    async deleteObj(id) { await call('POST', `${db}/documents:commit`, { writes: [{ delete: resName('obj', id) }] }); return {}; },
  };
}

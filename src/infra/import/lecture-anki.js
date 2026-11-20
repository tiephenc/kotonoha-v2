// KOTONOHA 2.0 · infra/import/lecture-anki — lecture seule de la base extraite (sql.js), résumé vérifiable.
// Script classique (Worker ou Node), après zip-flux.js. Expose `self.KAnki`.
// Aucune écriture : la base vit dans le système de fichiers en mémoire de sql.js le temps de la lecture, puis est fermée.
(function (g) {
  'use strict';
  const ImportError = g.KZip && g.KZip.ImportError;
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');

  /**
   * Ouvre la base (copie dans MEMFS par sql.js), lit le schéma, les notes, les cartes et les GUID, puis la ferme.
   * @param {any} SQL module sql.js initialisé @param {Uint8Array} octets base SQLite décompressée
   * @returns {Promise<{ver: number, notes: number, cartes: number, guidsDistincts: number, empreinteGuids: string}>}
   */
  async function resumer(SQL, octets) {
    let db = null;
    try {
      db = new SQL.Database(octets);
      const q = (s) => { const r = db.exec(s); return r.length ? r[0].values : []; };
      const ver = q('SELECT ver FROM col')[0][0];
      const notes = q('SELECT count(*) FROM notes')[0][0], cartes = q('SELECT count(*) FROM cards')[0][0];
      const guids = q('SELECT guid FROM notes ORDER BY guid').map((v) => String(v[0]));
      const distincts = new Set(guids).size;
      const empreinte = hex(await g.crypto.subtle.digest('SHA-256', new TextEncoder().encode(guids.join('\n'))));
      return { ver, notes, cartes, guidsDistincts: distincts, empreinteGuids: empreinte };
    } catch (x) {
      if (ImportError && x instanceof ImportError) throw x;
      throw new ImportError('base-invalide', `base illisible : ${(x && x.message) || x}`);
    } finally {
      if (db) db.close();
    }
  }
  // ——— Lecture complète (import réel) : notes, cartes, historique, modèles et paquets, valeurs BRUTES ———
  // Aucun identifiant n'est créé ni recalculé : `nid`, GUID, `cards.id`, `did`, `mid` et identifiants de révision sont rendus tels quels.

  /** Protobuf minimal : champs de type chaîne (longueur délimitée) d'un message, par numéro. Ne lève jamais d'exception. */
  function protoChaines(octets) {
    const out = {}; if (!octets || !octets.length) return out;
    const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    let i = 0;
    const varint = () => { let r = 0, m = 1; for (let k = 0; k < 10 && i < b.length; k++) { const x = b[i++]; r += (x & 0x7f) * m; if (!(x & 0x80)) return r; m *= 128; } throw new Error('varint'); };
    try {
      while (i < b.length) {
        const tag = varint(), num = Math.floor(tag / 8), wt = tag % 8;
        if (wt === 0) varint(); else if (wt === 1) i += 8; else if (wt === 5) i += 4;
        else if (wt === 2) { const n = varint(); if (i + n > b.length) break; if (!(num in out)) out[num] = new TextDecoder().decode(b.subarray(i, i + n)); i += n; } else break;
      }
    } catch { /* message tronqué : on garde ce qui a été lu */ }
    return out;
  }

  /**
   * @param {any} SQL module sql.js initialisé @param {Uint8Array} octets base SQLite décompressée
   * @returns {{schema: number, crt: number|null, modeles: any[], paquets: any[], notes: any[], cartes: any[], revisions: any[]}}
   */
  function extraire(SQL, octets) {
    let db = null;
    try {
      db = new SQL.Database(octets);
      const q = (s) => { const r = db.exec(s); return r.length ? r[0].values : []; };
      const tables = new Set(q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r[0]));
      for (const t of ['col', 'notes', 'cards']) if (!tables.has(t)) throw new ImportError('base-invalide', `table ${t} absente : ce n’est pas une collection Anki`);
      const colonnes = (t) => new Set(q(`PRAGMA table_info(${t})`).map((r) => r[1]));
      // Seules les colonnes présentes sont lues ; une colonne absente vaut null (paquets anciens ou minimaux).
      const lire = (t, noms) => { const c = colonnes(t), pris = noms.filter((n) => c.has(n)); if (!pris.length) return []; return q(`SELECT ${pris.join(',')} FROM ${t} ORDER BY ${pris[0]}`).map((v) => { const o = {}; noms.forEach((n) => { o[n] = null; }); pris.forEach((n, k) => { o[n] = v[k]; }); return o; }); };
      const col = lire('col', ['ver', 'crt', 'mod', 'models', 'decks'])[0] || {};
      const schema = Number(col.ver) || 0;
      // Modèles de notes : tables `notetypes`, `fields`, `templates` (schéma récent), sinon JSON de `col.models` (schéma 11).
      let modeles = [], paquets = [];
      if (tables.has('notetypes')) {
        const champs = tables.has('fields') ? q('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord') : [];
        const gab = tables.has('templates') ? q('SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord') : [];
        modeles = q('SELECT id, name FROM notetypes ORDER BY id').map(([id, nom]) => ({
          id, nom: String(nom),
          champs: champs.filter((c) => c[0] === id).map((c) => String(c[2])),
          gabarits: gab.filter((t) => t[0] === id).map((t) => { const p = protoChaines(t[3]); return { ord: t[1], nom: String(t[2]), recto: p[1] ?? '', verso: p[2] ?? '' }; }),
        }));
      } else if (col.models) {
        try {
          modeles = Object.values(JSON.parse(col.models)).map((m) => ({ id: Number(m.id), nom: String(m.name ?? ''), champs: [...(m.flds || [])].sort((a, b) => a.ord - b.ord).map((f) => String(f.name)), gabarits: (m.tmpls || []).map((t) => ({ ord: t.ord, nom: String(t.name ?? ''), recto: String(t.qfmt ?? ''), verso: String(t.afmt ?? '') })) })).sort((a, b) => a.id - b.id);
        } catch { modeles = []; }
      }
      if (tables.has('decks')) paquets = q('SELECT id, name FROM decks ORDER BY id').map(([id, nom]) => ({ id, nom: String(nom).split('\x1f').join('::') }));
      else if (col.decks) { try { paquets = Object.values(JSON.parse(col.decks)).map((d) => ({ id: Number(d.id), nom: String(d.name ?? '') })).sort((a, b) => a.id - b.id); } catch { paquets = []; } }
      const notes = lire('notes', ['id', 'guid', 'mid', 'mod', 'tags', 'flds']).map((n) => ({ id: n.id, guid: String(n.guid), mid: n.mid, mod: n.mod, tags: String(n.tags ?? '').trim(), champs: String(n.flds ?? '').split('\x1f') }));
      const cartes = lire('cards', ['id', 'nid', 'did', 'ord', 'mod', 'type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'odue', 'odid', 'flags', 'data']);
      const revisions = tables.has('revlog') ? lire('revlog', ['id', 'cid', 'ease', 'ivl', 'lastIvl', 'factor', 'time', 'type']) : [];
      return { schema, crt: col.crt == null ? null : Number(col.crt), modeles, paquets, notes, cartes, revisions };
    } catch (x) {
      if (ImportError && x instanceof ImportError) throw x;
      throw new ImportError('base-invalide', `base illisible : ${(x && x.message) || x}`);
    } finally {
      if (db) db.close();
    }
  }

  g.KAnki = Object.freeze({ resumer, extraire, protoChaines });
})(typeof self !== 'undefined' ? self : globalThis);

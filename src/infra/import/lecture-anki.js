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
  g.KAnki = Object.freeze({ resumer });
})(typeof self !== 'undefined' ? self : globalThis);

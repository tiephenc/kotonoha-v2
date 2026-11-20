// KOTONOHA 2.0 · infra/import/zip-flux — extraction en flux de la base d'un paquet Anki (.apkg, .colpkg).
// Script classique sans import ni export : chargé par importScripts() dans un Worker (après ../../../vendor/fzstd.js),
// ou importé par Node pour les tests. Expose `self.KZip`.
//
// Deux plafonds (unités : Mo DÉCIMAL, 1 Mo = 1 000 000 octets ; jamais des Mio) :
// - P1 : taille du fichier, contrôlée sur `blob.size` AVANT toute lecture ;
// - P2 : octets décompressés de la base, comptés PENDANT la décompression, sur la taille réelle ; arrêt dès le
//   dépassement. Les tailles annoncées (ZIP, en-tête zstd) ne servent qu'à localiser les données et à dimensionner
//   le tampon : elles ne sont jamais crues pour accepter (08 §19.15).
//
// Choix de la base, par nom uniquement (jamais par taille ni par contenu) : collection.anki21b (SQLite compressé en
// zstd, Anki ≥ 2.1.50), sinon collection.anki21, sinon collection.anki2. Les exports anki21b contiennent aussi un
// collection.anki2 factice (« mettez Anki à jour », 51 200 octets dans les paquets réels) : il est ignoré et signalé
// (`factice: true`). Un collection.anki2 seul, même très petit, est un paquet ancien valide. Si la base choisie est
// illisible, l'extraction échoue : elle ne se rabat jamais sur la base factice.
(function (g) {
  'use strict';
  const MO = 1e6; // Mo décimal
  const KIO = 1024;
  class ImportError extends Error { constructor(code, message) { super(message); this.name = 'ImportError'; this.code = code; } }
  const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const bytes = async (blob, a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer());
  const mo = (n) => (n / MO).toFixed(1);

  let CRC = null;
  function crc32(c, d) {
    if (!CRC) { CRC = new Int32Array(256); for (let n = 0; n < 256; n++) { let x = n; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; CRC[n] = x; } }
    c = ~c;
    for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  }

  /** Répertoire central : entrées {nom, flags, methode, crc, csize, usize, local}. */
  async function entries(blob) {
    const n = Math.min(blob.size, 22 + 65535), tail = await bytes(blob, blob.size - n, blob.size);
    let e = -1; for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new ImportError('zip-invalide', 'fin de répertoire ZIP introuvable (archive invalide ou tronquée)');
    const count = u16(tail, e + 10), size = u32(tail, e + 12), off = u32(tail, e + 16);
    if (count === 0xffff || off === 0xffffffff || size === 0xffffffff) throw new ImportError('zip64', 'ZIP64 non pris en charge');
    if (off + size > blob.size) throw new ImportError('zip-invalide', 'répertoire central hors du fichier');
    const cd = await bytes(blob, off, off + size), out = []; let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new ImportError('zip-invalide', 'entrée du répertoire central invalide');
      const flags = u16(cd, p + 8), methode = u16(cd, p + 10), crc = u32(cd, p + 16), csize = u32(cd, p + 20), usize = u32(cd, p + 24);
      const ln = u16(cd, p + 28), lx = u16(cd, p + 30), lc = u16(cd, p + 32), local = u32(cd, p + 42);
      if (p + 46 + ln > cd.length) throw new ImportError('zip-invalide', 'nom d’entrée hors du répertoire central');
      out.push({ nom: new TextDecoder().decode(cd.subarray(p + 46, p + 46 + ln)), flags, methode, crc, csize, usize, local });
      p += 46 + ln + lx + lc;
    }
    return out;
  }

  const BASES = ['collection.anki21b', 'collection.anki21', 'collection.anki2'];
  /** Choix de la base : anki21b, puis anki21, puis anki2 (par nom). Une base en double est refusée (ambiguïté). */
  function choose(list) {
    for (const n of BASES) if (list.filter((x) => x.nom === n).length > 1) throw new ImportError('zip-invalide', `entrée ${n} en double`);
    const present = BASES.filter((n) => list.some((x) => x.nom === n));
    if (!present.length) throw new ImportError('sans-collection', 'aucune base collection.anki21b, collection.anki21 ou collection.anki2 dans le paquet');
    const e = list.find((x) => x.nom === present[0]);
    return { e, ignorees: present.slice(1), factice: present[0] !== 'collection.anki2' && present.includes('collection.anki2') };
  }

  /**
   * Garde zstd : parcourt les octets compressés AVANT qu'ils soient confiés à fzstd et vérifie chaque en-tête de
   * trame. fzstd alloue sa fenêtre d'après l'en-tête (jusqu'à 2 046 Mo) avant de produire le moindre octet : une
   * fenêtre ou une taille de contenu annoncée au-delà de P2 est refusée ici, sans allocation. Suit aussi les blocs
   * (3 octets d'en-tête, 128 Kio au plus) pour retrouver la trame suivante, et les trames ignorables.
   */
  function zstdGuard(p2) {
    // etat : 'entete' (en-tête de trame), 'bloc' (en-tête de bloc), 'saut' (octets à passer, puis `apres`).
    let etat = 'entete', acc = [], saut = 0, apres = null, somme = false, trames = 0, fcs0 = null;
    const fin = () => {
      const a = apres; apres = null;
      if (a === 'bloc') etat = 'bloc';
      else if (a === 'dernier') { if (somme) { etat = 'saut'; saut = 4; apres = 'trame'; } else { trames++; etat = 'entete'; } }
      else if (a === 'trame') { trames++; etat = 'entete'; }
      else etat = 'entete'; // fin d'une trame ignorable
    };
    function octet(x) {
      acc.push(x);
      if (etat === 'entete') {
        if (acc.length < 5) return;
        const magic = u32(acc, 0);
        if (magic === 0xfd2fb528) {
          const fhd = acc[4], ss = (fhd >> 5) & 1, dict = fhd & 3, fcsf = fhd >> 6;
          if (fhd & 8) throw new ImportError('decompression', 'en-tête zstd invalide (bit réservé)');
          const fl = fcsf === 0 ? (ss ? 1 : 0) : [1, 2, 4, 8][fcsf], hl = 5 + (ss ? 0 : 1) + [0, 1, 2, 4][dict] + fl;
          if (acc.length < hl) return;
          if (dict) throw new ImportError('zstd', 'dictionnaire zstd non pris en charge');
          let fcs = null;
          if (fl) { fcs = 0; const o = hl - fl; for (let k = 0; k < fl; k++) fcs += acc[o + k] * 2 ** (8 * k); if (fl === 2) fcs += 256; }
          let fen = fcs;
          if (!ss) { const wd = acc[5], b = 2 ** (10 + (wd >> 3)); fen = b + (b / 8) * (wd & 7); }
          if (fcs !== null && fcs > p2) throw new ImportError('P2', `taille zstd annoncée (${mo(fcs)} Mo) au-delà de P2 (${p2 / MO} Mo)`);
          if (fen > p2) throw new ImportError('P2', `fenêtre zstd annoncée (${mo(fen)} Mo) au-delà de P2 (${p2 / MO} Mo)`);
          if (trames === 0 && fcs0 === null) fcs0 = fcs;
          somme = !!((fhd >> 2) & 1); etat = 'bloc'; acc = [];
        } else if ((magic & 0xfffffff0) === 0x184d2a50) {
          if (acc.length < 8) return;
          saut = u32(acc, 4); apres = 'ignorable'; etat = 'saut'; acc = []; if (!saut) fin();
        } else throw new ImportError('decompression', 'données zstd invalides (nombre magique)');
      } else if (etat === 'bloc') {
        if (acc.length < 3) return;
        const b = acc[0] | (acc[1] << 8) | (acc[2] << 16), dernier = b & 1, type = (b >> 1) & 3, taille = b >>> 3;
        acc = [];
        if (type === 3) throw new ImportError('decompression', 'bloc zstd de type réservé');
        if (taille > 128 * KIO) throw new ImportError('decompression', 'bloc zstd trop grand');
        saut = type === 1 ? 1 : taille; apres = dernier ? 'dernier' : 'bloc'; etat = 'saut';
        if (!saut) fin();
      }
    }
    return {
      scan(d) {
        let i = 0;
        while (i < d.length) {
          if (etat === 'saut') { const k = Math.min(saut, d.length - i); saut -= k; i += k; if (!saut) fin(); continue; }
          octet(d[i++]);
        }
      },
      finish() { if (etat !== 'entete' || acc.length || !trames) throw new ImportError('decompression', 'données zstd tronquées'); },
      get trames() { return trames; },
      get fcs() { return fcs0; },
    };
  }

  /**
   * @param {Blob} blob
   * @param {{p1: number, p2: number, onProgress?: (n: number) => void, signal?: AbortSignal}} o
   * @returns {Promise<{nom: string, octets: Uint8Array, lus: number, brut: number, compression: string, ignorees: string[],
   *   factice: boolean, capacite: number, copies: number, octetsCopies: number, tramesZstd: number}>}
   */
  async function extract(blob, { p1, p2, onProgress, signal } = {}) {
    if (!(p1 > 0 && p2 > 0)) throw new ImportError('plafonds', 'plafonds invalides');
    if (blob.size > p1) throw new ImportError('P1', `fichier de ${mo(blob.size)} Mo, au-delà de P1 (${p1 / MO} Mo)`);
    const annule = () => { if (signal && signal.aborted) throw new ImportError('annule', 'import annulé'); };
    annule();
    const { e, ignorees, factice } = choose(await entries(blob));
    const zstd = e.nom === 'collection.anki21b';
    if (e.flags & 1) throw new ImportError('chiffre', 'entrée chiffrée');
    if (e.methode !== 0 && e.methode !== 8) throw new ImportError('methode', `méthode de compression ${e.methode} non prise en charge`);
    const Z = g.fzstd;
    if (zstd && !(Z && typeof Z.Decompress === 'function')) throw new ImportError('zstd', 'décompresseur zstd (fzstd) indisponible');
    const lh = await bytes(blob, e.local, e.local + 30);
    if (lh.length < 30 || u32(lh, 0) !== 0x04034b50) throw new ImportError('zip-invalide', 'en-tête local invalide');
    const start = e.local + 30 + u16(lh, 26) + u16(lh, 28), end = start + e.csize;
    if (end > blob.size) throw new ImportError('zip-invalide', 'données hors du fichier (archive tronquée)');
    const nomLocal = new TextDecoder().decode(await bytes(blob, e.local + 30, e.local + 30 + u16(lh, 26)));
    if (nomLocal !== e.nom) throw new ImportError('zip-invalide', 'nom d’entrée local différent du répertoire central');

    // Tampon unique, borné par P2. Capacité initiale : indice (taille annoncée bornée par ce que le fichier peut
    // réellement contenir), jamais au-delà de P2 ; agrandi par doublement si besoin, jamais au-delà de P2.
    let buf = null, n = 0, copies = 0, octetsCopies = 0;
    const indice = zstd ? 4 * e.csize : e.methode === 0 ? e.csize : Math.min(e.usize, 1032 * e.csize);
    const ajoute = (v) => {
      if (n + v.length > p2) throw new ImportError('P2', `base décompressée au-delà de P2 (${p2 / MO} Mo) : arrêt à ${mo(n + v.length)} Mo`);
      if (!buf) buf = new Uint8Array(Math.min(p2, Math.max(64 * KIO, indice, v.length)));
      if (n + v.length > buf.length) {
        const b = new Uint8Array(Math.min(p2, Math.max(buf.length * 2, n + v.length)));
        b.set(buf.subarray(0, n)); copies++; octetsCopies += n; buf = b;
      }
      buf.set(v, n); n += v.length; if (onProgress) onProgress(n);
    };

    let src = blob.slice(start, end).stream();
    if (e.methode === 8) src = src.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = src.getReader();
    let crc = 0, brut = 0, garde = null, dz = null;
    if (zstd) { garde = zstdGuard(p2); dz = new Z.Decompress((chunk) => { if (chunk.length) ajoute(chunk); }); }
    try {
      for (;;) {
        annule();
        const { done, value } = await reader.read();
        if (done) break;
        brut += value.length;
        // Octets sortis du ZIP : bornés aussi par P2 (bombe deflate autour d'une base anki21b).
        if (brut > p2) throw new ImportError('P2', `données décompressées au-delà de P2 (${p2 / MO} Mo) : arrêt à ${mo(brut)} Mo`);
        crc = crc32(crc, value);
        if (zstd) { garde.scan(value); dz.push(value); } else ajoute(value);
      }
      if (crc !== e.crc) throw new ImportError('zip-invalide', 'CRC-32 de la base incorrect (archive corrompue)');
      if (zstd) { garde.finish(); dz.push(new Uint8Array(0), true); }
    } catch (x) {
      try { await reader.cancel(); } catch { /* flux déjà fermé */ }
      buf = null; dz = null;
      if (x instanceof ImportError) throw x;
      throw new ImportError('decompression', `décompression impossible : ${(x && x.message) || x}`);
    }
    if (!buf) buf = new Uint8Array(0);
    return {
      nom: e.nom, octets: n === buf.length ? buf : buf.subarray(0, n), lus: n, brut, compression: zstd ? 'zstd' : e.methode === 8 ? 'deflate' : 'aucune',
      ignorees, factice, capacite: buf.byteLength, copies, octetsCopies, tramesZstd: garde ? garde.trames : 0,
    };
  }
  g.KZip = Object.freeze({ extract, entries, choose, zstdGuard, crc32, ImportError, MO, BASES });
})(typeof self !== 'undefined' ? self : globalThis);

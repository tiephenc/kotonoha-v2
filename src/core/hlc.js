// KOTONOHA 2.0 · horloge logique hybride (08 §7.4 ; Kulkarni, Demirbas et coll., OPODIS 2014).
// Domaine pur. Une HLC est un couple [l, c] : l en millisecondes, c compteur logique.

/** @typedef {[number, number]} Hlc */

export const DRIFT_WARN_MS = 5 * 60_000;   // [Hyp] 08 §7.4 : « l'heure de cet appareil semble décalée »
export const DRIFT_FREEZE_MS = 60 * 60_000; // [Hyp] au-delà, l'horloge physique n'avance plus la HLC

/** Ordre des HLC. @param {Hlc} a @param {Hlc} b */
export const cmpHlc = (a, b) => a[0] - b[0] || a[1] - b[1];

/** @param {unknown} h @returns {h is Hlc} */
export const isHlc = (h) => Array.isArray(h) && h.length === 2 && h.every((x) => Number.isSafeInteger(x) && x >= 0);

/**
 * Horloge d'un appareil. `frozen` : l'horloge physique est jugée trop décalée ; seul le compteur
 * avance et les opérations créées portent un `t` incertain.
 */
export class Clock {
  /** @param {Hlc} [start] @param {() => number} [phys] */
  constructor(start = [0, 0], phys = () => Date.now()) { this.h = /** @type {Hlc} */ ([...start]); this.phys = phys; this.frozen = false; }

  /** HLC d'un événement local (envoi ou création). @returns {Hlc} */
  tick() {
    const [l, c] = this.h;
    const p = this.frozen ? l : this.phys();
    this.h = p > l ? [p, 0] : [l, c + 1];
    return [...this.h];
  }

  /** Réception d'une HLC distante : avance au maximum, puis incrémente (causalité). @param {Hlc} r @returns {Hlc} */
  recv(r) {
    const [l, c] = this.h;
    const p = this.frozen ? 0 : this.phys();
    const L = Math.max(l, r[0], p);
    const C = L === l && L === r[0] ? Math.max(c, r[1]) + 1 : L === l ? c + 1 : L === r[0] ? r[1] + 1 : 0;
    this.h = [L, C];
    return [...this.h];
  }

  /**
   * Écart entre l'horloge de l'appareil et un horodatage serveur reçu (PH-2).
   * @param {number} serverMs @returns {'ok'|'decalee'|'gelee'}
   */
  checkDrift(serverMs) {
    const d = Math.abs(this.phys() - serverMs);
    this.frozen = d > DRIFT_FREEZE_MS;
    return this.frozen ? 'gelee' : d > DRIFT_WARN_MS ? 'decalee' : 'ok';
  }
}

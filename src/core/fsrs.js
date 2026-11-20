// KOTONOHA 2.0 · MOD-04 core/fsrs — modèle mémoriel FSRS-4.5 (02 §11.4 ; D-25, D-46). Domaine pur.
// Mêmes formules et mêmes paramètres par défaut publiés que la V1 (`index.html`, bloc « FSRS-4.5 »),
// pour reprendre ses états sans conversion (02 §11.8). Granularité : le jour. Aucun accès à l'horloge.
// La V2 n'a pas d'étapes d'apprentissage en minutes : une facette n'entre en consolidation qu'après une
// première récupération réussie (02 §11.6, 01 RM-K01) ; avant, elle est réenseignée.

/** Paramètres par défaut publiés de FSRS-4.5 (identiques à la V1). */
export const W = Object.freeze([0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]);
export const DECAY = -0.5, FACTOR = 19 / 81;
/** Rétention visée : 0,9 par défaut, réglable entre 0,80 et 0,95 (01 F-K06). */
export const TARGET = Object.freeze({ min: 0.8, def: 0.9, max: 0.95 });
export const MAX_INTERVAL = 36500;

/** Notes : 1 oubli, 2 difficile, 3 correct, 4 facile. */
const grade = (g) => { if (![1, 2, 3, 4].includes(g)) throw new Error(`note FSRS invalide : ${g}`); return g; };
const clampD = (d) => Math.min(10, Math.max(1, d));
const d0 = (g) => clampD(W[4] - (g - 3) * W[5]);
const round3 = (x) => +(+x).toFixed(3); // même arrondi que la V1, pour reprendre ses états à l'identique

/** Probabilité de rappel après `t` jours pour une stabilité `s`. */
export const retrievability = (t, s) => Math.pow(1 + FACTOR * Math.max(0, t) / s, DECAY);

/** État initial après la première récupération réussie (ou non) : {s, d}. @param {number} g */
export function initial(g) {
  grade(g);
  return { s: round3(W[g - 1]), d: round3(d0(g)) };
}

/**
 * Révision d'une facette déjà en consolidation, `t` jours après la précédente.
 * @param {{s: number, d: number}} st @param {number} g @param {number} t
 */
export function review(st, g, t) {
  grade(g);
  if (!(st.s > 0) || !(st.d >= 1 && st.d <= 10)) throw new Error('état FSRS invalide');
  const r = retrievability(t, st.s);
  const d = clampD(W[7] * d0(4) + (1 - W[7]) * (st.d - W[6] * (g - 3)));
  const s = g === 1
    ? Math.min(st.s, W[11] * Math.pow(d, -W[12]) * (Math.pow(st.s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]))
    : st.s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(st.s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  return { s: round3(s), d: round3(d), r: round3(r) };
}

/**
 * Intervalle en jours pour atteindre la rétention visée. Avec 0,9, l'intervalle vaut la stabilité.
 * @param {number} s @param {number} [target]
 */
export function interval(s, target = TARGET.def) {
  if (!(target >= TARGET.min && target <= TARGET.max)) throw new Error(`rétention visée hors bornes : ${target}`);
  const i = s / FACTOR * (Math.pow(target, 1 / DECAY) - 1);
  return Math.min(MAX_INTERVAL, Math.max(1, Math.round(i)));
}

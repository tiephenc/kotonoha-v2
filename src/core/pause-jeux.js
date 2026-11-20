// KOTONOHA 2.0 · micro-activités contemplatives de l'écran de pause : géométrie et dynamique pures.
// Aucun accès au DOM, à l'horloge ni au hasard global : le hasard (`rng`, dans [0, 1[) est injecté, le temps passé en
// secondes. Aucun score, aucune série, aucun historique (D-34, PR-07). Les coordonnées sont normalisées sur la
// largeur de la scène : x dans [0, 1], y dans [0, HAUTEUR] (scène 4 : 3).
export const HAUTEUR = 0.75;
export const LIMITES = Object.freeze({ pointsSable: 6000, gouttes: 24, traitsEnso: 40, lucioles: 18 });
export const DENTS = 5;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Reste dans la scène. */
export const dansScene = (x, y) => [clamp(x, 0, 1), clamp(y, 0, HAUTEUR)];

/** Ajoute un point au trait s'il est assez loin du précédent (le trait est modifié). Rend vrai si ajouté. */
export function ajouterPoint(trait, x, y, ecartMin = 0.004) {
  const [cx, cy] = dansScene(x, y);
  const dernier = trait[trait.length - 1];
  if (dernier && Math.hypot(dernier[0] - cx, dernier[1] - cy) < ecartMin) return false;
  trait.push([cx, cy]);
  return true;
}

/** Garde au plus `max` points au total en retirant d'abord les traits les plus anciens. Rend une nouvelle liste. */
export function limiterTraits(traits, max = LIMITES.pointsSable) {
  let total = traits.reduce((s, t) => s + t.length, 0);
  const sortie = traits.slice();
  while (sortie.length > 1 && total > max) total -= sortie.shift().length;
  return sortie;
}

/** Les `n` sillons d'un râteau le long d'un trait : polylignes décalées de part et d'autre, perpendiculairement au geste. */
export function dentsDuTrait(pts, n = DENTS, ecart = 0.011) {
  const sillons = Array.from({ length: n }, () => []);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l === 0) { dx = 1; dy = 0; } else { dx /= l; dy /= l; }
    const nx = -dy, ny = dx;
    for (let k = 0; k < n; k++) { const d = (k - (n - 1) / 2) * ecart; sillons[k].push([pts[i][0] + nx * d, pts[i][1] + ny * d]); }
  }
  return sillons;
}

/** Déplacement du curseur au clavier. Rend le nouveau curseur, ou null pour une touche sans effet. */
export function deplacerCurseur(c, touche, pas = 0.03) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[touche];
  return d ? dansScene(c[0] + d[0] * pas, c[1] + d[1] * pas) : null;
}

// ---------------------------------------------------------------- lucioles
/** `n` lucioles au repos, réparties dans la scène. */
export function creerLucioles(n, rng) {
  const m = clamp(Math.round(n), 1, LIMITES.lucioles);
  return Array.from({ length: m }, () => ({ x: rng(), y: rng() * HAUTEUR, vx: 0, vy: 0, phase: rng() * Math.PI * 2 }));
}

/**
 * Un pas de `dt` secondes (au plus 0,1 pris en compte). Les lucioles errent doucement ; si une cible est donnée, elles
 * s'en approchent d'autant plus que `attirance` (0 à 1) est grande. Rend de nouvelles lucioles, jamais hors de la scène.
 */
export function pasLucioles(ls, { dt, rng, cible = null, attirance = 0 }) {
  const t = clamp(dt, 0, 0.1), a = clamp(attirance, 0, 1);
  return ls.map((l) => {
    let vx = l.vx + (rng() - 0.5) * 0.9 * t, vy = l.vy + (rng() - 0.5) * 0.9 * t;
    if (cible && a > 0) { vx += (cible[0] - l.x) * a * 2.2 * t; vy += (cible[1] - l.y) * a * 2.2 * t; }
    const amorti = Math.max(0, 1 - 1.6 * t);
    vx *= amorti; vy *= amorti;
    const v = Math.hypot(vx, vy), vmax = 0.14;
    if (v > vmax) { vx = vx / v * vmax; vy = vy / v * vmax; }
    let x = l.x + vx * t, y = l.y + vy * t;
    if (x < 0 || x > 1) { vx = -vx; x = clamp(x, 0, 1); }
    if (y < 0 || y > HAUTEUR) { vy = -vy; y = clamp(y, 0, HAUTEUR); }
    return { x, y, vx, vy, phase: l.phase + t * 2.1 };
  });
}
/** Éclat d'une luciole, de 0,25 à 1 ; constant (0,8) sans mouvement. */
export const eclat = (l, mouvement = true) => (mouvement ? 0.625 + 0.375 * Math.sin(l.phase) : 0.8);
/** Attirance de la lanterne : nulle tant qu'on la bouge, croissante après une demi-seconde d'immobilité, pleine à 2 s. */
export const attiranceApresImmobilite = (ms) => clamp((ms - 500) / 1500, 0, 1);

// ---------------------------------------------------------------- gouttes d'encre
export const DUREE_GOUTTE = 3.2;
/** Ajoute une goutte (rayon final entre 0,05 et 0,12) ; au-delà de la limite, la plus ancienne s'efface. */
export function ajouterGoutte(gouttes, x, y, rng, max = LIMITES.gouttes) {
  const [cx, cy] = dansScene(x, y);
  const sortie = [...gouttes, { x: cx, y: cy, age: 0, rmax: 0.05 + rng() * 0.07 }];
  return sortie.length > max ? sortie.slice(sortie.length - max) : sortie;
}
/** Vieillit les gouttes de `dt` secondes (l'âge s'arrête à la durée d'expansion). */
export const vieillirGouttes = (gouttes, dt) => gouttes.map((g) => (g.age >= DUREE_GOUTTE ? g : { ...g, age: Math.min(DUREE_GOUTTE, g.age + Math.max(0, dt)) }));
export const gouttesAuRepos = (gouttes) => gouttes.every((g) => g.age >= DUREE_GOUTTE);
/** Aspect d'une goutte : rayon courant, voile (tache) et anneaux (rayon, opacité). Rien ne disparaît tout à fait : le lavis reste. */
export function aspectGoutte(g) {
  const t = clamp(g.age / DUREE_GOUTTE, 0, 1), e = 1 - (1 - t) ** 3, r = g.rmax * e;
  return { rayon: r, voile: 0.07 + 0.08 * (1 - t), anneaux: [1, 0.72, 0.45].map((f) => ({ r: r * f, alpha: 0.1 + 0.4 * (1 - t) })) };
}

// ---------------------------------------------------------------- ensō
/** Largeur du pinceau selon la vitesse (unités de largeur par milliseconde) : un geste lent est plus épais. */
export const largeurPinceau = (vitesse) => clamp(0.028 - Math.max(0, vitesse) * 8, 0.006, 0.028);
/** Un ensō : cercle presque fermé (ouverture de 0,12 tour), `n` points ; épaisseur maximale au départ, fine à la fin. */
export function ensoAuto(cx, cy, rayon, n = 72) {
  const debut = -Math.PI * 0.35, tour = Math.PI * 2 * 0.88;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, a = debut + t * tour;
    return [cx + Math.cos(a) * rayon, cy + Math.sin(a) * rayon, 0.026 - 0.018 * t * t];
  });
}
export { dist as distance };

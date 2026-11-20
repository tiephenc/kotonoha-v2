// KOTONOHA 2.0 · reconnaissance et correction du tracé d'un kana (écriture interactive). Domaine pur : aucun DOM, aucune E/S, aucune horloge.
// Le modèle est celui de KanjiVG (cadre 109 × 109, un chemin SVG par trait, dans l'ordre). Un tracé de l'apprenant est une liste de traits,
// chacun une liste de points [x, y] ; l'interface convertit les coordonnées de l'écran dans le cadre 109 × 109 avant d'appeler `corriger`.
//
// Méthode : chaque trait est rééchantillonné en NB_POINTS points équidistants le long de sa longueur ; le dessin entier est recalé sur le
// modèle (même boîte englobante, échelle uniforme) ; chaque trait est comparé au trait du modèle de même rang par la distance moyenne
// point à point. Un trait trop éloigné est ensuite examiné dans le sens inverse (sens), contre les autres traits (ordre), puis recentré
// sur lui-même (position ou forme).
//
// SEUILS PROVISOIRES [Hyp] : ils ne sont ni calibrés sur des tracés réels ni validés par une relecture pédagogique. Ils servent à
// distinguer un tracé reconnaissable d'un tracé aberrant ; ils ne mesurent pas la qualité de l'écriture manuscrite (proportions
// fines, épaisseur, crochets et terminaisons, qui comptent pour un lecteur japonais, ne sont pas évalués).

export const CADRE = 109;
export const NB_POINTS = 32;

/** [Hyp] Seuils provisoires, en unités du cadre 109 × 109. */
export const SEUILS = Object.freeze({
  /** Tolérance de distance moyenne d'un trait long ; elle diminue pour un trait court (voir `tolerance`). */
  toleranceMax: 15,
  toleranceMin: 7,
  /** Part de la longueur du trait modèle qui donne la tolérance. */
  partLongueur: 0.35,
  /** Un trait plus court que cela (cadre 109) est une touche accidentelle, ignorée. */
  longueurMin: 2,
  /** Le dessin entier doit couvrir au moins cela (plus grande dimension de la boîte englobante) pour être recalé. */
  etenduePetite: 6,
  /** Un trait n'est dit « à l'envers » que si le sens inverse est nettement meilleur. */
  gainInverse: 0.8,
});

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ——— Chemins SVG (sous-ensemble de KanjiVG : M m L l H h V v C c S s Q q T t Z z ; les arcs ne sont pas utilisés) ———

const NOMBRES = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };

/** Découpe un chemin en commandes {c, a: nombres}. */
function commandes(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtZz])([^MmLlHhVvCcSsQqTtZz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const nombres = (m[2].match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    const n = NOMBRES[m[1].toUpperCase()];
    if (n === 0) { out.push({ c: m[1], a: [] }); continue; }
    if (nombres.length === 0 || nombres.length % n !== 0) throw new Error(`chemin invalide : ${m[1]} avec ${nombres.length} nombres`);
    for (let i = 0; i < nombres.length; i += n) out.push({ c: i === 0 ? m[1] : (m[1] === 'M' ? 'L' : m[1] === 'm' ? 'l' : m[1]), a: nombres.slice(i, i + n) });
  }
  if (!out.length) throw new Error('chemin vide');
  return out;
}

const bezier3 = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
};
const bezier2 = (p0, p1, p2, t) => { const u = 1 - t; return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]; };

/**
 * Chemin SVG → polyligne dense [[x, y], …] (courbes de Bézier découpées en `pas` segments).
 * @param {string} d @param {number} [pas]
 */
export function polylignePourChemin(d, pas = 16) {
  const pts = [];
  let cur = [0, 0], debut = [0, 0], derC = null, derQ = null;
  for (const { c, a } of commandes(d)) {
    const rel = c === c.toLowerCase(), C = c.toUpperCase();
    const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0;
    let fin = cur;
    let c2 = null, q1 = null;
    if (C === 'M') { fin = [a[0] + ox, a[1] + oy]; debut = fin; pts.push(fin); }
    else if (C === 'L') { fin = [a[0] + ox, a[1] + oy]; pts.push(fin); }
    else if (C === 'H') { fin = [a[0] + ox, cur[1]]; pts.push(fin); }
    else if (C === 'V') { fin = [cur[0], a[0] + oy]; pts.push(fin); }
    else if (C === 'C' || C === 'S') {
      const p1 = C === 'C' ? [a[0] + ox, a[1] + oy] : (derC ? [2 * cur[0] - derC[0], 2 * cur[1] - derC[1]] : cur);
      const k = C === 'C' ? 2 : 0;
      const p2 = [a[k] + ox, a[k + 1] + oy], p3 = [a[k + 2] + ox, a[k + 3] + oy];
      for (let i = 1; i <= pas; i++) pts.push(bezier3(cur, p1, p2, p3, i / pas));
      fin = p3; c2 = p2;
    } else if (C === 'Q' || C === 'T') {
      const p1 = C === 'Q' ? [a[0] + ox, a[1] + oy] : (derQ ? [2 * cur[0] - derQ[0], 2 * cur[1] - derQ[1]] : cur);
      const p2 = C === 'Q' ? [a[2] + ox, a[3] + oy] : [a[0] + ox, a[1] + oy];
      for (let i = 1; i <= pas; i++) pts.push(bezier2(cur, p1, p2, i / pas));
      fin = p2; q1 = p1;
    } else if (C === 'Z') { fin = debut; pts.push(fin); }
    derC = c2; derQ = q1; cur = fin;
  }
  return pts;
}

/** Longueur d'une polyligne. */
export function longueur(poly) {
  let l = 0;
  for (let i = 1; i < poly.length; i++) l += dist(poly[i - 1], poly[i]);
  return l;
}

/**
 * Rééchantillonne une polyligne en `n` points équidistants le long de sa longueur (premier et dernier points conservés).
 * Un trait sans longueur (un point) donne `n` fois ce point.
 * @param {number[][]} poly @param {number} [n]
 */
export function reechantillonner(poly, n = NB_POINTS) {
  if (!poly.length) throw new Error('trait vide');
  const total = longueur(poly);
  if (total === 0) return Array.from({ length: n }, () => [...poly[0]]);
  const out = [[...poly[0]]];
  let i = 1, parcouru = 0, segDebut = 0;
  for (let k = 1; k < n - 1; k++) {
    const cible = (total * k) / (n - 1);
    while (i < poly.length - 1 && segDebut + dist(poly[i - 1], poly[i]) < cible) { segDebut += dist(poly[i - 1], poly[i]); i++; }
    const l = dist(poly[i - 1], poly[i]);
    const t = l === 0 ? 0 : (cible - segDebut) / l;
    parcouru = t;
    out.push([poly[i - 1][0] + (poly[i][0] - poly[i - 1][0]) * parcouru, poly[i - 1][1] + (poly[i][1] - poly[i - 1][1]) * parcouru]);
  }
  out.push([...poly[poly.length - 1]]);
  return out;
}

/** Modèle d'un signe : traits (chemins `d`) → { traits: [{poly, pts, longueur}], boite }. */
export function preparerModele(chemins, n = NB_POINTS) {
  const traits = chemins.map((d) => { const poly = polylignePourChemin(d); return { poly, pts: reechantillonner(poly, n), longueur: longueur(poly) }; });
  return { traits, boite: boite(traits.flatMap((t) => t.poly)) };
}

/** Boîte englobante {x0, y0, x1, y1}. */
export function boite(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}

/** Tolérance de distance moyenne pour un trait modèle de longueur `l` (cadre 109). */
export const tolerance = (l) => Math.max(SEUILS.toleranceMin, Math.min(SEUILS.toleranceMax, SEUILS.partLongueur * l));

/** Distance moyenne point à point entre deux listes de même longueur. */
export function distanceMoyenne(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += dist(a[i], b[i]);
  return s / a.length;
}

const centre = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const decaler = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);

/**
 * Recale le dessin entier sur la boîte du modèle : même centre, échelle uniforme (plus grande dimension identique).
 * Ainsi la taille et la position du tracé dans la zone de dessin n'influencent pas le verdict ; les proportions relatives des traits, si.
 * @returns {number[][][]} traits recalés, ou null si le dessin est trop petit pour être recalé
 */
export function recaler(traits, boiteModele) {
  const b = boite(traits.flat());
  const w = b.x1 - b.x0, h = b.y1 - b.y0, wm = boiteModele.x1 - boiteModele.x0, hm = boiteModele.y1 - boiteModele.y0;
  const etendue = Math.max(w, h);
  if (!(etendue >= SEUILS.etenduePetite)) return null;
  const s = Math.max(wm, hm) / etendue;
  const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], cm = [(boiteModele.x0 + boiteModele.x1) / 2, (boiteModele.y0 + boiteModele.y1) / 2];
  return traits.map((t) => t.map(([x, y]) => [(x - c[0]) * s + cm[0], (y - c[1]) * s + cm[1]]));
}

const phrasePluriel = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/**
 * Corrige un tracé.
 * @param {{traits: {poly: number[][], pts: number[][], longueur: number}[], boite: object}} modele issu de `preparerModele`
 * @param {number[][][]} trace traits de l'apprenant, points [x, y] dans le cadre 109 × 109 (ou dans n'importe quel cadre si `recalage` est vrai)
 * @param {{recalage?: boolean, decalage?: number}} [o] `recalage` (défaut vrai) : recaler le dessin sur la boîte du modèle ; `decalage` : numéro du premier trait moins 1 (un signe à plusieurs parties : kana-yoon.js)
 * @returns {{reussi: boolean, score: number, nbAttendus: number, nbTraces: number, diagnostics: {type: string, trait: number|null, message: string}[],
 *   traits: {trait: number, distance: number, tolerance: number, ok: boolean}[], fautifs: number[]}}
 */
export function corriger(modele, trace, { recalage = true, decalage = 0 } = {}) {
  const dec = decalage;
  const nbAttendus = modele.traits.length;
  const bruts = trace.filter((t) => t.length >= 2 && longueur(t) >= SEUILS.longueurMin);
  const base = { nbAttendus, nbTraces: bruts.length, diagnostics: [], traits: [], fautifs: [] };
  if (bruts.length === 0) {
    return { ...base, reussi: false, score: 0, diagnostics: [{ type: 'vide', trait: null, message: 'Aucun trait tracé.' }] };
  }
  const calees = recalage ? recaler(bruts, modele.boite) : bruts;
  if (!calees) {
    return { ...base, reussi: false, score: 0, diagnostics: [{ type: 'trop-petit', trait: null, message: 'Le tracé est trop petit pour être reconnu : écrivez plus grand.' }] };
  }
  const pts = calees.map((t) => reechantillonner(t));
  const nbUser = pts.length, nb = Math.min(nbUser, nbAttendus);
  const tol = modele.traits.map((t) => tolerance(t.longueur));
  /** Coût (sens du tracé) du trait tracé i contre le trait modèle j. */
  const D = pts.map((p) => modele.traits.map((m) => distanceMoyenne(p, m.pts)));
  const Dinv = pts.map((p) => modele.traits.map((m) => distanceMoyenne([...p].reverse(), m.pts)));
  const diagnostics = [];
  const fautifs = new Set();
  const traits = [];

  for (let i = 0; i < nb; i++) traits.push({ trait: i + 1 + dec, distance: D[i][i], tolerance: tol[i], ok: D[i][i] <= tol[i] });

  if (nbUser !== nbAttendus) {
    diagnostics.push({ type: 'nombre', trait: null, message: `${phrasePluriel(nbAttendus, 'trait attendu', 'traits attendus')}, ${phrasePluriel(nbUser, 'tracé', 'tracés')}.` });
    // Piste : quels traits du modèle n'ont aucun trait tracé qui leur ressemble ?
    const proche = (j) => pts.some((_, i) => Math.min(D[i][j], Dinv[i][j]) <= tol[j]);
    if (nbUser < nbAttendus) {
      const manquants = modele.traits.map((_, j) => j).filter((j) => !proche(j));
      if (manquants.length && manquants.length <= nbAttendus - nbUser + 1) {
        manquants.forEach((j) => fautifs.add(j + 1));
        diagnostics.push({ type: 'manquant', trait: manquants[0] + 1, message: manquants.length === 1 ? `Le trait ${manquants[0] + 1} semble manquer.` : `Les traits ${manquants.map((j) => j + 1).join(', ')} semblent manquer.` });
      }
    } else {
      const enTrop = pts.map((_, i) => i).filter((i) => !modele.traits.some((m, j) => Math.min(D[i][j], Dinv[i][j]) <= tol[j]));
      if (enTrop.length && enTrop.length <= nbUser - nbAttendus + 1) diagnostics.push({ type: 'en-trop', trait: enTrop[0] + 1, message: enTrop.length === 1 ? `Le trait que vous avez tracé en position ${enTrop[0] + 1} ne correspond à aucun trait du modèle.` : `Les traits tracés en positions ${enTrop.map((i) => i + 1).join(', ')} ne correspondent à aucun trait du modèle.` });
    }
  } else {
    const mauvais = [];
    for (let i = 0; i < nb; i++) if (D[i][i] > tol[i]) mauvais.push(i);
    const traites = new Set();
    // 1. Ordre : un trait mal placé qui ressemble nettement à un autre trait du modèle (dans le même sens).
    for (const i of mauvais) {
      if (traites.has(i)) continue;
      let meilleur = -1;
      for (let j = 0; j < nb; j++) if (j !== i && D[i][j] <= tol[j] && (meilleur < 0 || D[i][j] < D[i][meilleur])) meilleur = j;
      if (meilleur < 0) continue;
      const j = meilleur;
      if (mauvais.includes(j) && D[j][i] <= tol[i]) {
        diagnostics.push({ type: 'ordre', trait: i + 1 + dec, message: `L’ordre des traits n’est pas respecté : les traits ${Math.min(i, j) + 1 + dec} et ${Math.max(i, j) + 1 + dec} sont inversés.` });
        fautifs.add(i + 1 + dec); fautifs.add(j + 1 + dec); traites.add(i); traites.add(j);
      } else {
        diagnostics.push({ type: 'ordre', trait: i + 1 + dec, message: `L’ordre des traits n’est pas respecté : le trait tracé en position ${i + 1 + dec} correspond au trait ${j + 1 + dec} du modèle.` });
        fautifs.add(i + 1 + dec); traites.add(i);
      }
    }
    // 2. Sens, puis position ou forme.
    for (const i of mauvais) {
      if (traites.has(i)) continue;
      traites.add(i); fautifs.add(i + 1 + dec);
      if (Dinv[i][i] <= tol[i] && Dinv[i][i] < D[i][i] * SEUILS.gainInverse) {
        diagnostics.push({ type: 'sens', trait: i + 1 + dec, message: `Le trait ${i + 1 + dec} est tracé à l’envers : il commence là où il devrait finir.` });
        continue;
      }
      const c = centre(pts[i]), cm = centre(modele.traits[i].pts);
      const recentre = distanceMoyenne(decaler(pts[i], cm[0] - c[0], cm[1] - c[1]), modele.traits[i].pts);
      if (recentre <= tol[i]) diagnostics.push({ type: 'position', trait: i + 1 + dec, message: `Le trait ${i + 1 + dec} est bien formé mais mal placé dans le signe.` });
      else diagnostics.push({ type: 'forme', trait: i + 1 + dec, message: `Le trait ${i + 1 + dec} est trop éloigné du modèle : sa forme ou sa direction diffère.` });
    }
    // Les diagnostics suivent l'ordre des traits.
    diagnostics.sort((x, y) => (x.trait ?? 0) - (y.trait ?? 0));
  }

  // Score : par trait, 1 à distance nulle, 0,5 à la tolérance, 0 au double ; un trait manquant ou en trop compte 0.
  let somme = 0;
  for (let i = 0; i < nb; i++) somme += Math.max(0, 1 - D[i][i] / (2 * tol[i]));
  const score = Math.round((100 * somme) / Math.max(nbUser, nbAttendus));
  return { ...base, reussi: diagnostics.length === 0, score: diagnostics.length === 0 ? score : Math.min(score, 99), diagnostics, traits, fautifs: [...fautifs].sort((a, b) => a - b) };
}

/** Le tracé le plus simple possible depuis le modèle : ses propres traits rééchantillonnés (utile aux tests et à l'animation). */
export const traceDuModele = (modele) => modele.traits.map((t) => t.pts.map((p) => [...p]));

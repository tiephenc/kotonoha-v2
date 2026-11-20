// KOTONOHA 2.0 · écriture interactive des kana : signes à plusieurs parties et petits kana (yōon きゃ…ぴょ, ゃゅょ, っ, ぁぃぅぇぉ…).
// Domaine pur : aucun DOM, aucune E/S. Aucun tracé nouveau : un yōon COMPOSE le tracé KanjiVG du premier signe (き) et celui du petit
// signe (ゃ), déjà présents dans kana-traces.json ; le petit signe est réduit et posé en bas à gauche de sa case.
//
// Disposition (cadre de la zone de tracé, en unités KanjiVG où une case fait 109 × 109) :
//   - un petit kana seul : une case, le signe réduit en bas à gauche ;
//   - un yōon : deux cases côte à côte (la seconde est plus étroite, LARGEUR_YOON au total) : le premier signe en taille normale dans la
//     première case, le petit signe réduit en bas à gauche de la seconde.
// Une « partie » = { traits (chemins SVG KanjiVG), petit, echelle, dx, dy } : le point (x, y) du modèle se place en (x·echelle + dx, y·echelle + dy).
//
// Reconnaissance (corrigerDisposition) : la FORME de chaque partie est jugée par `corriger` (kana-trace.js, recalage sur la partie : la
// taille et la position du dessin n'y comptent pas) ; puis la TAILLE et la POSITION du petit signe sont jugées à part :
//   - yōon : le dessin est recalé sur le premier signe (même centre, même échelle que sa boîte modèle) ; le petit signe est comparé,
//     dans ce repère, à sa boîte attendue. La taille et la position du dessin entier dans la zone restent donc sans effet ; seul compte le
//     rapport entre les deux signes (« taille relative ») et la place du second par rapport au premier ;
//   - petit signe seul : aucun signe de référence, le repère est la case de la zone (le dessin n'est pas recalé).
// SEUILS PROVISOIRES [Hyp] : ni calibrés sur des tracés réels, ni validés par une relecture pédagogique (voir LISEZMOI.md, § écriture des kana).
import { CADRE, SEUILS, preparerModele, corriger, boite, longueur } from './kana-trace.js';

/** [Hyp] Géométrie du petit signe : réduit (par rapport au tracé KanjiVG, déjà un peu plus petit qu'un signe normal), en bas à gauche de la case. */
export const DISPOSITION = Object.freeze({
  /** Échelle du petit signe par rapport à son tracé KanjiVG (≈ 0,6 de la hauteur d'un signe normal, comme sur un papier de composition japonais). */
  echelle: 0.75,
  /** Marge gauche de la case (cadre 109) et ligne de pied du petit signe (les signes normaux KanjiVG s'arrêtent vers 91 à 94). */
  gauche: 8,
  bas: 95,
  /** Largeur de la zone d'un yōon : une case entière (109) puis une case étroite pour le petit signe. */
  largeurYoon: 180,
});

/** [Hyp] Seuils de taille et de position du petit signe. */
export const SEUILS_PETIT = Object.freeze({
  /** Rapport (plus grande dimension du petit signe tracé) / (celle du petit signe attendu) : au-delà, « trop grand » ; en deçà, « trop petit ». */
  grand: 1.3,
  reduit: 0.65,
  /** Tolérances, en part de la plus grande dimension du premier signe (≈ 77 : référence RELATIVE) ou, sans premier signe, de REF_CASE. */
  basYoon: 0.18, xYoon: 0.4, xSeul: 0.25, basSeul: 0.18,
  REF_CASE: 80,
});

const dec = (pts, e, dx, dy) => pts.map(([x, y]) => [x * e + dx, y * e + dy]);

/**
 * Partie d'un signe composé.
 * @param {string[]} traits chemins KanjiVG @param {{petit?: boolean, x0?: number}} [o] x0 : abscisse de la case (0 ou 109)
 */
export function partie(traits, { petit = false, x0 = 0 } = {}) {
  if (!petit) return { traits: [...traits], petit: false, echelle: 1, dx: x0, dy: 0 };
  const b = preparerModele(traits).boite, e = DISPOSITION.echelle;
  return { traits: [...traits], petit: true, echelle: e, dx: x0 + DISPOSITION.gauche - e * b.x0, dy: DISPOSITION.bas - e * b.y1 };
}

/** Disposition d'un petit kana seul (ゃ, っ, ぁ…) : une case. */
export const dispositionPetit = (traits) => ({ largeur: CADRE, parties: [partie(traits, { petit: true })] });
/** Disposition d'un yōon : le premier signe, puis le petit signe. */
export const dispositionYoon = (traitsGrand, traitsPetit) => ({ largeur: DISPOSITION.largeurYoon, parties: [partie(traitsGrand), partie(traitsPetit, { petit: true, x0: CADRE })] });

/** Chemins de la disposition, dans l'ordre d'écriture (numérotation des traits). */
export const cheminsDisposition = (d) => d.parties.flatMap((p) => p.traits);

/** Modèle d'une partie placé dans le repère de la zone. */
function placer(modele, { echelle: e, dx, dy }) {
  const traits = modele.traits.map((t) => ({ poly: dec(t.poly, e, dx, dy), pts: dec(t.pts, e, dx, dy), longueur: t.longueur * e }));
  return { traits, boite: boite(traits.flatMap((t) => t.poly)) };
}

/** Disposition préparée : modèle brut et modèle placé de chaque partie, et modèle composé (tous les traits placés, dans l'ordre). */
export function preparerDisposition(d) {
  const parties = d.parties.map((p) => { const modele = preparerModele(p.traits); return { ...p, modele, place: placer(modele, p) }; });
  const traits = parties.flatMap((p) => p.place.traits);
  return { largeur: d.largeur, parties, nb: traits.length, compose: { traits, boite: boite(traits.flatMap((t) => t.poly)) } };
}

/** Boîte attendue (repère de la zone) d'une partie de la disposition (calcul léger, pour l'affichage de l'emplacement du petit signe). */
export const boiteAttendue = (p) => placer(preparerModele(p.traits), p).boite;

/** Le tracé du modèle placé (pour les tests et l'animation) : traits rééchantillonnés dans le repère de la zone. */
export const traceDeDisposition = (pd) => pd.compose.traits.map((t) => t.pts.map((p) => [...p]));

const dim = (b) => Math.max(b.x1 - b.x0, b.y1 - b.y0);
const centreX = (b) => (b.x0 + b.x1) / 2;

/**
 * Corrige un tracé sur une disposition préparée (voir l'en-tête du fichier).
 * @param {ReturnType<typeof preparerDisposition>} pd @param {number[][][]} trace points dans le repère de la zone (largeur pd.largeur, hauteur 109)
 * @returns {ReturnType<typeof corriger>} même forme que `corriger` ; diagnostics supplémentaires : 'trop-grand', 'trop-reduit', 'position-petit'
 */
export function corrigerDisposition(pd, trace) {
  const nbParties = pd.parties.length;
  // Nombre de traits différent : le diagnostic (manquant, en trop) se fait sur le modèle composé, recalé sur le dessin entier.
  const nbAttendus = pd.nb;
  const bruts = trace.filter((t) => t.length >= 2 && longueur(t) >= SEUILS.longueurMin);
  if (bruts.length !== nbAttendus) return corriger(pd.compose, trace);

  const resultats = [];
  let decalage = 0;
  const boitesTracees = [];
  for (const p of pd.parties) {
    const n = p.modele.traits.length;
    const sous = bruts.slice(decalage, decalage + n);
    resultats.push(corriger(p.modele, sous, { decalage }));
    boitesTracees.push(boite(sous.flat()));
    decalage += n;
  }

  const geo = [];
  const formesOk = resultats.every((r) => r.reussi);
  if (formesOk) {
    // Repère : le premier signe s'il y en a un (recalage sur sa boîte), sinon la case elle-même.
    const iRef = pd.parties.findIndex((p) => !p.petit);
    let carte = (b) => b, ref = SEUILS_PETIT.REF_CASE;
    if (iRef >= 0) {
      const bt = boitesTracees[iRef], bm = pd.parties[iRef].place.boite;
      const k = dim(bm) / dim(bt);
      if (Number.isFinite(k) && dim(bt) > 0) {
        const cx = (bt.x0 + bt.x1) / 2, cy = (bt.y0 + bt.y1) / 2, mx = (bm.x0 + bm.x1) / 2, my = (bm.y0 + bm.y1) / 2;
        carte = (b) => ({ x0: (b.x0 - cx) * k + mx, x1: (b.x1 - cx) * k + mx, y0: (b.y0 - cy) * k + my, y1: (b.y1 - cy) * k + my });
        ref = dim(bm);
      }
    }
    let debut = 0;
    pd.parties.forEach((p, idx) => {
      const n = p.modele.traits.length, premier = debut + 1;
      debut += n;
      if (!p.petit) return;
      const bt = carte(boitesTracees[idx]), be = p.place.boite;
      const rapport = dim(bt) / dim(be);
      const numeros = Array.from({ length: n }, (_, i) => premier + i);
      const seul = iRef < 0, nom = seul ? 'Le signe' : 'Le petit signe';
      if (rapport > SEUILS_PETIT.grand) {
        geo.push({ type: 'trop-grand', trait: premier, numeros, message: seul
          ? 'Le signe est trop grand : un petit kana tient dans le coin en bas à gauche de la case, nettement plus petit qu’un signe normal.'
          : 'Le petit signe est trop grand : il doit rester nettement plus petit que le premier.' });
      } else if (rapport < SEUILS_PETIT.reduit) {
        geo.push({ type: 'trop-reduit', trait: premier, numeros, message: `${nom} est trop petit : écrivez-le un peu plus grand, tout en le gardant plus petit qu’un signe normal.` });
      } else {
        const dy = bt.y1 - be.y1, dx = centreX(bt) - centreX(be);
        const tolY = (seul ? SEUILS_PETIT.basSeul : SEUILS_PETIT.basYoon) * ref, tolX = (seul ? SEUILS_PETIT.xSeul : SEUILS_PETIT.xYoon) * ref;
        const basOu = seul ? 'Un petit kana se place en bas à gauche de la case.' : 'Il se pose sur la même ligne du bas que le premier signe.';
        const droiteOu = seul ? 'Un petit kana se place en bas à gauche de la case.' : 'Il se place juste à droite du premier signe.';
        if (Math.abs(dy) > tolY) {
          geo.push({ type: 'position-petit', trait: premier, numeros, message: `${nom} est placé trop ${dy < 0 ? 'haut' : 'bas'}. ${basOu}` });
        } else if (Math.abs(dx) > tolX) {
          geo.push({ type: 'position-petit', trait: premier, numeros, message: `${nom} est placé trop à ${dx < 0 ? 'gauche' : 'droite'}. ${droiteOu}` });
        }
      }
    });
  }

  const diagnostics = [...resultats.flatMap((r) => r.diagnostics), ...geo.map(({ type, trait, message }) => ({ type, trait, message }))].sort((a, b) => (a.trait ?? 0) - (b.trait ?? 0));
  const fautifs = new Set(resultats.flatMap((r) => r.fautifs));
  for (const g of geo) g.numeros.forEach((n) => fautifs.add(n));
  const traits = resultats.flatMap((r) => r.traits);
  // Score : moyenne des parties pondérée par leur nombre de traits.
  const total = resultats.reduce((s, r, i) => s + r.score * pd.parties[i].modele.traits.length, 0);
  const score = Math.round(total / nbAttendus);
  const reussi = diagnostics.length === 0;
  return { reussi, score: reussi ? score : Math.min(score, 99), nbAttendus, nbTraces: bruts.length, diagnostics, traits, fautifs: [...fautifs].sort((a, b) => a - b), parties: nbParties };
}

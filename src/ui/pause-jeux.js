// KOTONOHA 2.0 · micro-activités contemplatives de l'écran de pause (sable, lucioles, gouttes d'encre, ensō), en Canvas 2D,
// sans dépendance ni son. Aucun score, aucune série, aucun historique : l'état d'une scène ne vit que dans la vue de pause
// (conservé quand on change d'activité, perdu à la fermeture). Animation seulement quand la scène est affichée, la page
// visible et le mouvement permis ; sans mouvement, la scène se redessine au geste, sans boucle.
// Clavier : la scène est focalisable ; flèches = curseur (sable et ensō tracent, Maj les déplace sans tracer),
// Entrée ou Espace = une goutte. Toucher et souris : gestes directs (touch-action: none sur la scène).
import * as J from '../core/pause-jeux.js';

const NBSP = ' ';
export const TEXTES_JEUX = Object.freeze({
  sable: { libelle: 'Jardin de sable', consigne: `Faites glisser le doigt ou la souris pour tracer des sillons avec le râteau. Au clavier${NBSP}: flèches pour tracer, Maj et flèches pour déplacer sans tracer.`, description: 'Jardin de sable à ratisser', effacer: 'Lisser le sable' },
  lucioles: { libelle: 'Lucioles', consigne: `Posez la lanterne et restez immobile${NBSP}: les lucioles s’approchent doucement. Au clavier${NBSP}: flèches pour déplacer la lanterne.`, description: 'Nuit avec des lucioles et une lanterne', effacer: null },
  encre: { libelle: 'Gouttes d’encre', consigne: `Touchez la feuille pour y laisser tomber une goutte d’encre. Au clavier${NBSP}: flèches pour viser, Entrée pour la goutte.`, description: 'Feuille de papier où tombent des gouttes d’encre', effacer: 'Nettoyer la feuille' },
  enso: { libelle: 'Ensō', consigne: `Dessinez librement au pinceau, ou laissez le bouton tracer un cercle. Au clavier${NBSP}: flèches pour dessiner, Maj et flèches pour déplacer sans tracer.`, description: 'Feuille de papier pour dessiner un ensō au pinceau', effacer: 'Effacer le dessin', auto: 'Tracer un ensō' },
});
export const ORDRE_JEUX = Object.freeze(['sable', 'lucioles', 'encre', 'enso']);

const C = { sable: '#E6D8B8', sableSombre: '#B9A67C', sableClair: '#F3EAD0', pierre: '#8A8478', papier: '#F7F0E0', encre: '#1F1D1B', nuit: '#14161F' };

/** Mouvement réduit : préférence système ou réglage de l'application. */
export function mouvementReduit() {
  try { if (document.documentElement.dataset.mouvement === 'reduit') return true; return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
}

/**
 * Monte une scène dans `canvas`. Rend { afficher, masquer, effacer, auto, detruire, etat }.
 * @param {string} type sable | lucioles | encre | enso
 * @param {HTMLCanvasElement} canvas
 * @param {{reduit?: () => boolean, rng?: () => number, maintenant?: () => number}} [opts]
 */
export function monterJeu(type, canvas, opts = {}) {
  const reduit = opts.reduit || mouvementReduit, rng = opts.rng || Math.random;
  const horloge = opts.maintenant || (() => globalThis.performance?.now?.() ?? 0);
  const ctx = canvas.getContext('2d');
  const trace = type === 'sable' || type === 'enso';
  let visible = false, detruit = false, raf = 0, dernier = 0, focus = false, aTaille = false;
  let curseur = [0.5, J.HAUTEUR / 2], actif = null, traitClavier = null, dernierGeste = 0, ciblee = false, pinceau = 0.016;
  let traits = [], gouttes = [], lucioles = type === 'lucioles' ? J.creerLucioles(12, rng) : [];

  const dimensionner = () => {
    const w = canvas.clientWidth; if (!w) { aTaille = false; return false; }
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2), pw = Math.round(w * dpr), ph = Math.round(w * J.HAUTEUR * dpr);
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    aTaille = true; return true;
  };
  const ligne = (pts, largeur, couleur, alpha = 1) => {
    if (pts.length < 2) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = largeur; ctx.strokeStyle = couleur; ctx.globalAlpha = alpha; ctx.stroke(); ctx.globalAlpha = 1;
  };
  const rond = (x, y, r, couleur, alpha = 1, trait = 0) => {
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.0001, r), 0, Math.PI * 2); ctx.globalAlpha = alpha;
    if (trait) { ctx.lineWidth = trait; ctx.strokeStyle = couleur; ctx.stroke(); } else { ctx.fillStyle = couleur; ctx.fill(); }
    ctx.globalAlpha = 1;
  };
  const halo = (x, y, r, rgb, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); };

  function dessiner() {
    if (!ctx || !aTaille) return;
    ctx.setTransform(canvas.width, 0, 0, canvas.width, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (type === 'sable') {
      ctx.fillStyle = C.sable; ctx.fillRect(0, 0, 1, J.HAUTEUR);
      for (const t of traits) for (const s of J.dentsDuTrait(t)) { ligne(s.map(([x, y]) => [x + 0.0025, y + 0.0025]), 0.004, C.sableClair, 0.9); ligne(s, 0.004, C.sableSombre, 0.95); }
      for (const [x, y, r] of [[0.28, 0.22, 0.05], [0.7, 0.5, 0.065]]) {
        for (const k of [3.2, 2.4, 1.7]) rond(x, y, r * k, C.sableSombre, 0.55, 0.003);
        rond(x, y, r, C.pierre); rond(x - r * 0.25, y - r * 0.3, r * 0.45, '#A8A296', 0.8);
      }
    } else if (type === 'lucioles') {
      ctx.fillStyle = C.nuit; ctx.fillRect(0, 0, 1, J.HAUTEUR);
      for (const l of lucioles) { const e = J.eclat(l, !reduit()); halo(l.x, l.y, 0.05, '244,215,122', 0.85 * e); rond(l.x, l.y, 0.004, '#FFF6D0', e); }
      if (ciblee || focus) { halo(curseur[0], curseur[1], 0.09, '255,200,120', 0.5); rond(curseur[0], curseur[1], 0.009, '#FFB45A'); }
    } else {
      ctx.fillStyle = C.papier; ctx.fillRect(0, 0, 1, J.HAUTEUR);
      if (type === 'encre') for (const g of gouttes) { const a = J.aspectGoutte(g); rond(g.x, g.y, a.rayon, C.encre, a.voile); for (const an of a.anneaux) rond(g.x, g.y, an.r, C.encre, an.alpha, 0.0035); }
      else for (const t of traits) { if (t.length === 1) rond(t[0][0], t[0][1], (t[0][2] ?? 0.016) / 2, C.encre, 0.85); for (let i = 1; i < t.length; i++) ligne([t[i - 1], t[i]], t[i][2] ?? 0.016, C.encre, 0.85); }
    }
    if (focus) rond(curseur[0], curseur[1], 0.014, type === 'lucioles' ? '#F4D77A' : '#A3302A', 1, 0.004); // curseur clavier
  }

  // ---- boucle d'animation : seulement affichée, page visible, mouvement permis
  const animee = () => type === 'lucioles' || (type === 'encre' && !J.gouttesAuRepos(gouttes));
  const avancer = (dt) => {
    if (type === 'lucioles') lucioles = J.pasLucioles(lucioles, { dt, rng, cible: ciblee || focus ? curseur : null, attirance: J.attiranceApresImmobilite(horloge() - dernierGeste) });
    else if (type === 'encre') gouttes = J.vieillirGouttes(gouttes, dt);
  };
  function boucle(ts) {
    raf = 0;
    if (detruit || !visible || document.hidden || reduit()) return;
    const dt = dernier ? Math.min((ts - dernier) / 1000, 0.05) : 0;
    dernier = ts; avancer(dt); dessiner();
    if (animee()) raf = requestAnimationFrame(boucle);
  }
  /** Redessine ; relance la boucle si la scène bouge. Sans mouvement : les gouttes sont posées d'emblée, rien ne tourne. */
  function relancer() {
    if (detruit || !visible || document.hidden) return;
    if (reduit()) { if (type === 'encre') gouttes = J.vieillirGouttes(gouttes, J.DUREE_GOUTTE); dessiner(); return; }
    if (!raf && animee()) { dernier = 0; raf = requestAnimationFrame(boucle); }
    dessiner();
  }
  const arreterBoucle = () => { if (raf) cancelAnimationFrame(raf); raf = 0; dernier = 0; };
  const geste = () => { dernierGeste = horloge(); };
  const attirerSansMouvement = () => { if (reduit() && type === 'lucioles') lucioles = J.pasLucioles(lucioles, { dt: 0.1, rng, cible: curseur, attirance: 1 }); };

  // ---- traits
  const nouveauTrait = (x, y, w) => { const t = [trace && type === 'enso' ? [x, y, w] : [x, y]]; traits.push(t); traits = type === 'sable' ? J.limiterTraits(traits) : traits.slice(-J.LIMITES.traitsEnso); return t; };
  const etendre = (t, x, y, w, ecart) => {
    if (!J.ajouterPoint(t, x, y, ecart)) return;
    if (type === 'enso') t[t.length - 1][2] = w;
    if (type === 'sable') traits = J.limiterTraits(traits);
  };

  // ---- gestes
  const position = (e) => { const r = canvas.getBoundingClientRect(), w = r.width || 1; return J.dansScene((e.clientX - r.left) / w, (e.clientY - r.top) / w); };
  const surBas = (e) => {
    if (e.button > 0) return;
    const [x, y] = position(e); curseur = [x, y]; ciblee = true; focus = false; geste();
    try { canvas.setPointerCapture?.(e.pointerId); } catch (er) { /* capture indisponible */ }
    if (trace) { pinceau = 0.016; actif = { trait: nouveauTrait(x, y, pinceau), t: e.timeStamp }; }
    else if (type === 'encre') gouttes = J.ajouterGoutte(gouttes, x, y, rng);
    attirerSansMouvement(); relancer();
  };
  const surDeplacement = (e) => {
    const [x, y] = position(e);
    if (type === 'lucioles' && Math.hypot(x - curseur[0], y - curseur[1]) > 0.003) { ciblee = true; geste(); }
    curseur = [x, y];
    if (actif) {
      const t = actif.trait, prec = t[t.length - 1], d = Math.hypot(x - prec[0], y - prec[1]);
      if (type === 'enso') { pinceau = pinceau * 0.7 + J.largeurPinceau(d / Math.max(1, e.timeStamp - actif.t)) * 0.3; }
      if (d >= 0.004) actif.t = e.timeStamp;
      etendre(t, x, y, pinceau, 0.004);
    }
    attirerSansMouvement(); relancer();
  };
  const surHaut = () => { actif = null; };
  const surSortie = (e) => { if (e.pointerType === 'mouse') { ciblee = false; relancer(); } };
  const surFocus = () => { try { focus = canvas.matches(':focus-visible'); } catch (e) { focus = true; } geste(); relancer(); }; // curseur visible seulement au clavier
  const surFlou = () => { focus = false; traitClavier = null; relancer(); };
  const surTouche = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      if (type !== 'encre') return;
      e.preventDefault(); gouttes = J.ajouterGoutte(gouttes, curseur[0], curseur[1], rng); relancer(); return;
    }
    const c = J.deplacerCurseur(curseur, e.key, e.shiftKey ? 0.05 : 0.025);
    if (!c) return;
    e.preventDefault(); geste();
    if (trace && !e.shiftKey) {
      if (!traitClavier) traitClavier = nouveauTrait(curseur[0], curseur[1], 0.016);
      etendre(traitClavier, c[0], c[1], 0.016, 0.001);
    } else traitClavier = null;
    curseur = c; attirerSansMouvement(); relancer();
  };
  const surRelache = (e) => { if (e.key.startsWith('Arrow') || e.key === 'Shift') traitClavier = null; };

  const ecoutes = [['pointerdown', surBas], ['pointermove', surDeplacement], ['pointerup', surHaut], ['pointercancel', surHaut], ['pointerleave', surSortie], ['focus', surFocus], ['blur', surFlou], ['keydown', surTouche], ['keyup', surRelache]];
  for (const [n, f] of ecoutes) canvas.addEventListener(n, f);
  const surVisibilite = () => { if (document.hidden) arreterBoucle(); else relancer(); };
  document.addEventListener('visibilitychange', surVisibilite);
  const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (visible && dimensionner()) dessiner(); }) : null;
  obs?.observe(canvas);

  return Object.freeze({
    afficher() { visible = true; dimensionner(); relancer(); dessiner(); },
    masquer() { visible = false; actif = null; traitClavier = null; ciblee = false; arreterBoucle(); },
    effacer() { traits = []; gouttes = []; if (visible) dessiner(); },
    auto() { // un cercle presque fermé au centre de la scène
      if (type !== 'enso') return;
      traits = [...traits, J.ensoAuto(0.5, J.HAUTEUR / 2, 0.22 + rng() * 0.04)].slice(-J.LIMITES.traitsEnso); if (visible) dessiner();
    },
    detruire() {
      if (detruit) return; detruit = true; visible = false; arreterBoucle();
      document.removeEventListener('visibilitychange', surVisibilite); obs?.disconnect();
      for (const [n, f] of ecoutes) canvas.removeEventListener(n, f);
    },
    etat: () => ({ visible, anime: raf !== 0, traits: traits.length, gouttes: gouttes.length, lucioles: lucioles.length }),
  });
}

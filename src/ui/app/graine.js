// KOTONOHA 2.0 · graine de session des exercices (PH-4). Stockée dans `sessionStorage` : la même session (onglet) garde les mêmes
// ordres d'options après un rechargement ; une nouvelle session en tire d'autres. Sans stockage disponible (navigation privée,
// accès refusé), la graine reste en mémoire pour la durée de la page : rien ne casse, l'ordre change seulement au rechargement.
import { nouvelleGraine } from '../../core/melange.js';

const CLE = 'kotonoha2.graine-session';
let memoire = null;
export function graineSession() {
  try {
    let g = globalThis.sessionStorage?.getItem(CLE);
    if (!g || !/^[0-9a-f]{8}$/.test(g)) { g = nouvelleGraine(); globalThis.sessionStorage?.setItem(CLE, g); }
    return g;
  } catch { return memoire ??= nouvelleGraine(); }
}

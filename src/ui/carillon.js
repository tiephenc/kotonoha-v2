// KOTONOHA 2.0 · carillon de fin de bloc ou de pause (trois sinus qui s'éteignent), partagé par le minuteur et l'écran de pause.
// `contexte` : AudioContext déjà créé (il l'est sur un geste, ou à la première fin) ; `volume` entre 0 et 1.
export function sonnerCarillon(contexte, volume) {
  try {
    if (!contexte) return;
    if (contexte.state === 'suspended') { const r = contexte.resume(); if (r && typeof r.catch === 'function') r.catch(() => {}); }
    const t = contexte.currentTime;
    for (const [f, v] of [[660, 0.25], [990, 0.12], [1320, 0.06]]) {
      const o = contexte.createOscillator(), g = contexte.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * volume), t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(contexte.destination); o.start(t); o.stop(t + 1.7);
    }
  } catch (e) { /* le carillon est un confort */ }
}

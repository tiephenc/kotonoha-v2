// KOTONOHA 2.0 · synthèse vocale du navigateur : seulement sur action, désactivable, état « indisponible » sans voix japonaise.
export const synthese = () => globalThis.speechSynthesis ?? null;
/** Une voix japonaise est-elle installée ? */
export function voixJaponaise() {
  const s = synthese();
  if (!s || typeof s.getVoices !== 'function') return null;
  return s.getVoices().find((v) => /^ja\b/i.test(v.lang)) ?? null;
}
/** Prévient quand la liste des voix change (elle se remplit de façon asynchrone). */
export function surVoix(f) {
  const s = synthese();
  if (!s || !s.addEventListener) return () => {};
  s.addEventListener('voiceschanged', f);
  return () => s.removeEventListener('voiceschanged', f);
}
/** Lit des phrases à la suite. @param {string[]} phrases @param {{fin?: () => void, erreur?: () => void}} o @returns {() => void} arrêt */
export function lire(phrases, { fin = () => {}, erreur = () => {} } = {}) {
  const s = synthese(), voix = voixJaponaise();
  if (!s || !voix) { erreur(); return () => {}; }
  s.cancel();
  let arrete = false;
  phrases.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ja-JP'; try { u.voice = voix; } catch { /* voix simulée : la langue suffit */ }
    if (i === phrases.length - 1) u.onend = () => { if (!arrete) fin(); };
    u.onerror = () => { if (!arrete) { arrete = true; erreur(); } };
    s.speak(u);
  });
  return () => { arrete = true; s.cancel(); };
}

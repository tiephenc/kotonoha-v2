// KOTONOHA 2.0 · design system — comportements de C-BTN et C-FLD (06 §4.1, §4.3). Script classique :
// window.KDS = { action, saisieJaponaise, erreurChamp }.
(function (g) {
  'use strict';
  /** C-BTN : action sans double déclenchement ; libellé conservé, aria-busy pendant l'action. */
  function action(btn, run) {
    btn.addEventListener('click', async (e) => {
      if (btn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      btn.setAttribute('aria-disabled', 'true'); btn.setAttribute('aria-busy', 'true');
      try { await run(e); } finally { btn.removeAttribute('aria-busy'); btn.removeAttribute('aria-disabled'); }
    });
  }
  /** C-FLD, saisie japonaise : Entrée pendant une composition IME ne soumet jamais ; validation après compositionend. */
  function saisieJaponaise(input, submit) {
    let composing = false;
    Object.assign(input, { lang: 'ja', autocapitalize: 'off', autocomplete: 'off', spellcheck: false });
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocomplete', 'off');
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      // keyCode 229 : touche traitée par l'IME (Safari émet keydown après compositionend)
      if (composing || e.isComposing || e.keyCode === 229) return;
      e.preventDefault(); submit(input.value);
    });
  }
  /** C-FLD, erreur : bordure + icône + message qui dit comment corriger, lié par aria-describedby. */
  function erreurChamp(input, message) {
    const id = input.id + '-erreur';
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('p'); el.id = id; el.className = 'fld-erreur'; input.insertAdjacentElement('afterend', el); }
    const ids = new Set((input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    if (message) {
      el.textContent = ''; const ico = document.createElement('span'); ico.className = 'fld-erreur-icone'; ico.setAttribute('aria-hidden', 'true'); ico.textContent = '✗';
      const txt = document.createElement('span'); txt.textContent = message; el.append(ico, txt); el.hidden = false; input.setAttribute('aria-invalid', 'true'); ids.add(id); }
    else { el.textContent = ''; el.hidden = true; input.removeAttribute('aria-invalid'); ids.delete(id); }
    if (ids.size) input.setAttribute('aria-describedby', [...ids].join(' ')); else input.removeAttribute('aria-describedby');
  }
  g.KDS = Object.freeze({ action, saisieJaponaise, erreurChamp });
})(window);

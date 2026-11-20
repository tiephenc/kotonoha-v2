// KOTONOHA 2.0 · design system — lot 2 : comportements de C-LNK, C-CHK, C-NOTE, C-SYNC et C-PROG (06 §4.2, §4.4,
// §4.14 à §4.16). Script classique chargé après composants.js : window.KDS (figé) est remplacé par une copie
// figée qui ajoute les fonctions du lot 2, sans toucher à celles du lot 1.
(function (g) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const NB = ' '; // espace insécable avant « : » et « ; »

  // Formes (viewBox 0 0 20 20, tracé au trait). Chaque état a une forme propre : la couleur ne fait que s'y ajouter.
  const FORMES = Object.freeze({
    succes: 'M3.5 10.5l4.2 4.2L16.5 5.5',
    avertissement: 'M10 2.8 18 16.8H2zM10 8v4M10 14.4v.2',
    erreur: 'M10 2.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15zM7 7l6 6M13 7l-6 6',
    info: 'M10 2.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15zM10 9v5M10 6v.2',
    fermer: 'M5 5l10 10M15 5 5 15',
    externe: 'M8 4H4v12h12v-4M11 3h6v6M17 3l-8 8',
  });
  const TYPES = Object.freeze({ succes: 'Succès', avertissement: 'Attention', erreur: 'Erreur', info: 'Information' });

  /** Icône décorative (aria-hidden) : la forme est dessinée, la couleur est héritée. */
  function icone(d, classe = 'kds-icone') {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 20 20'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false'); s.setAttribute('class', classe);
    const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p);
    return s;
  }
  const contenu = (el, c) => { if (c == null) return; if (typeof c === 'string') el.textContent = c; else el.append(c); };

  // ---------------------------------------------------------------- C-LNK
  /** Lien externe : rel="noopener noreferrer", icône (masquée aux TA) et mention visible « (nouvel onglet) » si target=_blank. */
  function lienExterne(a) {
    a.classList.add('lnk');
    const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean)); rel.add('noopener'); rel.add('noreferrer');
    a.setAttribute('rel', [...rel].join(' '));
    if (a.target === '_blank' && !a.querySelector('.lnk-mention')) { const m = document.createElement('span'); m.className = 'lnk-mention'; m.textContent = ' (nouvel onglet)'; a.append(m); }
    if (!a.querySelector('.lnk-externe-icone')) a.append(icone(FORMES.externe, 'kds-icone lnk-externe-icone'));
    return a;
  }

  // ---------------------------------------------------------------- C-CHK
  /** Nom accessible approché (aria-labelledby, aria-label, texte non masqué, label for) : sert au contrôle d'usage. */
  function nomAccessible(el) {
    const lb = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim();
    if (lb) return lb;
    const al = (el.getAttribute('aria-label') || '').trim(); if (al) return al;
    let t = '';
    const lire = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) t += c.data; else if (c.nodeType === 1 && c.getAttribute('aria-hidden') !== 'true') lire(c); } };
    lire(el);
    if (t.trim()) return t.trim();
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) return l.textContent.trim(); }
    return '';
  }
  /** Interrupteur : <button role="switch" aria-checked>. Nom accessible obligatoire (06 §4.4) : refus explicite sinon.
   *  L'état est montré par la position du curseur et par un signe (coche, texte « Activé » / « Désactivé »). */
  function interrupteur(btn, surChangement) {
    if (btn.tagName !== 'BUTTON' || btn.getAttribute('role') !== 'switch') throw new TypeError('C-CHK : <button role="switch"> attendu');
    if (!nomAccessible(btn)) throw new TypeError(`C-CHK : interrupteur sans nom accessible (${btn.id || 'sans id'})`);
    const signe = btn.querySelector('.sw-etat');
    const rendre = () => { const on = btn.getAttribute('aria-checked') === 'true'; if (signe) signe.textContent = on ? 'Activé' : 'Désactivé'; return on; };
    if (btn.getAttribute('aria-checked') !== 'true') btn.setAttribute('aria-checked', 'false');
    rendre();
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      btn.setAttribute('aria-checked', String(btn.getAttribute('aria-checked') !== 'true'));
      const on = rendre(); if (surChangement) surChangement(on);
    });
    return { get actif() { return btn.getAttribute('aria-checked') === 'true'; } };
  }

  // ---------------------------------------------------------------- C-NOTE
  /** Note : icône (forme propre au type, nommée pour les TA) + texte + couleur fonctionnelle. */
  function note({ type = 'info', texte, actions = [], classe = '' } = {}) {
    if (!TYPES[type]) throw new TypeError(`C-NOTE : type inconnu (${type})`);
    const el = document.createElement('div'); el.className = ('note ' + classe).trim(); el.dataset.type = type;
    const ico = document.createElement('span'); ico.className = 'note-icone'; ico.setAttribute('role', 'img'); ico.setAttribute('aria-label', TYPES[type]);
    ico.append(icone(FORMES[type]));
    const txt = document.createElement('p'); txt.className = 'note-texte'; contenu(txt, texte);
    el.append(ico, txt);
    if (actions.length) {
      const z = document.createElement('div'); z.className = 'note-actions';
      for (const a of actions) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-discret'; b.textContent = a.libelle; b.addEventListener('click', a.run); z.append(b); }
      el.append(z);
    }
    return el;
  }
  /** Rend le focus à un élément connu, sinon au conteneur (tabindex=-1), quand la note qui le portait disparaît. */
  function rendreFocus(cible, repli) {
    const c = cible && cible.isConnected ? cible : repli;
    if (!c) return;
    if (c === repli && !c.hasAttribute('tabindex')) c.setAttribute('tabindex', '-1');
    c.focus();
  }
  /** Toast : 5 s, 10 s s'il porte une action [Hyp] ; pause au survol et au focus ; Échap le ferme.
   *  Annoncé par la région role="status" #kds-toasts, présente dans la page dès le chargement. */
  function toast(texte, { type = 'succes', action = null, duree, pile = document.getElementById('kds-toasts') } = {}) {
    if (!pile || pile.getAttribute('role') !== 'status') throw new Error('C-NOTE : région des toasts (role="status") absente');
    const ms = duree ?? (action ? 10000 : 5000);
    const raisons = new Set();
    let reste = ms, debut = 0, minuteur = 0, retour = null;
    const el = note({ type, texte, classe: 'note-toast', actions: action ? [{ libelle: action.libelle, run: () => { action.run(); fermer(); } }] : [] });
    function lancer() { debut = Date.now(); minuteur = setTimeout(fermer, reste); }
    function suspendre(r) { raisons.add(r); if (minuteur) { clearTimeout(minuteur); minuteur = 0; reste -= Date.now() - debut; } }
    function reprendre(r) { raisons.delete(r); if (!raisons.size && !minuteur && el.isConnected) lancer(); }
    function fermer() {
      clearTimeout(minuteur); minuteur = 0;
      if (!el.isConnected) return;
      const avaitFocus = el.contains(document.activeElement);
      el.remove();
      if (avaitFocus) rendreFocus(retour, document.querySelector('main'));
    }
    el.addEventListener('mouseenter', () => suspendre('survol'));
    el.addEventListener('mouseleave', () => reprendre('survol'));
    el.addEventListener('focusin', (e) => { if (!el.contains(e.relatedTarget)) retour = e.relatedTarget; suspendre('focus'); });
    el.addEventListener('focusout', (e) => { if (!el.contains(e.relatedTarget)) reprendre('focus'); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermer(); });
    while (pile.children.length >= 3) pile.firstElementChild.remove();
    pile.append(el); lancer();
    return { element: el, fermer };
  }
  /** Bannière : état persistant. role="alert" à l'apparition seulement, puis statique (06 §4.14) ;
   *  fermable ou non (ET-25 et ET-26 ne le sont pas tant que l'état dure). */
  function banniere(conteneur, { type = 'erreur', texte, fermable = false, actions = [], retour = null, id, delaiStatique = 1000 } = {}) {
    if (id) { const ancien = document.getElementById(id); if (ancien) ancien.remove(); }
    const el = note({ type, texte, actions, classe: 'note-banniere' });
    if (id) el.id = id;
    el.setAttribute('role', 'alert');
    function fermer() { const avaitFocus = el.contains(document.activeElement); el.remove(); if (avaitFocus) rendreFocus(retour, conteneur); }
    if (fermable) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-outil note-fermer'; b.setAttribute('aria-label', 'Fermer l’avis');
      b.append(icone(FORMES.fermer)); b.addEventListener('click', fermer); el.append(b);
    }
    conteneur.append(el);
    setTimeout(() => el.removeAttribute('role'), delaiStatique);
    return { element: el, fermer };
  }
  /** Message en ligne (retour de formulaire ou d'exercice) : écrit dans la zone role="status" #<id>-retour, qui existe
   *  dès le chargement, et lié à la cible par aria-describedby. Texte vide : message effacé, lien retiré. */
  function messageEnLigne(cible, { type = 'info', texte = '' } = {}) {
    const zone = document.getElementById(cible.id + '-retour');
    if (!zone || zone.getAttribute('role') !== 'status') throw new Error(`C-NOTE : zone #${cible.id}-retour (role="status") absente`);
    zone.textContent = '';
    const ids = new Set((cible.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    if (texte) { zone.append(note({ type, texte, classe: 'note-ligne' })); ids.add(zone.id); } else ids.delete(zone.id);
    if (ids.size) cible.setAttribute('aria-describedby', [...ids].join(' ')); else cible.removeAttribute('aria-describedby');
  }

  // ---------------------------------------------------------------- C-SYNC
  const actions = (n) => (n === 1 ? '1 action' : `${n} actions`);
  /** États ET-20 à ET-27 (04 §12.2, 08 §7.7), plus ET-19 (suppression du compte arrivée à son terme, 08 §19.11 : la synchronisation
   *  s'arrête). Libellés courts et détails repris de 04 et 08 ; une forme par état. */
  const SYNC_ETATS = Object.freeze({
    'ET-19': Object.freeze({ nom: 'Suppression du compte', forme: 'M4 5.5h12M8 5.5V3.5h4v2M5.6 5.5l.8 11h7.2l.8-11M8.4 8.5v5M11.6 8.5v5',
      libelle: () => 'Suppression du compte', detail: () => `La suppression de votre compte est en cours${NB}: plus rien n’est synchronisé. Ce qui est enregistré sur cet appareil y reste${NB}; vous pouvez l’exporter.`,
      actions: Object.freeze([['exporter', 'Exporter maintenant']]) }),
    'ET-20': Object.freeze({ nom: 'Local', forme: 'M6.5 2.5h7a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 16V4a1.5 1.5 0 0 1 1.5-1.5zM8.5 14.5h3',
      libelle: () => 'Sur cet appareil', detail: () => 'Votre travail est enregistré sur cet appareil seulement. Créez un compte pour le retrouver ailleurs.' }),
    'ET-21': Object.freeze({ nom: 'Réconciliation', forme: 'M16 10a6 6 0 0 1-10.4 4.1M4 10a6 6 0 0 1 10.4-4.1M14.6 2.6v3.5h-3.5M5.4 17.4v-3.5h3.5',
      libelle: () => 'Mise à jour…', detail: () => `Rien n’est retiré de l’écran${NB}; vous pouvez travailler.` }),
    'ET-22': Object.freeze({ nom: 'À jour', forme: 'M10 2.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15zM6.6 10.2l2.3 2.3 4.5-4.7',
      libelle: (p) => (p.verifie === false ? 'Envoyé · vérification en attente' : `Synchronisé${p.heure ? ' ' + p.heure : ''}`),
      detail: (p) => (p.verifie === false ? `Vos actions sont envoyées${NB}; la vérification complète n’a pas encore eu lieu.` : `Dernière vérification complète${p.heure ? ' à ' + p.heure : ''}.`) }),
    'ET-23': Object.freeze({ nom: 'Hors ligne', forme: 'M6 15.5h8a3.5 3.5 0 0 0 .6-6.95A5 5 0 0 0 5.2 8.6 3.5 3.5 0 0 0 6 15.5zM3 3l14 14',
      libelle: () => 'Hors ligne', detail: () => 'Vos actions sont enregistrées sur cet appareil.' }),
    'ET-24': Object.freeze({ nom: 'En attente', forme: 'M10 2.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 1 1 0-15zM10 5.8v4.4l2.9 1.9',
      libelle: (p) => `${p.n ?? 0} en attente`, detail: (p) => `${actions(p.n ?? 0)} en attente d’envoi.` }),
    'ET-25': Object.freeze({ nom: 'Session expirée', forme: 'M5 9h10v8.5H5zM7 9V6.5a3 3 0 0 1 6 0V9M10 12.3v2.2',
      libelle: () => 'Reconnexion requise', detail: (p) => ((p.n ?? 0) === 1 ? 'Reconnectez-vous pour envoyer votre action.' : `Reconnectez-vous pour envoyer vos ${actions(p.n ?? 0)}.`) }),
    'ET-26': Object.freeze({ nom: 'Mise à jour requise', forme: 'M3.5 3.5h13v13h-13zM10 14V6.6M6.9 9.6 10 6.5l3.1 3.1',
      libelle: () => 'Mise à jour requise', detail: () => 'Une version plus récente de KOTONOHA a été utilisée sur un autre appareil. Vos nouvelles actions sont enregistrées sur cet appareil et seront envoyées après la mise à jour.' }),
    'ET-27': Object.freeze({ nom: 'Erreur', forme: 'M10 2.8 18 16.8H2zM10 8.2v3.6M10 14.2v.2',
      libelle: () => 'Erreur d’envoi', detail: (p) => p.message || 'L’envoi a échoué. Vos actions restent sur cet appareil, la file est conservée.',
      actions: Object.freeze([['exporter', 'Exporter maintenant'], ['reessayer', 'Réessayer']]) }),
  });
  const syncIcone = (code) => icone(SYNC_ETATS[code].forme, 'kds-icone sync-icone');
  /** Indicateur de synchronisation. Le libellé court est aussi dans le nom accessible (« Synchronisation : … »), ce qui
   *  le garde lisible sous 400 px où il est masqué à l'écran. Les changements sont annoncés par une région
   *  aria-live="polite" séparée, seulement si l'état dure au moins `delaiAnnonce` (2 s [Hyp]) et diffère du dernier
   *  état annoncé : la Réconciliation brève (ET-21 → ET-22 en moins de 2 s) n'est jamais annoncée. */
  function sync(btn, { panneau, region, etat = 'ET-20', params = {}, delaiAnnonce = 2000, actions: rappels = {} } = {}) {
    if (!region || region.getAttribute('aria-live') !== 'polite') throw new Error('C-SYNC : région aria-live="polite" attendue');
    if (btn.contains(region) || (panneau && panneau.contains(region))) throw new Error('C-SYNC : la région d’annonce doit être séparée du bouton et du panneau');
    btn.textContent = '';
    const prefixe = document.createElement('span'); prefixe.className = 'kds-masque'; prefixe.textContent = `Synchronisation${NB}: `;
    const lib = document.createElement('span'); lib.className = 'sync-libelle';
    let ico = syncIcone(etat);
    btn.append(ico, prefixe, lib);
    if (panneau) { btn.setAttribute('aria-controls', panneau.id); btn.setAttribute('aria-expanded', 'false'); panneau.hidden = true; }
    let courant = etat, annonce = etat, minuteur = 0, libelleCourant = '';
    function rendre(code, p) {
      const d = SYNC_ETATS[code];
      btn.dataset.etat = code;
      const nouvelle = syncIcone(code); ico.replaceWith(nouvelle); ico = nouvelle;
      libelleCourant = d.libelle(p); lib.textContent = libelleCourant;
      if (!panneau) return;
      panneau.dataset.etat = code; panneau.textContent = '';
      const t = document.createElement('p'); t.className = 'sync-panneau-etat'; t.append(syncIcone(code), document.createTextNode(libelleCourant));
      const det = document.createElement('p'); det.className = 'sync-panneau-detail'; det.textContent = d.detail(p);
      const z = document.createElement('div'); z.className = 'sync-panneau-actions';
      for (const [cle, texte] of d.actions || []) { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-secondaire'; b.textContent = texte; b.addEventListener('click', () => rappels[cle] && rappels[cle]()); z.append(b); }
      panneau.append(t, det, z);
    }
    function changer(code, p = {}) {
      if (!SYNC_ETATS[code]) throw new RangeError(`C-SYNC : état inconnu (${code})`);
      courant = code; rendre(code, p);
      clearTimeout(minuteur);
      minuteur = setTimeout(() => { if (courant !== annonce) { region.textContent = `Synchronisation${NB}: ${libelleCourant}`; annonce = courant; } }, delaiAnnonce);
    }
    const ouvert = () => panneau && !panneau.hidden;
    function basculer(ouvrir) { if (!panneau) return; panneau.hidden = !ouvrir; btn.setAttribute('aria-expanded', String(ouvrir)); }
    btn.addEventListener('click', () => basculer(!ouvert()));
    // Échap écouté sur le document : Safari ne donne pas le focus à un bouton cliqué, le focus peut donc être ailleurs.
    const echap = (e) => { if (e.key === 'Escape' && ouvert()) { e.preventDefault(); basculer(false); btn.focus(); } };
    if (panneau) {
      document.addEventListener('keydown', echap);
      document.addEventListener('pointerdown', (e) => { if (ouvert() && !panneau.contains(e.target) && !btn.contains(e.target)) basculer(false); });
    }
    rendre(etat, params); // état initial : affiché, pas annoncé (ce n'est pas un changement)
    return { changer, get etat() { return courant; }, fermer: () => basculer(false) };
  }

  // ---------------------------------------------------------------- C-PROG
  /** Barre de séquence : role="progressbar", aria-valuenow/max, aria-valuetext et texte visible identiques. */
  function progression(barre, n, max, { unite = 'Activité' } = {}) {
    const v = Math.max(0, Math.min(n, max));
    const texte = `${unite} ${v} sur ${max}`;
    barre.setAttribute('role', 'progressbar');
    barre.setAttribute('aria-valuemin', '0'); barre.setAttribute('aria-valuemax', String(max)); barre.setAttribute('aria-valuenow', String(v)); barre.setAttribute('aria-valuetext', texte);
    const t = barre.dataset.texte && document.getElementById(barre.dataset.texte); if (t) t.textContent = texte;
    const r = barre.querySelector('.prog-rempli'); if (r) r.style.width = (max ? (v / max) * 100 : 0) + '%';
    return v;
  }
  const NIVEAUX = Object.freeze(['Peu de preuves', 'Quelques preuves', 'Nombreuses preuves']);
  /** Niveau de confiance : trois points (pleins jusqu'au niveau) et le texte du niveau (04 §8.3). */
  function confiance(el, niveau) {
    const k = Math.max(1, Math.min(3, niveau));
    el.classList.add('prog-confiance'); el.dataset.niveau = String(k); el.textContent = '';
    const pts = document.createElement('span'); pts.className = 'prog-points'; pts.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i++) pts.append(document.createElement('i'));
    const t = document.createElement('span'); t.textContent = NIVEAUX[k - 1];
    el.append(pts, t);
  }

  g.KDS = Object.freeze({ ...(g.KDS || {}), FORMES, TYPES, SYNC_ETATS, NIVEAUX, icone, lienExterne, interrupteur, note, toast, banniere, messageEnLigne, sync, syncIcone, progression, confiance });
})(window);

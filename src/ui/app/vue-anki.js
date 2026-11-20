// KOTONOHA 2.0 · écran « Fiches Anki » : révision quotidienne des cartes importées, paquets et imports, import d'un fichier Anki
// (analyse, résumé, confirmation, écriture atomique, contrôle, bilan), recherche, journal d'import.
// L'import n'écrit jamais dans le journal d'étude : il écrit dans la base du corpus (infra/anki-store.js), après une copie de
// sécurité vérifiée de la progression KOTONOHA. Une révision de carte = une opération `answer` du journal (sujet `anki:…`).
import { h, brut, NB } from './dom.js';
import { bouton, note, lien } from './composants-app.js';
import { ankiDe } from './anki-etat.js';
import { champSur } from './anki-rendu.js';
import { sauvegardeComplete, telecharger, nomSauvegarde } from './sauvegarde.js';
import { importerPaquet, P1 } from '../../infra/import/import.js';
import { backupJournal, verifyBackup } from '../../infra/backup.js';
import { newId } from '../../core/ids.js';
import { sha256 } from '../../core/canon.js';
import { analyserImport, identifierCartes, preparerSeanceAnki, statistiques, facesCarte, texteBrut, sujetCarte, jourLocal, NOUVELLES_PAR_JOUR, MATURE_JOURS } from '../../core/anki.js';
import { hashPour } from './routeur.js';

const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);
const pl = (n, s, p = `${s}s`) => `${fmt(n)}${NB}${n > 1 ? p : s}`;
const date = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const JAPONAIS = /[぀-ヿ㐀-鿿]/u;
const MESSAGES = {
  P1: `Fichier trop volumineux (plus de ${P1 / 1e6}${NB}Mo). Exportez depuis Anki sans les médias.`,
  'sans-collection': 'Ce fichier ne contient pas de collection Anki : choisissez un fichier .apkg ou .colpkg exporté par Anki.',
  'zip-invalide': 'Ce fichier n’est pas une archive Anki lisible (fichier abîmé ou incomplet).',
  chiffre: 'Ce fichier est chiffré : Anki n’exporte pas ainsi ; refaites l’export.',
  decompression: 'Le contenu du fichier n’a pas pu être décompressé : le fichier est probablement abîmé ou incomplet.',
  'base-invalide': 'La base contenue dans ce fichier n’est pas une collection Anki lisible.',
  P2: 'La collection décompressée est trop volumineuse pour être importée sur cet appareil.',
};

export function vueAnki(ctx) {
  const A = ankiDe(ctx), j = ctx.journal;
  const racine = h('div', { class: 'vue vue-anki' });
  const zRev = h('div', { class: 'anki-revision', 'aria-live': 'polite' });
  const zPaquets = h('div', { id: 'anki-paquets-liste' });
  const zImport = h('div', { id: 'anki-import-zone', 'aria-live': 'polite' });
  const zChercher = h('div', { id: 'anki-resultats' });
  const zJournal = h('div', { id: 'anki-journal-liste' });
  const fichier = h('input', { type: 'file', id: 'anki-fichier', accept: '.apkg,.colpkg,application/zip,application/octet-stream', hidden: true, tabindex: '-1' });
  let actif = true, analyseEnCours = null, choixPaquet = '';

  // ——— Révision ———
  async function rendreRevision() {
    const c = await A.corpus(); if (!actif) return;
    if (!c.items.length) {
      zRev.replaceChildren(h('p', { id: 'anki-a-revoir' }, c.versions.length
        ? 'Toutes vos fiches importées sont retirées de la révision (imports annulés). Elles sont conservées : vous pouvez rétablir un import ci-dessous.'
        : 'Aucune fiche Anki importée pour l’instant. Importez votre collection ci-dessous : vos cartes et leur progression seront reprises.'));
      return;
    }
    const paquets = [...new Set(c.items.map((i) => i.paquet))].sort();
    if (choixPaquet && !paquets.includes(choixPaquet)) choixPaquet = '';
    const s = preparerSeanceAnki(c.items, ctx.maintenant(), { paquet: choixPaquet || null });
    const choix = h('select', { id: 'anki-paquet-choix', class: 'fld-input' }, h('option', { value: '' }, 'Tous les paquets'), ...paquets.map((p) => { const o = h('option', { value: p }, brut(p)); if (p === choixPaquet) o.selected = true; return o; }));
    choix.addEventListener('change', () => { choixPaquet = choix.value; rendreRevision(); });
    const bloque = !j.canStartActivity();
    zRev.replaceChildren(
      h('p', { id: 'anki-a-revoir' }, s.total ? `${pl(s.dues.length, 'fiche')} à revoir aujourd’hui${s.nouvelles.length ? `, ${pl(s.nouvelles.length, 'nouvelle')} proposée${s.nouvelles.length > 1 ? 's' : ''}` : ''}.` : 'Rien à revoir aujourd’hui dans ces fiches.'),
      h('div', { class: 'fld' }, h('label', { class: 'fld-label', for: 'anki-paquet-choix' }, 'Paquet'), choix),
      bloque ? note({ type: 'avertissement', texte: 'Des actions précédentes ne sont pas encore enregistrées. Exportez-les ou réessayez depuis le bandeau avant de commencer.' }) : null,
      s.total ? h('div', { class: 'barre-actions' }, bouton('Commencer la révision', 'btn-principal', async () => lancer(s))) : null,
      h('p', { class: 'aide-courte' }, `Les échéances viennent d’Anki, puis de vos réponses ici. Au plus ${NOUVELLES_PAR_JOUR} nouvelles fiches par jour. Vous pouvez arrêter à tout moment : rien n’est perdu.`));
  }

  function lancer(s) {
    if (!j.canStartActivity()) { ctx.echec(Object.assign(new Error('actions en attente'), { code: 'blocked' })); return; }
    const file = [...s.dues, ...s.nouvelles].map((it) => ({ it, reprise: false }));
    let i = 0, justes = 0, faites = 0;
    const repris = new Set();
    const fin = (arret) => {
      const t = h('h3', { tabindex: '-1' }, arret ? 'Révision arrêtée' : 'Révision terminée');
      zRev.replaceChildren(t, h('p', { class: 'ex-score' }, faites ? `${pl(faites, 'fiche')} revue${faites > 1 ? 's' : ''}, ${fmt(justes)} bien rappelée${justes > 1 ? 's' : ''}.` : 'Aucune fiche revue.'),
        arret ? h('p', { class: 'aide-courte' }, 'Les fiches restantes vous attendent, sans retard compté.') : null,
        h('div', { class: 'barre-actions' }, bouton('Retour aux fiches', 'btn-principal', async () => { await rendreRevision(); zRev.querySelector('button, a')?.focus(); })));
      t.focus(); rendrePaquets();
    };
    const montrer = () => {
      if (!actif) return;
      if (i >= file.length) { fin(false); return; }
      const { it } = file[i];
      const f = facesCarte(it.note, it.modele, it.carte.ord);
      const titre = h('h3', { tabindex: '-1', class: 'anki-progres' }, `Fiche ${fmt(i + 1)} sur ${fmt(file.length)}`);
      const face = (liste, revele) => h('div', { class: 'anki-face' }, ...liste.map((x) => { const d = h('div', { class: 'anki-champ' }); if (JAPONAIS.test(texteBrut(x.valeur))) d.lang = 'ja'; d.append(champSur(x.valeur, { filtre: x.filtre, trou: f.cloze, revele })); return d; }));
      const etiquette = it.etat.statut === 'nouvelle' ? 'Nouvelle fiche' : it.etat.statut === 'apprentissage' ? 'En cours d’apprentissage' : 'À revoir';
      const zoneReponse = h('div', { class: 'anki-reponse' });
      const arreter = bouton('Arrêter', 'btn-tertiaire', async () => fin(true));
      const afficher = bouton('Afficher la réponse', 'btn-principal', async () => {
        const l = A.liens(it).liens;
        const lecons = [...new Set(l.map((x) => x.unite))].sort((a, b) => a - b);
        zoneReponse.replaceChildren(h('hr', { class: 'anki-separation' }), face(f.verso, true),
          lecons.length ? h('p', { class: 'aide-courte' }, 'Dans les leçons : ', ...lecons.flatMap((n, k) => [k ? ', ' : '', lien(hashPour('lecon', n), `leçon ${n}`)]), '.') : null,
          h('p', { class: 'aide-courte', id: 'anki-question-note' }, 'Vous en souveniez-vous ?'),
          h('div', { class: 'barre-actions', role: 'group', 'aria-labelledby': 'anki-question-note' },
            bouton('À revoir', 'btn-secondaire', async () => noter(false)), bouton('Je savais', 'btn-principal', async () => noter(true))));
        afficher.remove();
        zoneReponse.querySelector('.barre-actions .btn-principal')?.focus();
      });
      const noter = async (ok) => {
        try {
          const r = await j.record('answer', it.sujet, { ok, ctx: 'pratique', fmt: 'anki' });
          if (!r.saved) ctx.signaler('Votre réponse n’a pas pu être enregistrée sur cet appareil ; elle est gardée en attente (voir le bandeau).');
        } catch (e) { ctx.echec(e); return; }
        faites++; if (ok) justes++;
        // Une fiche manquée revient une fois en fin de séance (rappel après un délai), puis le lendemain.
        if (!ok && !repris.has(it.sujet)) { repris.add(it.sujet); file.push({ it, reprise: true }); }
        i++; montrer();
      };
      zRev.replaceChildren(titre, h('p', { class: 'anki-etiquette' }, brut(it.paquet), ` · ${etiquette}`), face(f.recto, false), h('div', { class: 'barre-actions' }, afficher, arreter), zoneReponse);
      titre.focus();
    };
    montrer();
  }

  // ——— Paquets et imports ———
  async function rendrePaquets() {
    const c = await A.corpus(); if (!actif) return;
    if (!c.versions.length) { zPaquets.replaceChildren(h('p', {}, 'Aucun paquet importé.')); return; }
    const par = new Map(); for (const it of c.items) (par.get(it.paquet) || par.set(it.paquet, []).get(it.paquet)).push(it);
    const maintenant = ctx.maintenant();
    const lignes = [...par.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([nom, items]) => {
      const s = statistiques(items, maintenant);
      return h('li', { class: 'anki-paquet' }, h('h3', {}, brut(nom)),
        h('p', {}, `${pl(s.cartes, 'fiche')} : ${fmt(s.maitrisees)} maîtrisée${s.maitrisees > 1 ? 's' : ''}, ${fmt(s.revision - s.maitrisees + s.apprentissage)} en cours, ${pl(s.nouvelles, 'nouvelle')}${s.suspendues ? `, ${pl(s.suspendues, 'suspendue')}` : ''}.`),
        h('p', { class: 'aide-courte' }, `${s.dues ? `${pl(s.dues, 'fiche')} à revoir aujourd’hui. ` : ''}Historique Anki : ${pl(s.revisionsAnki, 'révision')}${s.reponsesKotonoha ? ` ; ici : ${pl(s.reponsesKotonoha, 'réponse')}` : ''}.`));
    });
    const versions = [...c.versions].sort((a, b) => b.importeLe - a.importeLe).map((v) => h('li', { class: 'anki-version', dataset: { version: v.id.slice(0, 12) } },
      h('p', {}, h('strong', {}, brut(v.nomFichier || 'fichier Anki')), ` · importé le ${date(v.importeLe)} · ${pl(v.compte.notes, 'note')}, ${pl(v.compte.cartes, 'carte')}, ${pl(v.compte.revisions, 'révision')}${v.masque ? ' · import annulé (données conservées)' : ''}`),
      h('div', { class: 'barre-actions' }, v.masque
        ? bouton('Rétablir cet import', 'btn-secondaire', async () => masquer(v, false))
        : bouton('Annuler cet import', 'btn-tertiaire', async () => masquer(v, true)))));
    zPaquets.replaceChildren(h('ul', { class: 'anki-paquets' }, ...lignes),
      h('h3', {}, 'Imports'), h('ul', { class: 'anki-versions' }, ...versions),
      h('p', { class: 'aide-courte' }, `« Maîtrisée » : intervalle de révision d’au moins ${MATURE_JOURS}${NB}jours (carte « mûre » dans Anki). Annuler un import retire ses fiches de la révision sans rien effacer ; vos réponses restent dans votre progression, et l’import peut être rétabli.`));
  }
  async function masquer(v, on) {
    try {
      const st = await A.store(), t = Date.now();
      await st.masquer(v.id, on, { id: newId('ku', 'imp', t), t, action: on ? 'annulation' : 'retablissement', version: v.id });
      A.invalider();
      ctx.notifier(on ? 'Import annulé : ses fiches ne sont plus proposées. Rien n’a été effacé.' : 'Import rétabli.', 'succes');
      await Promise.all([rendreRevision(), rendrePaquets(), rendreJournal()]);
    } catch (e) { ctx.signaler(`L’opération a échoué${NB}: ${e.message}. Rien n’a été modifié.`); }
  }

  // ——— Import ———
  const btnChoisir = bouton('Choisir un fichier Anki…', 'btn-principal', async () => { fichier.click(); });
  fichier.addEventListener('change', async () => { const f = fichier.files[0]; fichier.value = ''; if (f) await analyser(f); });

  async function existant() {
    const b = await A.brut(), c = await A.corpus();
    const actives = new Set(b.versions.filter((v) => !b.masques.has(v.id)).map((v) => v.id));
    const notes = new Map(b.notes.filter((n) => actives.has(n.version)).map((n) => [`${n.version}|${n.id}`, n]));
    const ligVer = new Map(b.versions.map((v) => [v.id, v.lignee]));
    const guidsPar = new Map();
    for (const n of notes.values()) { const l = ligVer.get(n.version); (guidsPar.get(l) || guidsPar.set(l, new Set()).get(l)).add(n.guid); }
    const connues = b.cartes.filter((x) => actives.has(x.version)).map((x) => { const n = notes.get(`${x.version}|${x.nid}`); return { cle: x.cle, lignee: x.lignee, id: x.id, guid: n?.guid ?? null, ord: x.ord, mid: n?.mid ?? null }; });
    const reponses = new Map([...c.reponses.entries()].map(([k, v]) => [k, v.length]));
    return { versions: b.versions.filter((v) => actives.has(v.id)), lignees: b.lignees.map((l) => ({ id: l.id, nom: l.nom, guids: guidsPar.get(l.id) || new Set() })), connues, reponses };
  }

  async function analyser(f) {
    const etat = h('p', { role: 'status', class: 'chargement', id: 'anki-import-etat' }, h('span', { class: 'chargement-trait', 'aria-hidden': 'true' }), 'Lecture du fichier…');
    zImport.replaceChildren(etat);
    analyseEnCours = null;
    const format = /\.colpkg$/i.test(f.name) ? 'collection complète (.colpkg)' : /\.apkg$/i.test(f.name) ? 'paquet (.apkg)' : 'fichier sans extension Anki';
    let res;
    try {
      res = await importerPaquet(f, { mode: 'complet', onProgress: ({ octets }) => { etat.lastChild.textContent = `Lecture du fichier… ${fmt(Math.round(octets / 1e5) / 10)}${NB}Mo décompressés`; } });
    } catch (e) {
      zImport.replaceChildren(note({ type: 'erreur', texte: `${MESSAGES[e.code] || `Lecture impossible${NB}: ${e.message}.`} Rien n’a été importé ni modifié.` }));
      return;
    }
    const ex = await existant();
    const a = analyserImport({ donnees: res.donnees, meta: res, existant: ex, index: A.index(), maintenant: ctx.maintenant() });
    if (!a.ok) { zImport.replaceChildren(note({ type: 'erreur', texte: `Import refusé${NB}: ${a.erreurs.join(' ; ')}. Rien n’a été importé ni modifié.` })); return; }
    const titre = h('h3', { id: 'anki-resume-titre', tabindex: '-1' }, 'Résumé avant import');
    const base = res.entree === 'collection.anki21b' ? 'base récente (Anki 2.1.50 ou plus)' : res.entree === 'collection.anki21' ? 'base Anki 2.1' : 'base Anki ancienne';
    const e = a.etats;
    const sig = a.signalements;
    const corr = a.correspondances;
    const proposition = a.lignee && !a.lignee.sousLeSeuil ? a.lignee : null;
    const radioNv = h('input', { type: 'radio', name: 'anki-lignee', id: 'anki-lignee-nv', value: 'version', class: 'chk-input' }), radioNouv = h('input', { type: 'radio', name: 'anki-lignee', id: 'anki-lignee-nouv', value: 'nouveau', class: 'chk-input' });
    radioNv.checked = true;
    const blocs = [titre, h('p', {}, h('strong', {}, brut(f.name)), ` · ${format}, ${base}.`)];
    blocs.push(h('ul', { class: 'anki-resume' },
      h('li', {}, `${pl(a.notes, 'note')}, ${pl(a.cartes, 'carte')}${a.paquets.length ? ` ; paquet${a.paquets.length > 1 ? 's' : ''} : ` : ''}`, ...a.paquets.flatMap((p, k) => [k ? ', ' : '', brut(p)])),
      h('li', {}, a.planificationPresente
        ? `Progression récupérable : ${pl(e.maitrisees, 'carte maîtrisée', 'cartes maîtrisées')}, ${fmt(e.revision - e.maitrisees + e.apprentissage)} en cours, ${pl(e.nouvelles, 'nouvelle')}${e.suspendues ? `, ${pl(e.suspendues, 'suspendue')}` : ''} ; ${pl(e.duesAujourdhui, 'carte')} à revoir aujourd’hui, ${fmt(e.aVenir)} plus tard.`
        : 'Ce fichier ne contient aucune progression : cartes toutes nouvelles, aucun historique. Si vous avez étudié ce paquet dans Anki, réexportez-le avec « Inclure la planification » (ou en collection complète .colpkg) pour reprendre votre progression.'),
      h('li', {}, a.revisions ? `Historique : ${pl(a.revisions, 'entrée')} de révision${a.periode ? `, du ${date(a.periode.debut)} au ${date(a.periode.fin)}` : ''}, conservées telles quelles.` : 'Historique de révision : aucun dans ce fichier.'),
      h('li', {}, a.dejaConnues ? `${pl(a.dejaConnues, 'carte')} déjà connue${a.dejaConnues > 1 ? 's' : ''} ici : même fiche, même progression, sans doublon${a.reponsesKotonohaExistantes ? ` ; vos ${pl(a.reponsesKotonohaExistantes, 'réponse')} dans KOTONOHA sont gardées` : ''}.` : 'Aucune de ces cartes n’est encore dans KOTONOHA.'),
      corr ? h('li', {}, `Correspondances avec les leçons : ${pl(corr.liees, 'note')} rattachée${corr.liees > 1 ? 's' : ''} (${fmt(corr.parType.vocabulaire)} vocabulaire, ${fmt(corr.parType.kanji)} kanji), ${fmt(corr.sans)} sans correspondance (gardée${corr.sans > 1 ? 's' : ''} et révisable${corr.sans > 1 ? 's' : ''} ici), ${fmt(corr.ambigues)} ambiguë${corr.ambigues > 1 ? 's' : ''} non rattachée${corr.ambigues > 1 ? 's' : ''}.`) : h('li', {}, 'Correspondances avec les leçons : calculées quand le contenu des leçons est chargé.'),
      a.identite.aRapprocher || sig.guidEnDouble || sig.cartesOrphelines || sig.revisionsSansCarte || sig.notesSansCarte
        ? h('li', {}, `À signaler : ${[a.identite.aRapprocher && `${pl(a.identite.aRapprocher, 'carte')} à rapprocher (identifiant déjà pris par une autre carte : gardée${a.identite.aRapprocher > 1 ? 's' : ''} à part)`, sig.guidEnDouble && `${pl(sig.guidEnDouble, 'GUID')} en double (notes gardées séparément)`, sig.cartesOrphelines && `${pl(sig.cartesOrphelines, 'carte')} sans note`, sig.notesSansCarte && `${pl(sig.notesSansCarte, 'note')} sans carte`, sig.revisionsSansCarte && `${pl(sig.revisionsSansCarte, 'révision')} sans carte`].filter(Boolean).join(' ; ')}. Tout est conservé.`)
        : h('li', {}, 'Aucun conflit ni donnée ambiguë dans les identifiants.'),
      h('li', {}, `Non importé : ${res.entreesMedias ? `${pl(res.entreesMedias, 'fichier')} média (sons, images), ` : ''}la mise en forme et les scripts des modèles de cartes. Les champs, étiquettes, identifiants et valeurs de planification sont gardés bruts.`)));
    if (a.dejaImporte) {
      blocs.push(note({ type: 'info', texte: `Ce fichier est déjà importé (le ${date(a.versionExistante.importeLe)}) : l’importer de nouveau n’aurait aucun effet. Rien n’est modifié.` }));
      zImport.replaceChildren(...blocs); titre.focus(); return;
    }
    if (proposition) blocs.push(h('fieldset', { class: 'anki-lignee' }, h('legend', {}, 'Ce fichier contient surtout des fiches déjà importées'),
      h('label', { class: 'chk chk-radio', for: 'anki-lignee-nv' }, radioNv, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', {}, 'Nouvelle version de « ', brut(proposition.nom), ` » (${pl(proposition.communs, 'fiche')} en commun) : la progression continue`)),
      h('label', { class: 'chk chk-radio', for: 'anki-lignee-nouv' }, radioNouv, h('span', { class: 'chk-boite', 'aria-hidden': 'true' }), h('span', {}, 'Paquet distinct : ses fiches ont leur propre progression'))));
    blocs.push(h('p', {}, 'L’import ajoute ces fiches sans rien retirer. Votre progression KOTONOHA n’est pas modifiée : une copie de sécurité vérifiée est faite avant ; si elle échoue, l’import n’a pas lieu.'),
      h('div', { class: 'barre-actions' },
        bouton('Importer ces fiches', 'btn-principal', async () => { await ecrire(f, res, a, proposition && radioNv.checked ? proposition : null); }),
        bouton('Annuler', 'btn-secondaire', async () => { analyseEnCours = null; zImport.replaceChildren(h('p', { role: 'status' }, 'Import annulé. Rien n’a été modifié.')); btnChoisir.focus(); })));
    analyseEnCours = { f, res, a };
    zImport.replaceChildren(...blocs);
    titre.focus();
  }

  async function ecrire(f, res, a, versionDe) {
    if (!analyseEnCours) return;
    const t = Date.now(), d = res.donnees;
    const st = await A.store();
    try {
      // 1. Copie de sécurité vérifiée de la progression KOTONOHA (le journal n'est pas touché par l'import, mais il est protégé).
      const { text } = await backupJournal(j, t, 'avant-import-anki');
      const bak = newId('ku', 'bak', t);
      await j.store.putBackup({ id: bak, kind: 'avant-import-anki', at: t, text });
      const relu = (await j.store.listBackups()).find((x) => x.id === bak);
      if (!relu || !(await verifyBackup(relu.text)).ok) throw Object.assign(new Error('copie de sécurité illisible'), { code: 'backup-check' });
      // 2. Lignée et identité des cartes (recalculées au moment d'écrire, sur l'état présent).
      const ex = await existant();
      if (ex.versions.some((v) => v.id === res.empreinteBase)) { zImport.replaceChildren(note({ type: 'info', texte: 'Ce fichier vient d’être importé : rien de plus à faire.' })); return; }
      const nomPaquet = (() => { const n = new Map(); for (const c of d.cartes) n.set(c.did, (n.get(c.did) || 0) + 1); const did = [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0]; return d.paquets.find((p) => p.id === did)?.nom || f.name.replace(/\.(apkg|colpkg)$/i, ''); })();
      const ligneeExistante = versionDe ? (await A.brut()).lignees.find((l) => l.id === versionDe.id) : null;
      const lignee = ligneeExistante || { id: newId('ku', 'lin', t), nom: nomPaquet, creeLe: t };
      const ident = identifierCartes(d, ex.connues, res.empreinteBase, lignee.id);
      const v = res.empreinteBase;
      const version = { id: v, lignee: lignee.id, nomFichier: f.name, octets: f.size, importeLe: t, schema: d.schema, crt: d.crt, entree: res.entree, entreesMedias: res.entreesMedias, modeles: d.modeles, paquets: d.paquets, compte: { notes: d.notes.length, cartes: d.cartes.length, revisions: d.revisions.length }, empreinteGuids: res.empreinteGuids };
      const notes = d.notes.map((n) => ({ k: `${v}|${n.id}`, version: v, ...n }));
      const cartes = d.cartes.map((c) => ({ k: `${v}|${c.id}`, version: v, ...c, ...ident.carte.get(c.id) }));
      const revisions = d.revisions.map((r) => ({ k: `${v}|${r.id}`, version: v, ...r }));
      const entree = { id: newId('ku', 'imp', t), t, action: 'import', version: v, lignee: lignee.id, nouvelleLignee: !ligneeExistante, fichier: f.name, notes: notes.length, cartes: cartes.length, revisions: revisions.length, dejaConnues: ident.parIdentifiant + ident.parGuidRang, aRapprocher: ident.aRapprocher.length, copieSecurite: bak };
      // 3. Écriture atomique (marque « en cours » retirée par la même transaction).
      await st.marquerEnCours({ t, fichier: f.name });
      await st.ajouterVersion({ version, lignee, notes, cartes, revisions, entree });
      // 4. Contrôle : relecture des nombres et des GUID.
      const r = await st.relire(v);
      const tri = (x) => [...x].sort().join('\n');
      const ok = r.notes === notes.length && r.cartes === cartes.length && r.revisions === revisions.length && (await sha256(tri(r.guids))) === (await sha256(tri(d.notes.map((n) => n.guid))));
      await st.ajouterJournal({ id: newId('ku', 'imp', Date.now()), t: Date.now(), action: ok ? 'controle-reussi' : 'controle-echoue', version: v, relu: { notes: r.notes, cartes: r.cartes, revisions: r.revisions } });
      A.invalider(); analyseEnCours = null;
      const c = await A.corpus();
      const etats = statistiques(c.items.filter((it) => cartes.some((x) => sujetCarte(x.lignee, x.cle) === it.sujet)), ctx.maintenant());
      const titre = h('h3', { tabindex: '-1', id: 'anki-bilan-titre' }, ok ? 'Import terminé et vérifié' : 'Import écrit, contrôle en échec');
      zImport.replaceChildren(titre,
        ok ? note({ type: 'succes', texte: `${pl(r.notes, 'note')}, ${pl(r.cartes, 'carte')} et ${pl(r.revisions, 'révision')} relues dans la base de cet appareil, identifiants intacts.` })
          : note({ type: 'erreur', texte: `La relecture ne correspond pas (${fmt(r.notes)} notes, ${fmt(r.cartes)} cartes relues). Créez une sauvegarde et signalez-le ; rien n’a été retiré.` }),
        h('p', {}, `Progression reprise : ${fmt(etats.maitrisees)} maîtrisée${etats.maitrisees > 1 ? 's' : ''}, ${fmt(etats.revision - etats.maitrisees + etats.apprentissage)} en cours, ${pl(etats.nouvelles, 'nouvelle')} ; ${pl(etats.dues, 'fiche')} à revoir aujourd’hui.`),
        h('p', {}, 'Votre progression KOTONOHA est inchangée ; une copie de sécurité a été faite avant l’import.'),
        h('p', { class: 'aide-courte', id: 'anki-sauv-etat', role: 'status' }, 'Créez maintenant une sauvegarde : elle contient votre progression et vos fiches Anki.'),
        h('div', { class: 'barre-actions' }, bouton('Créer une sauvegarde', 'btn-principal', async () => sauver(zImport.querySelector('#anki-sauv-etat'))), bouton('Réviser mes fiches', 'btn-secondaire', async () => { racine.querySelector('#anki-rev-titre')?.scrollIntoView(); racine.querySelector('.anki-revision button')?.focus(); })));
      titre.focus();
      await Promise.all([rendreRevision(), rendrePaquets(), rendreJournal()]);
    } catch (e) {
      try { await st.effacerMarque(); } catch { /* la marque reste : signalée à la prochaine ouverture */ }
      zImport.replaceChildren(note({ type: 'erreur', texte: e.code === 'deja-importe' ? 'Ce fichier est déjà importé : rien n’a été modifié.' : `L’import a échoué${NB}: ${e.message}. Rien n’a été écrit : l’import est tout ou rien.` }));
    }
  }

  async function sauver(etat) {
    try {
      const { text, backup } = await sauvegardeComplete(ctx);
      telecharger(nomSauvegarde(), text);
      if (etat) etat.textContent = `Sauvegarde vérifiée et téléchargée${NB}: ${fmt(backup.parts.ops.count)} opérations, ${fmt(backup.parts.corpus?.cartes ?? 0)} cartes Anki.`;
      ctx.notifier('Sauvegarde téléchargée.', 'succes');
    } catch (e) { ctx.signaler(`La sauvegarde a échoué${NB}: ${e.message}. Rien n’a été modifié.`); }
  }

  // ——— Recherche ———
  const champ = h('input', { type: 'search', id: 'anki-recherche', class: 'fld-input', autocomplete: 'off' });
  let minut = 0;
  champ.addEventListener('input', () => { clearTimeout(minut); minut = setTimeout(chercher, 200); });
  async function chercher() {
    const q = champ.value.trim().toLowerCase();
    if (!q) { zChercher.replaceChildren(); return; }
    const c = await A.corpus();
    const trouves = c.items.filter((it) => it.note && it.note.champs.some((x) => texteBrut(x).toLowerCase().includes(q)));
    const jour = jourLocal(ctx.maintenant());
    zChercher.replaceChildren(h('p', { role: 'status' }, trouves.length ? `${pl(trouves.length, 'fiche trouvée', 'fiches trouvées')}${trouves.length > 30 ? ' (30 premières affichées)' : ''}.` : 'Aucune fiche trouvée.'),
      h('ul', { class: 'anki-trouves' }, ...trouves.slice(0, 30).map((it) => {
        const f = facesCarte(it.note, it.modele, it.carte.ord), l = A.liens(it).liens, lecons = [...new Set(l.map((x) => x.unite))].sort((a, b) => a - b);
        const e = it.etat;
        const etat = e.statut === 'nouvelle' ? 'nouvelle' : e.statut === 'suspendue' ? 'suspendue dans Anki' : e.maitrisee ? 'maîtrisée' : 'en cours';
        const quand = e.due === null || e.statut === 'nouvelle' || e.statut === 'suspendue' ? '' : e.due <= jour ? ', à revoir aujourd’hui' : `, prochaine révision dans ${pl(e.due - jour, 'jour')}`;
        return h('li', { class: 'anki-trouve' }, h('p', {}, brut(texteBrut(f.recto.map((x) => x.valeur).join(' · ')).slice(0, 120)), ' — ', brut(texteBrut(f.verso.map((x) => x.valeur).join(' · ')).slice(0, 160))),
          h('p', { class: 'aide-courte' }, brut(it.paquet), ` · ${etat}${quand}`, lecons.length ? ' · ' : '', ...lecons.flatMap((n, k) => [k ? ', ' : '', lien(hashPour('lecon', n), `leçon ${n}`)])));
      })));
  }

  // ——— Journal d'import ———
  async function rendreJournal() {
    const st = await A.store(); const e = (await st.journal()).sort((a, b) => b.t - a.t);
    if (!actif) return;
    const libelle = { import: 'Import', annulation: 'Import annulé', retablissement: 'Import rétabli', 'controle-reussi': 'Contrôle après import réussi', 'controle-echoue': 'Contrôle après import en échec', restauration: 'Restauration depuis une sauvegarde' };
    zJournal.replaceChildren(e.length ? h('ul', { class: 'anki-journal' }, ...e.slice(0, 50).map((x) => h('li', {}, `${new Date(x.t).toLocaleString('fr-FR')} · ${libelle[x.action] || x.action}`, x.fichier ? ' · ' : '', x.fichier ? brut(x.fichier) : '', x.action === 'import' ? ` · ${pl(x.cartes, 'carte')}, ${pl(x.revisions, 'révision')}${x.dejaConnues ? `, ${fmt(x.dejaConnues)} déjà connues` : ''}` : ''))) : h('p', {}, 'Aucun import pour l’instant.'));
  }

  racine.append(h('h1', { tabindex: '-1' }, 'Fiches Anki'),
    h('p', {}, 'Vos fiches Anki importées, avec leur progression : maîtrisées, en cours, à revoir. Elles sont enregistrées sur cet appareil, à côté de votre progression KOTONOHA, qu’elles ne modifient pas.'),
    h('section', { class: 'carte', 'aria-labelledby': 'anki-rev-titre' }, h('h2', { id: 'anki-rev-titre' }, 'Réviser'), zRev),
    h('section', { class: 'carte', 'aria-labelledby': 'anki-paq-titre' }, h('h2', { id: 'anki-paq-titre' }, 'Vos paquets'), zPaquets),
    h('section', { class: 'carte', 'aria-labelledby': 'anki-imp-titre' }, h('h2', { id: 'anki-imp-titre' }, 'Importer depuis Anki'),
      h('p', {}, 'Dans Anki sur ordinateur : Fichier › Exporter…, format « Paquet de collection Anki (.colpkg) », sans les médias. Un paquet (.apkg) convient aussi s’il est exporté avec « Inclure la planification ».'),
      h('p', { class: 'aide-courte' }, 'Le fichier est lu sur cet appareil ; il n’est envoyé nulle part. Un même fichier importé deux fois n’a aucun effet.'),
      h('div', { class: 'barre-actions' }, btnChoisir, fichier), zImport),
    h('section', { class: 'carte', 'aria-labelledby': 'anki-che-titre' }, h('h2', { id: 'anki-che-titre' }, 'Retrouver une fiche'),
      h('div', { class: 'fld' }, h('label', { class: 'fld-label', for: 'anki-recherche' }, 'Mot, kanji ou traduction'), champ), zChercher),
    h('section', { class: 'carte', 'aria-labelledby': 'anki-jou-titre' }, h('h2', { id: 'anki-jou-titre' }, 'Journal des imports'), zJournal));

  (async () => {
    try {
      const st = await A.store(), marque = await st.enCours();
      if (marque) { zImport.replaceChildren(note({ type: 'avertissement', texte: `Un import a été interrompu (${String(marque.fichier ?? 'fichier Anki')}) : rien n’a été enregistré. Vous pouvez le relancer.` })); await st.effacerMarque(); }
      await Promise.all([rendreRevision(), rendrePaquets(), rendreJournal()]);
    } catch (e) { zRev.replaceChildren(note({ type: 'erreur', texte: `Les fiches Anki n’ont pas pu être lues sur cet appareil${NB}: ${e.message}.` })); }
  })();
  return { cle: 'anki', titre: 'Fiches Anki', element: racine, maj: () => {}, fin: () => { actif = false; } };
}

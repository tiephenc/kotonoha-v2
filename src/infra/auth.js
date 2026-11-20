// KOTONOHA 2.0 · MOD-13 infra/auth — compte par adresse et mot de passe (Q-24), Firebase
// Authentication par l'API REST (D-13 par défaut). Règles : mot de passe de 15 caractères au moins
// (D-108 corrigée ; la politique côté serveur est à configurer et à constater, V-AUTH-01) ; jetons
// jamais dans `localStorage`, une adresse ou un journal (SEC-02, D-100) : ils vont dans le magasin
// fourni (IndexedDB de la base du compte) ; un échec de renouvellement n'entraîne jamais de bascule
// silencieuse en local (SEC-01) : l'erreur porte le code 'auth' et l'état « session expirée ».
// La clé d'API de Firebase est publique par conception ; elle figure dans l'adresse, pas le jeton.

export const MIN_PASSWORD = 15;
const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';
const TOKEN = 'https://securetoken.googleapis.com/v1/token';
const err = (code, message) => Object.assign(new Error(message), { code });

/** Messages d'erreur du fournisseur, traduits (sans révéler si une adresse existe). */
const MESSAGES = {
  EMAIL_EXISTS: 'Impossible de créer ce compte avec cette adresse.',
  INVALID_LOGIN_CREDENTIALS: 'Adresse ou mot de passe incorrect.',
  INVALID_PASSWORD: 'Adresse ou mot de passe incorrect.',
  EMAIL_NOT_FOUND: 'Adresse ou mot de passe incorrect.',
  USER_DISABLED: 'Ce compte est désactivé.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Trop de tentatives : réessayez dans quelques minutes.',
  WEAK_PASSWORD: `Le mot de passe doit compter au moins ${MIN_PASSWORD} caractères.`,
  PASSWORD_DOES_NOT_MEET_REQUIREMENTS: `Le mot de passe doit compter au moins ${MIN_PASSWORD} caractères.`,
  INVALID_EMAIL: 'Adresse électronique invalide.',
};

/** Contrôle local du mot de passe (D-108) ; le serveur doit appliquer la même règle (V-AUTH-01). */
export function checkPassword(p) {
  if (typeof p !== 'string' || [...p].length < MIN_PASSWORD) return `Le mot de passe doit compter au moins ${MIN_PASSWORD} caractères.`;
  return null;
}

/**
 * @param {{apiKey: string, fetch?: typeof fetch, now?: () => number, storage?: {get: () => Promise<any>, set: (s: any) => Promise<void>, clear: () => Promise<void>}}} o
 */
export function firebaseAuth({ apiKey, fetch: f = globalThis.fetch.bind(globalThis), now = () => Date.now(), storage = null }) {
  if (!/^[A-Za-z0-9_-]{20,60}$/.test(apiKey)) throw new Error('clé d’API invalide');
  let session = null, refreshing = null;

  async function post(url, body, form = false) {
    let res;
    try { res = await f(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }); } catch { throw err('offline', 'réseau indisponible'); }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    const raw = String(json.error?.message || '').split(' ')[0].split(':')[0];
    if (res.status >= 500 || (res.status === 429 && raw !== 'TOO_MANY_ATTEMPTS_TRY_LATER')) throw err('offline', 'service indisponible');
    throw Object.assign(err(raw === 'TOKEN_EXPIRED' || raw === 'INVALID_REFRESH_TOKEN' || raw === 'USER_NOT_FOUND' || raw === 'USER_DISABLED' ? 'auth' : 'refused', MESSAGES[raw] || 'Opération refusée par le service de comptes.'), { provider: raw });
  }
  const save = async (s) => { session = s; if (storage) await storage.set(s); return { uid: s.uid, email: s.email }; };
  const fromSignIn = (r) => ({ uid: r.localId, email: r.email, idToken: r.idToken, refreshToken: r.refreshToken, expiresAt: now() + Number(r.expiresIn) * 1000 });

  return {
    async restore() { session = storage ? (await storage.get()) || null : session; return session ? { uid: session.uid, email: session.email, expired: !session.refreshToken } : null; },
    async signUp(email, password) {
      const p = checkPassword(password);
      if (p) throw err('refused', p);
      return save(fromSignIn(await post(`${ID}:signUp?key=${apiKey}`, { email, password, returnSecureToken: true })));
    },
    async signIn(email, password) { return save(fromSignIn(await post(`${ID}:signInWithPassword?key=${apiKey}`, { email, password, returnSecureToken: true }))); },
    /** Jeton valide, renouvelé une minute avant son expiration ; un seul renouvellement à la fois. */
    async getToken() {
      if (!session?.refreshToken) throw err('auth', 'reconnectez-vous');
      if (session.expiresAt - now() > 60_000) return session.idToken;
      refreshing ||= (async () => {
        try {
          const r = await post(`${TOKEN}?key=${apiKey}`, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, true);
          await save({ ...session, idToken: r.id_token, refreshToken: r.refresh_token, expiresAt: now() + Number(r.expires_in) * 1000 });
        } catch (e) {
          // Session close : jetons oubliés, identité gardée pour la bannière « Reconnectez-vous ».
          if (e.code === 'auth') await save({ uid: session.uid, email: session.email, idToken: null, refreshToken: null, expiresAt: 0 });
          throw e;
        } finally { refreshing = null; }
      })();
      await refreshing;
      return session.idToken;
    },
    get uid() { return session?.uid || null; },
    /** Déconnexion locale : jetons effacés ; les données de l'appareil restent (T-AUTH-04). */
    async signOut() { session = null; if (storage) await storage.clear(); },
  };
}

/** Magasin de session dans la base IndexedDB du compte (clé `session` de `meta`). @param {any} store */
export const sessionStorageOf = (store) => ({ get: () => store.getMeta('session'), set: (s) => store.setMeta('session', s), clear: () => store.setMeta('session', null) });

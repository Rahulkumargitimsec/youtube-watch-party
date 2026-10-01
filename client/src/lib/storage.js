// localStorage can throw (private mode, blocked storage) — never let that break the app.
const safe = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const storage = {
  // The session token proves "I am this user" to the server after a refresh.
  getToken: (roomId) => safe.get(`wp:token:${roomId}`),
  setToken: (roomId, token) => safe.set(`wp:token:${roomId}`, token),
  clearToken: (roomId) => safe.remove(`wp:token:${roomId}`),

  // Logged-in account: { token (JWT), user: { id, name, email } }
  getAuth: () => {
    try {
      const value = JSON.parse(safe.get('wp:auth'));
      return value?.token && value?.user ? value : null;
    } catch {
      return null;
    }
  },
  setAuth: (session) => (session ? safe.set('wp:auth', JSON.stringify(session)) : safe.remove('wp:auth')),
};

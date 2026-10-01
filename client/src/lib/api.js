// Empty in dev/production (same origin). Set VITE_SERVER_URL only when the backend
// lives on a different domain (e.g. frontend on Netlify, backend on Render).
export const SERVER_URL = import.meta.env.VITE_SERVER_URL?.replace(/\/$/, '') || '';

// Login token (JWT), set by AuthProvider. Sent as `Authorization: Bearer <token>`.
let authToken = null;
export const setAuthToken = (token) => {
  authToken = token;
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${SERVER_URL}/api${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0, 'NETWORK');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error?.message || `Request failed (${res.status})`, res.status, body.error?.code);
  return body;
}

const post = (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) });

export const api = {
  // Requires login: the server takes the host's name from the account.
  createRoom: ({ roomName, videoUrl }) => post('/rooms', { roomName, videoUrl }),
  getRoom: (roomId) => request(`/rooms/${encodeURIComponent(roomId)}`),

  signup: ({ name, email, password }) => post('/auth/signup', { name, email, password }),
  login: ({ email, password }) => post('/auth/login', { email, password }),
  me: () => request('/auth/me'),
};

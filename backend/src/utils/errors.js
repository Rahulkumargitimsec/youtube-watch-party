/**
 * An expected, user-facing error. The socket layer turns it into
 * `{ ok: false, error: { code, message } }` and the REST layer into a 4xx response.
 */
export class RoomError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

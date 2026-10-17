/** An error that carries an HTTP status; safe to show its message to the caller. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Document") => new HttpError(404, `${what} not found.`);
export const conflict = (msg: string) => new HttpError(409, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = "Not allowed.") => new HttpError(403, msg);

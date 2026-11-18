// Application errors. `code` is a short machine-readable reason and `message`
// is the sentence shown to the person.
export class AppError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details = null) {
  throw new AppError(code, message, details);
}

// @ts-check

export class AppError extends Error {
  /** @type {string} */
  code;

  /** @type {number} */
  status;

  /** @type {Record<string, unknown>} */
  details;

  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status=400]
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

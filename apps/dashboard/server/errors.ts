/** Typed errors crossing the local API boundary. Erasable-syntax only (Node runs this TypeScript natively). */
export interface ParamErrorDetail {
  field: string;
  message: string;
  allowed?: string[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ParamErrorDetail | undefined;

  constructor(status: number, code: string, message: string, details?: ParamErrorDetail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): { error: { code: string; message: string; details?: ParamErrorDetail } } {
    return this.details
      ? { error: { code: this.code, message: this.message, details: this.details } }
      : { error: { code: this.code, message: this.message } };
  }
}

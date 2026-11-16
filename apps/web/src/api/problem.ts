export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Array<{ field: string; message: string }>;
};

export class ProblemError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly fieldErrors: Array<{ field: string; message: string }>;

  constructor(problem: ProblemDetails | undefined, fallback: string, status = 0) {
    const detail = problem?.detail || problem?.title || fallback;
    super(detail);
    this.name = 'ProblemError';
    this.status = problem?.status ?? status;
    this.detail = detail;
    this.fieldErrors = problem?.errors ?? [];
  }
}

export function isProblem(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.type === 'string' &&
    typeof record.title === 'string' &&
    typeof record.status === 'number'
  );
}

const UNREACHABLE = 'The service could not be reached. Check that it is running, then try again.';

/** What to say for a failure that came without a problem document. */
export function statusMessage(status: number): string {
  if (status === 0) return UNREACHABLE;
  if (status === 502 || status === 503 || status === 504) {
    return `The service is not available right now (${status}). Check that it is running, then try again.`;
  }
  return `The request failed (${status}).`;
}

/**
 * Text from a failed response that is safe to show. A proxy answers a dead
 * service with an HTML page; that markup is never shown to the person.
 */
function readableText(text: string, status: number): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || trimmed.length > 300) return statusMessage(status);
  return trimmed;
}

export function toProblemError(error: unknown, response?: Response): ProblemError {
  if (error instanceof ProblemError) return error;
  const status = response?.status ?? 0;
  if (isProblem(error)) return new ProblemError(error, 'The request failed.', error.status);
  // fetch rejects with a TypeError when the service cannot be reached at all.
  if (error instanceof TypeError) return new ProblemError(undefined, UNREACHABLE, status);
  if (error instanceof Error && error.message) {
    return new ProblemError(undefined, readableText(error.message, status), status);
  }
  if (typeof error === 'string' && error.trim()) {
    return new ProblemError(undefined, readableText(error, status), status);
  }
  return new ProblemError(undefined, statusMessage(status), status);
}

export async function problemFromResponse(response: Response): Promise<ProblemError> {
  const text = await response.text();
  if (text.trim()) {
    try {
      const json: unknown = JSON.parse(text);
      if (isProblem(json)) return new ProblemError(json, 'The request failed.', response.status);
    } catch {
      return new ProblemError(undefined, readableText(text, response.status), response.status);
    }
  }
  return new ProblemError(undefined, statusMessage(response.status), response.status);
}

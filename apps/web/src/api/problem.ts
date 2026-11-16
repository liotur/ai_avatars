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

export function toProblemError(error: unknown, response?: Response): ProblemError {
  if (error instanceof ProblemError) return error;
  if (isProblem(error)) return new ProblemError(error, 'The request failed.', error.status);
  if (error instanceof Error && error.message) {
    return new ProblemError(undefined, error.message, response?.status ?? 0);
  }
  if (typeof error === 'string' && error.trim()) {
    return new ProblemError(undefined, error.trim(), response?.status ?? 0);
  }
  const fallback = response
    ? `The request failed (${response.status}).`
    : 'The request could not be completed. Check your connection and try again.';
  return new ProblemError(undefined, fallback, response?.status ?? 0);
}

export async function problemFromResponse(response: Response): Promise<ProblemError> {
  const text = await response.text();
  if (text.trim()) {
    try {
      const json: unknown = JSON.parse(text);
      if (isProblem(json)) return new ProblemError(json, 'The request failed.', response.status);
    } catch {
      return new ProblemError(undefined, text.trim(), response.status);
    }
  }
  return new ProblemError(undefined, `The request failed (${response.status}).`, response.status);
}

import { getAssistantStatus, type AssistantStatus } from '@avatars/contracts/assistant';
import { assistantApiUrl } from './config';
import { ProblemError, toProblemError } from './problem';

export const ASSISTANT_STATUS_KEY = ['assistant-status'] as const;

/** Whether the assistant has a language model to answer with, and which one. */
export async function fetchAssistantStatus(): Promise<AssistantStatus> {
  const result = await getAssistantStatus({ baseUrl: assistantApiUrl });
  if (result.error) throw toProblemError(result.error, result.response);
  if (!result.data) {
    throw new ProblemError(undefined, 'The assistant status could not be read.', result.response?.status ?? 0);
  }
  return result.data;
}

import {
  createAvatar,
  deleteAvatar,
  getAvatar,
  listAvatars,
  updateAvatar,
  type Avatar,
  type AvatarCreate,
  type AvatarUpdate,
} from '@avatars/contracts/avatar';
import { avatarApiUrl } from './config';
import { ProblemError, toProblemError } from './problem';

type FieldResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

function unwrap<T>(result: FieldResult<T>, emptyMessage: string): T {
  if (result.error) throw toProblemError(result.error, result.response);
  if (result.data === undefined) {
    throw new ProblemError(undefined, emptyMessage, result.response?.status ?? 0);
  }
  return result.data;
}

export async function fetchAvatars(): Promise<Avatar[]> {
  const result = await listAvatars({ baseUrl: avatarApiUrl });
  return unwrap(result, 'The avatar list could not be read.').items;
}

export async function fetchAvatar(avatarId: string): Promise<Avatar> {
  const result = await getAvatar({ baseUrl: avatarApiUrl, path: { avatarId } });
  return unwrap(result, 'The avatar could not be read.');
}

export async function createAvatarRequest(body: AvatarCreate): Promise<Avatar> {
  const result = await createAvatar({ baseUrl: avatarApiUrl, body });
  return unwrap(result, 'The avatar was not returned.');
}

export async function updateAvatarRequest(avatarId: string, body: AvatarUpdate): Promise<Avatar> {
  const result = await updateAvatar({
    baseUrl: avatarApiUrl,
    path: { avatarId },
    body,
  });
  return unwrap(result, 'The avatar was not returned.');
}

export async function deleteAvatarRequest(avatarId: string): Promise<void> {
  const result = await deleteAvatar({ baseUrl: avatarApiUrl, path: { avatarId } });
  if (result.error) throw toProblemError(result.error, result.response);
}

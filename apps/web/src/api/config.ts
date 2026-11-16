function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const avatarApiUrl = trimSlash(
  import.meta.env.VITE_AVATAR_API_URL || 'http://localhost:3000/v1',
);

export const assistantApiUrl = trimSlash(
  import.meta.env.VITE_ASSISTANT_API_URL || 'http://localhost:3002/v1',
);

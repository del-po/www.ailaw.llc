// Rules shared by the auth pages

export const MIN_PASSWORD = 8;

// Only addresses inside this site are followed after login,
// so a crafted link can't send someone to another website
export function safeReturnUrl(url: string | null, fallback = '/profile'): string {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : fallback;
}

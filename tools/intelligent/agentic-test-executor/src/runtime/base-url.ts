// Canonical runtime base URL handling.
//
// The agent receives a configured application base URL, not a selector or a
// Playwright script. Keep the path semantics intact while making the URL
// representation stable for servers that distinguish /app from /app/.

export function normalizeBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) throw new Error('Agent base URL is required.');

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Agent base URL is invalid: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Agent base URL protocol is not allowed: ${url.protocol}`);
  }

  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

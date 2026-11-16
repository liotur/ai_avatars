/** Remove a secret from text that might be shown or logged. */
export function redact(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

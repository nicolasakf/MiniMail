/** The text that is sent: what the user wrote, then the quoted original if there is one. */
export function composeText(body: string, quoted: string | undefined): string {
  const written = body.trimEnd();
  if (!quoted?.trim()) return body;
  return written ? `${written}\n\n${quoted}` : `\n\n${quoted}`;
}

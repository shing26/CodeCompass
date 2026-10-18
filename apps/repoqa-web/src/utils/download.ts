/**
 * Trigger a browser download for a text payload without leaving the current
 * page: build a Blob URL, click a temporary anchor, then revoke it.
 */
export function downloadTextFile(fileName: string, text: string): void {
  downloadBlob(fileName, text, 'text/markdown;charset=utf-8');
}

/** v1.4 票 07 — same mechanism with an explicit mime (HTML report artifact). */
export function downloadBlob(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
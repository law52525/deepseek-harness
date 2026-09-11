/** Cap for operator-facing Host-failure text and data: error URLs. */
export const DESKTOP_FAILURE_DETAIL_LIMIT = 1200

/**
 * Clip a thrown value so it can go into a data: HTML URL and a log line.
 * Nested `data:text/html` payloads must not be copied — Chromium then rejects
 * the next loadURL, which used to unhandled-reject back into this path and
 * write a multi-GB `desktop-main.log` on the Electron main thread.
 * @param error - any thrown value or an already-stringified detail.
 * @returns a short, data-URL-free string.
 */
export function summarizeDesktopFailure(error: unknown): string {
  const raw = error instanceof Error ? error.stack ?? error.message : String(error)
  const stripped = raw.replace(/data:text\/html[^'"\s]*/g, 'data:text/html…')
  if (stripped.length <= DESKTOP_FAILURE_DETAIL_LIMIT) return stripped
  return `${stripped.slice(0, DESKTOP_FAILURE_DETAIL_LIMIT)}\n…[truncated ${String(stripped.length)} chars]`
}

/** HTML shown in the main window while the Host child is still starting. */
export function hostStartingPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Wandox Work</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem; color: #111; }
    </style>
  </head>
  <body>
    <h1>Starting</h1>
    <p>The desktop Host is starting.</p>
  </body>
</html>
`
}

/**
 * HTML shown when the Host child exits before or after ready.
 * @param detail - short reason shown to the operator.
 * @returns a complete HTML document.
 */
export function hostErrorPage(detail: string): string {
  const escaped = summarizeDesktopFailure(detail)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Wandox Work</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem; color: #111; }
      pre { white-space: pre-wrap; }
    </style>
  </head>
  <body>
      <h1>Host process stopped</h1>
    <p>The desktop Host child exited. This page is terminal. Quit and start the app again — the application is not running.</p>
    <pre>${escaped}</pre>
  </body>
</html>
`
}

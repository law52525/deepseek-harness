/**
 * HTML shown when the Host child exits before or after ready.
 * @param detail - short reason shown to the operator.
 * @returns a complete HTML document.
 */
export function hostErrorPage(detail: string): string {
  const escaped = detail
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Wandox Harness</title>
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

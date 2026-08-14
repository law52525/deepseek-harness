/**
 * The desktop app's command-line provider: it parses `dsh --profile desktop`
 * `--help` and provides the immutable {@link DESKTOP_STARTUP_SERVICE} so
 * dependent rows wait until this invocation is accepted.
 * @module @deepseek-ai/dsh-desktop-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'desktop-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this ordinary plugin and injected by flag-gated rows. */
export const DESKTOP_STARTUP_SERVICE = 'desktopStartup'

/** What the desktop rows read from {@link DESKTOP_STARTUP_SERVICE}: an accepted invocation with no bind flags. */
export interface DesktopStartupValues {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed desktop invocation; absent on `--help` so dependent rows stay pending. */
    desktopStartup: DesktopStartupValues
  }
}

/**
 * This app's command: its description and help text. Desktop takes no bind
 * flags; unknown extra options are usage errors.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function desktopCommand(): Command {
  return new Command()
    .name('dsh --profile desktop')
    .description('Boot the DeepSeek Harness desktop Host without an HTTP listener.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Examples:
  dsh --profile desktop                      boot the desktop Host (no HTTP)
  dsh desktop                                same as --profile desktop
`)
}

/**
 * Parse and provide the desktop invocation as an ordinary Cordis service. The
 * command's action publishes an empty value when the invocation is accepted;
 * on `--help` or a usage error nothing is provided.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = desktopCommand()
  program.action(() => {
    ctx.provide(DESKTOP_STARTUP_SERVICE, {} satisfies DesktopStartupValues)
  })
  parseCmdline(ctx, program)
}

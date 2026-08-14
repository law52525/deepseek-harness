/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * loader holding, module-table seeding, AppRoot gate, plugin assembly — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 * The Electron shell sets `window.__DSH_DESKTOP__` and boots through BootSeams.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { runDesktopBoot, type DesktopRendererHost } from './desktop-boot.ts'

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')

const desktop = (window as Window & { __DSH_DESKTOP__?: DesktopRendererHost }).__DSH_DESKTOP__
if (desktop !== undefined) void runDesktopBoot(el, desktop)
else void new AppWebEntry(el).run()

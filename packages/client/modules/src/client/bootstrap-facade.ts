/**
 * Shared ModuleLoader bootstrap protocol: the inline classic-script text the
 * Host injects into served HTML, and the same installer non-HTTP boots eval
 * before parser-preloading modules and runtime.
 * @module @deepseek-ai/dsh-client-modules/src/client/bootstrap-facade
 */

import type { ClientModuleLoaderTarget, DshWindow } from './manifest.ts'

/** Bootstrap package whose ordinary client bundle supplies the module-system implementation. */
const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules'

/** Dynamic package whose ordinary client bundle must be registered before plugin boot starts. */
const CLIENT_RUNTIME_ID = '@deepseek-ai/dsh-client-runtime'

/** Ordinary dynamic bundles the HTML parser (and desktop renderer boot) execute before the Vite shell. */
export const PARSER_PRELOAD_IDS = [CLIENT_MODULES_ID, CLIENT_RUNTIME_ID] as const

/**
 * Inline classic-script text that installs `window.__ModuleLoader__` in queue
 * mode. Served HTML injects this before the parser-preload `<script src>` tags;
 * desktop evals it before IPC-loading those same bundles.
 * @returns the IIFE source assigned to an index-injection `script` row.
 */
export function bootstrapFacadeScript(): string {
  const bootstrapId = JSON.stringify(CLIENT_MODULES_ID)
  return `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id===${bootstrapId})
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: ${CLIENT_MODULES_ID}/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()`
}

/**
 * Eval {@link bootstrapFacadeScript} onto `window` so later parser-preload
 * bundles can `load()` into the pending queue.
 * @returns the installed queue-mode facade.
 */
export function installBootstrapFacade(): ClientModuleLoaderTarget {
  const win = globalThis as DshWindow
  ;(0, eval)(bootstrapFacadeScript())
  const target = win.__ModuleLoader__
  /* v8 ignore next -- bootstrapFacadeScript always assigns window.__ModuleLoader__ */
  if (target === undefined) {
    throw new Error('client-modules: bootstrap facade script did not install window.__ModuleLoader__')
  }
  return target
}

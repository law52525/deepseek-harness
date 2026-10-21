/** Build-time values that bundlers replace before client code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly [name: `DSH_CLIENT_${string}`]: string | undefined
    /**
     * Desktop packaging inlines the product identity into the welcome renderer
     * and its preloads; other client builds never define them.
     */
    readonly [name: `DSH_DESKTOP_${string}`]: string | undefined
    readonly [name: `DSH_BUNDLE_${string}`]: string | undefined
  }
}

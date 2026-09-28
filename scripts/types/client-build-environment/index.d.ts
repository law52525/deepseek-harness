/** Build-time values that bundlers replace before client code reaches a browser. */
declare const process: {
  readonly env: {
    readonly NODE_ENV?: string
    readonly DSH_BUNDLE_PRODUCT_NAME?: string
    readonly DSH_DESKTOP_PRODUCT_NAME?: string
    readonly [name: `DSH_CLIENT_${string}`]: string | undefined
  }
}

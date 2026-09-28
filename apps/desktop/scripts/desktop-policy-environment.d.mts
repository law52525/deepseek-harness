/** Required deployment-selected metadata for mandatory-update policy requests. */
export interface DesktopPolicyEnvironment {
  origin: string
  allowedPageOrigins: string[]
  allowedAuthOrigins?: string[]
  authentication: 'anonymous' | 'feishu-test'
  path: string
  [key: string]: unknown
}

/**
 * Resolve the policy request pathname. Unset keeps the official `/api/v0/check_client_update`.
 * @param environment File-owned release settings.
 * @returns Absolute pathname with no query or fragment.
 */
export function resolveDesktopMandatoryUpdatePath(environment: NodeJS.ProcessEnv): string

/**
 * Resolve policy settings before artifact preparation or signing.
 * @param environment File-owned release settings; only the selected origin is required.
 * @returns Policy metadata with deployment-selected origin and authentication.
 */
export function resolveDesktopPolicyEnvironment(environment: NodeJS.ProcessEnv): DesktopPolicyEnvironment

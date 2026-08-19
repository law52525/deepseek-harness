// Wandox W mark (same glyph as BrandWordmark). Native 23.16×17.04, rendered
// 24×18 by default; hero usage scales to 34. Color rides currentColor so
// light theme is dark ink and dark theme is white, with no media query.
// Keep this viewBox and the size→height ratio in lockstep; this component
// is also the collapsed-sidebar rail mark.

import type { IconProps } from './icons/props.ts'

/**
 * Render the W logo.
 * @param props.size - width in px (default 24; height keeps the 23.16:17.04 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * 17.04) / 23.16}
      className={className}
      viewBox="0 0 23.16 17.04"
      fill="none"
      aria-hidden="true"
    >
      <path
        transform="matrix(1.095 0 0 1.095 -0.448 -5.211)"
        d="M 0.409 5.581 L 5.602 20.287 L 10.984 11.827 L 16.367 20.287 L 21.56 5.581 A 1.47 1.47 0 0 1 18.738 4.759 L 15.977 17.373 L 10.984 8.888 L 5.992 17.373 L 3.231 4.759 A 1.47 1.47 0 0 1 0.409 5.581 Z"
        fill="currentColor"
      />
    </svg>
  )
}

// Wandox Work brand wordmark: "andox" letterforms + WORK badge plate in one
// svg (the W mark lives in FishLogo, which the sidebar renders separately).
// The badge sits immediately after the andox glyphs. Native width is
// WORDMARK_NATIVE_WIDTH×24; that constant is also the size→width ratio.
// Ink rides currentColor; badge text is knocked out with the inverted label
// token so the plate stays legible in both themes. Do not add
// prefers-color-scheme here — macOS .icns cannot follow it; this SVG is the
// sidebar wordmark, not the app icon.

import type { IconProps } from './icons/props.ts'

/** viewBox width; `width={(size * WORDMARK_NATIVE_WIDTH) / 24}` must match. */
const WORDMARK_NATIVE_WIDTH = 92

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the native ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * WORDMARK_NATIVE_WIDTH) / 24}
      height={size}
      className={className}
      viewBox={`0 0 ${WORDMARK_NATIVE_WIDTH} 24`}
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(-38.304 0)">
        <path d="M40.396 12.496 38.304 12.119Q38.657 10.855 39.518 10.248Q40.38 9.641 42.078 9.641Q43.62 9.641 44.375 10.006Q45.129 10.371 45.437 10.933Q45.745 11.495 45.745 12.996L45.72 15.687Q45.72 16.836 45.831 17.381Q45.941 17.927 46.245 18.55H43.964Q43.874 18.32 43.743 17.869Q43.686 17.664 43.661 17.598Q43.07 18.173 42.398 18.46Q41.725 18.747 40.962 18.747Q39.617 18.747 38.842 18.017Q38.066 17.287 38.066 16.171Q38.066 15.433 38.419 14.854Q38.772 14.276 39.408 13.969Q40.043 13.661 41.241 13.431Q42.857 13.128 43.48 12.865V12.636Q43.48 11.971 43.152 11.688Q42.824 11.405 41.914 11.405Q41.298 11.405 40.954 11.647Q40.609 11.889 40.396 12.496ZM43.48 14.366Q43.038 14.514 42.078 14.719Q41.118 14.924 40.823 15.121Q40.371 15.441 40.371 15.933Q40.371 16.417 40.732 16.77Q41.093 17.123 41.651 17.123Q42.275 17.123 42.841 16.713Q43.259 16.401 43.39 15.95Q43.48 15.654 43.48 14.826Z" fill="currentColor"/>
        <path d="M55.941 18.55H53.636V14.104Q53.636 12.693 53.488 12.279Q53.341 11.864 53.008 11.635Q52.676 11.405 52.209 11.405Q51.61 11.405 51.134 11.733Q50.658 12.061 50.482 12.603Q50.305 13.144 50.305 14.604V18.55H48V9.838H50.141V11.118Q51.282 9.641 53.013 9.641Q53.775 9.641 54.407 9.916Q55.039 10.191 55.363 10.618Q55.687 11.044 55.814 11.586Q55.941 12.127 55.941 13.136Z" fill="currentColor"/>
        <path d="M66.269 18.55H64.128V17.27Q63.595 18.017 62.869 18.382Q62.143 18.747 61.404 18.747Q59.903 18.747 58.833 17.537Q57.762 16.327 57.762 14.161Q57.762 11.946 58.804 10.794Q59.846 9.641 61.437 9.641Q62.897 9.641 63.964 10.855V6.524H66.269ZM60.116 14.005Q60.116 15.4 60.502 16.023Q61.06 16.926 62.061 16.926Q62.856 16.926 63.414 16.249Q63.972 15.572 63.972 14.227Q63.972 12.726 63.43 12.065Q62.889 11.405 62.044 11.405Q61.224 11.405 60.67 12.057Q60.116 12.709 60.116 14.005Z" fill="currentColor"/>
        <path d="M68.008 14.071Q68.008 12.923 68.574 11.848Q69.14 10.773 70.178 10.207Q71.215 9.641 72.495 9.641Q74.472 9.641 75.735 10.925Q76.998 12.209 76.998 14.17Q76.998 16.146 75.723 17.447Q74.447 18.747 72.511 18.747Q71.314 18.747 70.227 18.205Q69.14 17.664 68.574 16.618Q68.008 15.572 68.008 14.071ZM70.37 14.194Q70.37 15.49 70.986 16.179Q71.601 16.868 72.503 16.868Q73.405 16.868 74.017 16.179Q74.628 15.49 74.628 14.178Q74.628 12.898 74.017 12.209Q73.405 11.52 72.503 11.52Q71.601 11.52 70.986 12.209Q70.37 12.898 70.37 14.194Z" fill="currentColor"/>
        <path d="M77.696 18.55 80.837 14.063 77.827 9.838H80.641L82.183 12.234L83.807 9.838H86.514L83.561 13.964L86.785 18.55H83.955L82.183 15.851L80.395 18.55Z" fill="currentColor"/>
      </g>
      {/* WORK plate sits immediately after the andox glyphs. */}
      <g transform="translate(-72.652 0)">
        <rect x="129.348" y="5.5" width="34" height="14" rx="2" fill="currentColor"/>
        <text
          x="146.348"
          y="16.05"
          textAnchor="middle"
          fill="var(--dsw-alias-label-primary-inverted)"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fontSize="9"
          fontWeight="700"
          letterSpacing="0.5"
        >WORK</text>
      </g>
    </svg>
  )
}

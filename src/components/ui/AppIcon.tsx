/**
 * The one icon component. Glyphs are deliberately plain placeholders (simple geometric
 * strokes) so a designer can swap this file for real icons later without touching pages.
 */
export const ICON_NAMES = [
  'home',
  'pipeline',
  'inbox',
  'blueprint',
  'scorecard',
  'platforms',
  'digest',
  'settings',
  'analytics',
  'docs',
  'ai',
  'social',
  'experiments',
  'money',
  'plus',
  'check',
  'close',
  'alert',
  'arrow',
  'menu',
  'download',
  'upload',
  'lock',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const PATHS: Record<IconName, string> = {
  home: 'M4 11 12 4l8 7v9H4z',
  pipeline: 'M4 6h16M4 12h11M4 18h6',
  inbox: 'M4 5h16v14H4zM4 13h5l1 2h4l1-2h5',
  blueprint: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  scorecard: 'M5 19V11M12 19V6M19 19v-5',
  platforms: 'M4 5h16v5H4zM4 14h16v5H4z',
  digest: 'M4 6h16v12H4zM4 6l8 7 8-7',
  settings: 'M12 4v3M12 17v3M4 12h3M17 12h3M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  analytics: 'M4 18l5-6 4 3 7-9',
  docs: 'M7 4h7l4 4v12H7zM14 4v4h4',
  ai: 'M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  social: 'M7 12a2 2 0 1 0 0 .1M17 7a2 2 0 1 0 0 .1M17 17a2 2 0 1 0 0 .1M9 11l6-3M9 13l6 3',
  experiments: 'M9 4h6M10 4v6l-5 9h14l-5-9V4',
  money: 'M4 7h16v10H4zM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l4 4 10-10',
  close: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 3 20h18zM12 10v4M12 17v.1',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
};

export function AppIcon({ name, size = 18, className, label }: { name: IconName; size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

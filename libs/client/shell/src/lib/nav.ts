export interface NavItem {
  label: string;
  /** Short glyph shown in the Dana nav icon tile. */
  glyph: string;
  route: string;
  exact?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Lapping',
    items: [
      { label: 'Cell dashboard', glyph: 'D', route: '/dashboard' },
      { label: 'Lapping summaries', glyph: 'L', route: '/lapping-summaries' },
    ],
  },
  {
    label: 'Master data',
    items: [
      { label: 'Machines', glyph: 'M', route: '/machines' },
      { label: 'Parts & gearsets', glyph: 'P', route: '/parts' },
      { label: 'Part summaries', glyph: 'S', route: '/part-summaries' },
    ],
  },
];

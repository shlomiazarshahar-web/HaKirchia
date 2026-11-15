// Icon set from the approved mockup (stroke icons, 24x24).
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-book" viewBox="0 0 24 24"><path d="M3 5h6a3 3 0 013 3v12a2 2 0 00-2-2H3zM21 5h-6a3 3 0 00-3 3v12a2 2 0 012-2h7z" /></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path d="M7 3h7l5 5v13H7zM14 3v5h5" /></symbol>
      <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></symbol>
      <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 6h6l2 2h10v11H3z" /></symbol>
      <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></symbol>
      <symbol id="i-moon" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></symbol>
      <symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></symbol>
      <symbol id="i-split" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M12 4v16" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></symbol>
      <symbol id="i-master" viewBox="0 0 24 24"><path d="M9 3h10v14M5 7h10v14H5zM8 11h4M8 15h4" /></symbol>
      <symbol id="i-shelf" viewBox="0 0 24 24"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5.5l3.8-1 3 15.3-3.8 1z" /></symbol>
      <symbol id="i-translate" viewBox="0 0 24 24"><path d="M3 5h9M7.5 3v2M5 5c0 4 3 7 6 8M10 5c0 3-2 6-6 8M13 21l4-9 4 9M14.4 18h5.2" /></symbol>
      <symbol id="i-pen" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16zM14 6l3 3" /></symbol>
      <symbol id="i-align-r" viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M10 18h10" /></symbol>
      <symbol id="i-align-l" viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></symbol>
      <symbol id="i-align-c" viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M7 18h10" /></symbol>
      <symbol id="i-align-j" viewBox="0 0 24 24"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" /></symbol>
      <symbol id="i-dir" viewBox="0 0 24 24"><path d="M10 4v12M14 4v12M10 4H8a3 3 0 000 6h2M4 20h16M7 17l-3 3 3 3" /></symbol>
      <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" /></symbol>
      <symbol id="i-redo" viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" /></symbol>
      <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></symbol>
      <symbol id="i-rename" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" /></symbol>
    </svg>
  )
}

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg style={size ? { width: size, height: size } : undefined}>
      <use href={`#i-${name}`} />
    </svg>
  )
}

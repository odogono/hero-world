import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The profile badge: the Character's initial, which opens a menu with who
 * is signed in, Settings and Sign out. Bottom left on a wide screen, in the
 * header on a narrow one.
 */
export const Profile = ({
  admin,
  email,
  name,
  onSignOut
}: {
  admin: boolean;
  email: string | null;
  name: string;
  onSignOut: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLButtonElement>(null);

  // close on a click elsewhere, or Escape, which hands focus back
  useEffect(() => {
    if (!open) {
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        badge.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class="profile" ref={root}>
      {open && (
        <div aria-label="Profile" class="profile-menu" role="menu">
          <div class="profile-who">
            <strong>{name}</strong>
            {email && <span class="profile-email">{email}</span>}
            {admin && <span class="pill">Admin</span>}
          </div>
          <button
            aria-disabled="true"
            class="profile-item"
            role="menuitem"
            title="Nothing to set yet"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="2.25" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
            </svg>
            Settings <span class="soon">soon</span>
          </button>
          <button
            class="profile-item"
            onClick={onSignOut}
            role="menuitem"
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16">
              <path d="M6 2.5H3.5v11H6M10.5 5 13.5 8l-3 3M13.5 8H6.5" />
            </svg>
            Sign out
          </button>
        </div>
      )}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${name}: profile menu`}
        class="badge"
        onClick={() => setOpen(!open)}
        ref={badge}
        type="button"
      >
        {name.trim().charAt(0).toUpperCase() || '?'}
      </button>
    </div>
  );
};

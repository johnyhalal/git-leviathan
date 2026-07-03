import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '../../../../../assets/icons';

interface CollapsibleSectionProps {
  label: string;
  icon: ReactNode;
  /** Optional count shown next to the label (e.g. number of branches). */
  count?: number;
  defaultOpen?: boolean;
  /**
   * Controlled open state. When provided the section is driven by the parent
   * (which also persists it); `onToggle` reports the requested next state.
   */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A sidebar section with a header that toggles its body open/closed. The
 * chevron rotates via the `.is-collapsed` class rather than swapping icons.
 *
 * Uncontrolled by default (`defaultOpen`); pass `open` + `onToggle` to let the
 * parent own and persist the state.
 */
export function CollapsibleSection({
  label,
  icon,
  count,
  defaultOpen = true,
  open: openProp,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setUncontrolledOpen(next);
    onToggle?.(next);
  };

  return (
    <section className="repo-section">
      <button
        type="button"
        className="repo-section-header"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={open ? 'repo-section-chevron' : 'repo-section-chevron is-collapsed'}>
          <ChevronDownIcon size={16} />
        </span>
        <span className="repo-section-icon">{icon}</span>
        <span className="repo-section-label">{label}</span>
        {count !== undefined && <span className="repo-section-count">{count}</span>}
      </button>
      {open && <div className="repo-section-body">{children}</div>}
    </section>
  );
}

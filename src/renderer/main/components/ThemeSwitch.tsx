import { useEffect, useState } from 'react';
import type { ThemeSource } from '../../../types/ipc';

const OPTIONS: { value: ThemeSource; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Segmented control bound to the main process theme preference. */
export function ThemeSwitch() {
  const [source, setSource] = useState<ThemeSource>('system');

  useEffect(() => {
    window.api.theme.get().then((state) => setSource(state.source));
    const unsubscribe = window.api.theme.onChange((state) =>
      setSource(state.source),
    );
    return unsubscribe;
  }, []);

  const choose = async (value: ThemeSource) => {
    const state = await window.api.theme.set(value);
    setSource(state.source);
  };

  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={source === option.value}
          className={source === option.value ? 'active' : undefined}
          onClick={() => void choose(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

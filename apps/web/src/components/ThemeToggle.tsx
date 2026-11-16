import { useState } from 'react';
import { applyTheme, currentTheme, type Theme } from '../theme';
import { Icon } from './Icon';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className="icon-button"
      onClick={() => {
        applyTheme(next, true);
        setTheme(next);
      }}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      <span className="visually-hidden">Switch to {next} theme</span>
    </button>
  );
}

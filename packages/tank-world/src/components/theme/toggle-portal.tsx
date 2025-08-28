import { createPortal } from 'react-dom';

import { ThemeToggleButton } from './toggle-button';

export const ThemeTogglePortal = () => (
  <div>{createPortal(<ThemeToggleButton />, document.body)}</div>
);

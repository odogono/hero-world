import { ReactNode, useCallback, useEffect, useState } from 'react';

import { ThemeContext } from './context';
import type { Theme } from './types';

type ThemeProviderProps = {
  children: ReactNode;
};

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [theme, setTheme] = useState<Theme>(() => {
    // Check if theme was previously saved
    const savedTheme = localStorage.getItem('theme');
    // Check user's system preference if no saved theme
    if (!savedTheme) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    return savedTheme as Theme;
  });

  useEffect(() => {
    // Update document class when theme changes
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

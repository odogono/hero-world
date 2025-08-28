import { StrictMode } from 'react';

import { createRoot } from 'react-dom/client';

import './index.css';

import { ThemeProvider } from '@contexts/theme';

import Main from './screens/main';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Main />
    </ThemeProvider>
  </StrictMode>
);

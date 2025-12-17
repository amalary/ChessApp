'use client';

import type { ReactNode } from 'react';
import { Auth0Provider } from '@auth0/nextjs-auth0/client';
import { ThemeProvider } from '@/components/ThemeProvider';

type ProvidersProps = {
  children: ReactNode;
  user?: Parameters<typeof Auth0Provider>[0]['user'];
};

export function Providers({ children, user }: ProvidersProps) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <Auth0Provider user={user}>{children}</Auth0Provider>
    </ThemeProvider>
  );
}

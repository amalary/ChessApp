import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { auth0 } from '@/lib/auth0';

export const metadata: Metadata = {
  title: 'Terrible App Chess',
  description: 'AI-assisted chess puzzle solving, training, and analytics.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let user: Parameters<typeof Providers>[0]['user'];

  try {
    const session = await auth0.getSession();
    user = session?.user;
  } catch {
    user = undefined;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <div className="app-container">
          <Providers user={user}>{children}</Providers>
        </div>
      </body>
    </html>
  );
}

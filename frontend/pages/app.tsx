import type { AppProps } from 'next/app';
import { Auth0Provider } from '@auth0/nextjs-auth0/client';

export default function App({ Component, pageProps }: AppProps) {
  const { user, ...restPageProps } = pageProps as AppProps['pageProps'] & {
    user?: Parameters<typeof Auth0Provider>[0]['user'];
  };

  return (
    <Auth0Provider user={user}>
      <Component {...restPageProps} />
    </Auth0Provider>
  );
}

/**
 * Docs Route Layout — Wraps all /docs pages with the Appwrite-style docs layout.
 * 
 * In Remix v2, a route file named `docs.tsx` acts as a layout for all
 * nested routes under `/docs/*`. The `<Outlet />` renders the matched child route.
 */
import { Outlet } from '@remix-run/react';
import DocsLayout from '~/components/docs/DocsLayout';
import { rootNavigation } from '~/components/docs/navigation';

// Import docs-specific styles
import docsStyles from '~/styles/docs.scss?url';

export const links = () => [
  { rel: 'stylesheet', href: docsStyles },
];

export default function DocsRouteLayout() {
  return (
    <DocsLayout
      variant="two-side-navs"
      navigation={rootNavigation}
    >
      <Outlet />
    </DocsLayout>
  );
}

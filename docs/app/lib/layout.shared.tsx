import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Amplify Docs',
      url: '/docs',
    },
    links: [
      {
        text: 'GitHub',
        url: 'https://github.com/imtia33/Open_Claude',
      },
    ],
  };
}

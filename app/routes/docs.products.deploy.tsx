/**
 * Deploy Product Documentation — /docs/products/deploy
 * Documents Amplify's ACTUAL deployment features.
 */
import { Link } from '@remix-run/react';
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Deploy flow', href: '#deploy-flow', level: 2 },
  { title: 'GitHub Pages', href: '#github', level: 2 },
  { title: 'Vercel', href: '#vercel', level: 2 },
  { title: 'Netlify', href: '#netlify', level: 2 },
  { title: 'GitLab Pages', href: '#gitlab', level: 2 },
  { title: 'Cloudflare', href: '#cloudflare', level: 2 },
];

export default function DeployProductPage() {
  return (
    <DocsArticle title="Deploy" toc={toc} back="/docs" metadata="One-click deployment to GitHub Pages, Vercel, Netlify, and GitLab">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify provides one-click deployment to four platforms. The <strong>DeployButton</strong> 
        dropdown menu in the Workbench header offers deployment targets for:
      </p>
      <ul>
        <li><strong>GitHub Pages</strong> — Create a repository and push your project</li>
        <li><strong>Vercel</strong> — Deploy directly to Vercel with automatic builds</li>
        <li><strong>Netlify</strong> — Deploy to Netlify with continuous deployment</li>
        <li><strong>GitLab Pages</strong> — Push to GitLab and deploy via CI/CD</li>
      </ul>
      <p><strong>Cloudflare Pages</strong> deployment is listed as "Coming Soon."</p>

      <h2 id="deploy-flow">Deploy flow</h2>
      <p>All deployment platforms follow a similar flow:</p>
      <ol>
        <li><strong>Build project</strong> — Run <code>npm run build</code> via the ActionRunner inside WebContainer</li>
        <li><strong>Collect output</strong> — Gather build output files from the WebContainer filesystem</li>
        <li><strong>Deploy</strong> — Send files to the deployment platform via API route</li>
        <li><strong>Visual feedback</strong> — Deployment status shown as an artifact in the Workbench</li>
      </ol>
      <p>
        Build failures are formatted and displayed with detailed error messages using <code>deployUtils.ts</code>.
      </p>

      <h2 id="github">GitHub Pages</h2>
      <p>
        The GitHub deployment creates a new repository (or uses an existing one), pushes your project files, 
        and sets up GitHub Pages. It uses <strong>Octokit</strong> for GitHub API operations.
      </p>
      <p>Requires: GitHub OAuth connection via Settings → GitHub tab.</p>
      <ul>
        <li>Creates a new repository with your project name</li>
        <li>Pushes all project files to the repository</li>
        <li>Configures GitHub Pages from the main branch</li>
        <li>Provides the deployment URL after completion</li>
      </ul>

      <h2 id="vercel">Vercel</h2>
      <p>
        Deploy to Vercel with automatic builds and continuous deployment. Requires Vercel OAuth 
        connection via Settings → Vercel tab.
      </p>
      <ul>
        <li>Direct deployment via Vercel API</li>
        <li>Automatic builds and deployments</li>
        <li>Deploy alerts shown in chat messages</li>
      </ul>

      <h2 id="netlify">Netlify</h2>
      <p>
        Deploy to Netlify with continuous deployment. Requires Netlify OAuth connection via 
        Settings → Netlify tab.
      </p>
      <ul>
        <li>Direct deployment via Netlify API</li>
        <li>Automatic site creation and deployment</li>
        <li>Deploy alerts shown in chat messages</li>
      </ul>

      <h2 id="gitlab">GitLab Pages</h2>
      <p>
        Deploy to GitLab Pages by creating a project and pushing files. Requires GitLab OAuth 
        connection via Settings → GitLab tab.
      </p>
      <ul>
        <li>Creates a new GitLab project</li>
        <li>Pushes project files to the repository</li>
        <li>Configures GitLab Pages via CI/CD pipeline</li>
      </ul>

      <h2 id="cloudflare">Cloudflare</h2>
      <p>
        Cloudflare Pages deployment is currently in development ("Coming Soon"). 
        Amplify's Cloudflare Pages deployment target will use <code>wrangler</code> for deployment.
      </p>
    </DocsArticle>
  );
}

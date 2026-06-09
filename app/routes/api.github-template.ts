import { json } from '@remix-run/cloudflare';
import { fetchRepoContents } from '~/lib/utils/github-templates';

export async function loader({ request, context }: { request: Request; context: any }) {
  const url = new URL(request.url);
  const repo = url.searchParams.get('repo');

  if (!repo) {
    return json({ error: 'Repository name is required' }, { status: 400 });
  }

  try {
    const fileList = await fetchRepoContents(repo, context);

    // Filter out .git files for both methods
    const filteredFiles = fileList.filter((file: any) => !file.path.startsWith('.git'));

    return json(filteredFiles);
  } catch (error) {
    console.error('Error processing GitHub template:', error);
    console.error('Repository:', repo);
    console.error('Error details:', error instanceof Error ? error.message : String(error));

    return json(
      {
        error: 'Failed to fetch template files',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

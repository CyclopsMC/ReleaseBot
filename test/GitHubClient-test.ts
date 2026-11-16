import { GitHubClient } from '../lib/GitHubClient';

const CORE = { owner: 'CyclopsMC', name: 'CyclopsCore' };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), init);
}

describe('GitHubClient', () => {
  let fetch: jest.Mock;
  let sleep: jest.Mock;
  let client: GitHubClient;

  beforeEach(() => {
    fetch = jest.fn();
    sleep = jest.fn(async() => {});
    client = new GitHubClient({ token: 'TOKEN', fetch, sleep });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function expectRequest(index: number, url: string, method = 'GET', body?: unknown): void {
    const [ actualUrl, init ] = fetch.mock.calls[index];
    expect(actualUrl).toBe(url);
    expect(init.method).toBe(method);
    expect(init.headers.authorization).toBe('Bearer TOKEN');
    expect(init.body).toBe(body === undefined ? undefined : JSON.stringify(body));
  }

  it('should use the global fetch and default options', () => {
    expect(new GitHubClient({ token: 'TOKEN', sleep })).toBeInstanceOf(GitHubClient);
  });

  it('should support a custom API URL', async() => {
    client = new GitHubClient({ token: 'TOKEN', fetch, sleep, apiUrl: 'https://github.example.org/api/v3' });
    fetch.mockResolvedValueOnce(json([]));
    await client.listReleases(CORE);
    expectRequest(0, 'https://github.example.org/api/v3/repos/CyclopsMC/CyclopsCore/releases?per_page=100');
  });

  describe('listRepositories', () => {
    it('should return non-archived repositories over all pages', async() => {
      fetch
        .mockResolvedValueOnce(json([
          { name: 'CyclopsCore', owner: { login: 'CyclopsMC' }, archived: false },
          { name: 'Old', owner: { login: 'CyclopsMC' }, archived: true },
        ], { headers: { link: '<https://api.github.com/organizations/1/repos?page=2>; rel="next", <https://api.github.com/organizations/1/repos?page=2>; rel="last"' }}))
        .mockResolvedValueOnce(json([
          { name: 'EvilCraft', owner: { login: 'CyclopsMC' }, archived: false },
        ]));
      await expect(client.listRepositories('CyclopsMC')).resolves.toEqual([
        { owner: 'CyclopsMC', name: 'CyclopsCore' },
        { owner: 'CyclopsMC', name: 'EvilCraft' },
      ]);
      expectRequest(0, 'https://api.github.com/orgs/CyclopsMC/repos?type=sources&per_page=100');
      expectRequest(1, 'https://api.github.com/organizations/1/repos?page=2');
    });
  });

  describe('listReleases', () => {
    it('should return releases', async() => {
      fetch.mockResolvedValueOnce(json([
        {
          tag_name: '26.1.2-1.31.5',
          html_url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5',
          body: 'Changelog',
          draft: false,
          prerelease: false,
          published_at: '2026-11-15T09:03:11Z',
        },
        {
          tag_name: 'draft',
          html_url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/untagged-1',
          body: null,
          draft: true,
          prerelease: false,
          published_at: null,
        },
      ]));
      await expect(client.listReleases(CORE)).resolves.toEqual([
        {
          tag: '26.1.2-1.31.5',
          url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/26.1.2-1.31.5',
          body: 'Changelog',
          draft: false,
          prerelease: false,
          publishedAt: new Date('2026-11-15T09:03:11Z'),
        },
        {
          tag: 'draft',
          url: 'https://github.com/CyclopsMC/CyclopsCore/releases/tag/untagged-1',
          body: '',
          draft: true,
          prerelease: false,
          publishedAt: undefined,
        },
      ]);
    });
  });

  describe('getWorkflowRunState', () => {
    it('should return none if the workflow does not exist', async() => {
      fetch.mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', '26.1.2-1.31.5')).resolves.toBe('none');
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/actions/workflows/ci.yml/runs?event=push&branch=26.1.2-1.31.5&per_page=1');
    });

    it('should return none if the workflow did not run', async() => {
      fetch.mockResolvedValueOnce(json({ workflow_runs: []}));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('none');
    });

    it('should return pending if the latest run did not complete', async() => {
      fetch.mockResolvedValueOnce(json({ workflow_runs: [{ status: 'in_progress', conclusion: null }]}));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('pending');
    });

    it('should return success if the latest run succeeded', async() => {
      fetch.mockResolvedValueOnce(json({ workflow_runs: [{ status: 'completed', conclusion: 'success' }]}));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('success');
    });

    it('should return failure if the latest run did not succeed', async() => {
      fetch.mockResolvedValueOnce(json({ workflow_runs: [{ status: 'completed', conclusion: 'cancelled' }]}));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('failure');
    });
  });

  describe('getFileContents', () => {
    it('should return raw file contents at a ref', async() => {
      fetch.mockResolvedValueOnce(new Response('Fixes:\n* Fix a bug (#1)\n'));
      await expect(client.getFileContents(CORE, 'resources/changelog/26.1.2-1.31.5.txt', '26.1.2-1.31.5'))
        .resolves.toBe('Fixes:\n* Fix a bug (#1)\n');
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/contents/resources/changelog/26.1.2-1.31.5.txt?ref=26.1.2-1.31.5');
      expect(fetch.mock.calls[0][1].headers.accept).toBe('application/vnd.github.raw+json');
    });

    it('should return file contents on the default branch', async() => {
      fetch.mockResolvedValueOnce(new Response('mod_name=Cyclops Core'));
      await expect(client.getFileContents(CORE, 'gradle.properties')).resolves.toBe('mod_name=Cyclops Core');
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/contents/gradle.properties');
    });

    it('should return undefined for missing files', async() => {
      fetch.mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }));
      await expect(client.getFileContents(CORE, 'gradle.properties')).resolves.toBeUndefined();
    });
  });

  describe('getItem', () => {
    it('should return an issue', async() => {
      fetch.mockResolvedValueOnce(json({
        data: {
          repository: {
            issueOrPullRequest: {
              __typename: 'Issue',
              url: 'https://github.com/CyclopsMC/CyclopsCore/issues/258',
              author: { __typename: 'User', login: 'phrostt' },
              labels: { nodes: [{ name: 'bug' }, { name: 'mc-1.20' }]},
              comments: { nodes: [{ body: 'Thanks for reporting!' }]},
            },
          },
        },
      }));
      await expect(client.getItem({ repository: CORE, number: 258 })).resolves.toEqual({
        repository: CORE,
        number: 258,
        type: 'Issue',
        url: 'https://github.com/CyclopsMC/CyclopsCore/issues/258',
        authorLogin: 'phrostt',
        authorIsBot: false,
        labels: [ 'bug', 'mc-1.20' ],
        commentBodies: [ 'Thanks for reporting!' ],
        closingIssues: [],
      });
      const body = JSON.parse(fetch.mock.calls[0][1].body);
      expect(body.variables).toEqual({ owner: 'CyclopsMC', name: 'CyclopsCore', number: 258 });
      expect(body.query).toContain('issueOrPullRequest(number: $number)');
      expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/graphql');
      expect(fetch.mock.calls[0][1].headers['content-type']).toBe('application/json');
    });

    it('should return a pull request by a bot with closing issues', async() => {
      fetch.mockResolvedValueOnce(json({
        data: {
          repository: {
            issueOrPullRequest: {
              __typename: 'PullRequest',
              url: 'https://github.com/CyclopsMC/CyclopsCore/pull/229',
              author: { __typename: 'Bot', login: 'Copilot' },
              labels: { nodes: []},
              comments: { nodes: []},
              closingIssuesReferences: {
                nodes: [{ number: 228, repository: { name: 'CyclopsCore', owner: { login: 'CyclopsMC' }}}],
              },
            },
          },
        },
      }));
      await expect(client.getItem({ repository: CORE, number: 229 })).resolves.toEqual({
        repository: CORE,
        number: 229,
        type: 'PullRequest',
        url: 'https://github.com/CyclopsMC/CyclopsCore/pull/229',
        authorLogin: 'Copilot',
        authorIsBot: true,
        labels: [],
        commentBodies: [],
        closingIssues: [{ repository: CORE, number: 228 }],
      });
    });

    it('should handle deleted authors', async() => {
      fetch.mockResolvedValueOnce(json({
        data: {
          repository: {
            issueOrPullRequest: {
              __typename: 'Issue',
              url: 'https://github.com/CyclopsMC/CyclopsCore/issues/1',
              author: null,
              labels: { nodes: []},
              comments: { nodes: []},
            },
          },
        },
      }));
      await expect(client.getItem({ repository: CORE, number: 1 })).resolves
        .toMatchObject({ authorLogin: undefined, authorIsBot: false });
    });

    it('should return undefined for missing items', async() => {
      fetch.mockResolvedValueOnce(json({
        data: { repository: { issueOrPullRequest: null }},
        errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to an issue or pull request.' }],
      }));
      await expect(client.getItem({ repository: CORE, number: 9999 })).resolves.toBeUndefined();
    });

    it('should return undefined for missing repositories', async() => {
      fetch.mockResolvedValueOnce(json({
        data: { repository: null },
        errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository.' }],
      }));
      await expect(client.getItem({ repository: { owner: 'CyclopsMC', name: 'Missing' }, number: 1 }))
        .resolves.toBeUndefined();
    });

    it('should return undefined without data', async() => {
      fetch.mockResolvedValueOnce(json({}));
      await expect(client.getItem({ repository: CORE, number: 1 })).resolves.toBeUndefined();
    });

    it('should throw on other errors', async() => {
      fetch.mockResolvedValueOnce(json({ errors: [{ type: 'FORBIDDEN', message: 'Forbidden' }, { message: 'Other' }]}));
      await expect(client.getItem({ repository: CORE, number: 1 })).rejects
        .toThrow('GraphQL query for CyclopsMC/CyclopsCore#1 failed: Forbidden, Other');
    });
  });

  describe('ensureLabel', () => {
    const label = { name: 'released', color: '0e8a16', description: 'Included in a published release' };

    it('should not create an existing label', async() => {
      fetch.mockResolvedValueOnce(json(label));
      await client.ensureLabel(CORE, label);
      expect(fetch).toHaveBeenCalledTimes(1);
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/labels/released');
    });

    it('should create a missing label', async() => {
      fetch
        .mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }))
        .mockResolvedValueOnce(json(label, { status: 201 }));
      await client.ensureLabel(CORE, label);
      expectRequest(1, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/labels', 'POST', label);
    });
  });

  describe('addLabel', () => {
    it('should add a label', async() => {
      fetch.mockResolvedValueOnce(json([]));
      await client.addLabel({ repository: CORE, number: 258 }, 'released');
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/issues/258/labels', 'POST', { labels: [ 'released' ]});
    });
  });

  describe('addComment', () => {
    it('should add a comment', async() => {
      fetch.mockResolvedValueOnce(json({}, { status: 201 }));
      await client.addComment({ repository: CORE, number: 258 }, 'Hello');
      expectRequest(0, 'https://api.github.com/repos/CyclopsMC/CyclopsCore/issues/258/comments', 'POST', { body: 'Hello' });
    });
  });

  describe('error handling', () => {
    it('should throw on errors', async() => {
      fetch.mockResolvedValueOnce(new Response('Server error', { status: 500 }));
      await expect(client.listReleases(CORE)).rejects.toThrow('GitHub API request GET https://api.github.com/repos/CyclopsMC/CyclopsCore/releases?per_page=100 failed with status 500: Server error');
    });

    it('should throw on not found errors when not allowed', async() => {
      fetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
      await expect(client.addComment({ repository: CORE, number: 1 }, 'Hello')).rejects
        .toThrow('failed with status 404');
    });

    it('should throw on forbidden errors that are not rate limits', async() => {
      fetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
      await expect(client.listReleases(CORE)).rejects.toThrow('failed with status 403');
      expect(sleep).not.toHaveBeenCalled();
    });

    it('should retry after the retry-after header on secondary rate limits', async() => {
      fetch
        .mockResolvedValueOnce(new Response('Slow down', { status: 403, headers: { 'retry-after': '5' }}))
        .mockResolvedValueOnce(json([]));
      await expect(client.listReleases(CORE)).resolves.toEqual([]);
      expect(sleep).toHaveBeenCalledWith(5_000);
    });

    it('should retry until the rate limit resets', async() => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      fetch
        .mockResolvedValueOnce(new Response('Limited', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1010' },
        }))
        .mockResolvedValueOnce(json([]));
      await expect(client.listReleases(CORE)).resolves.toEqual([]);
      expect(sleep).toHaveBeenCalledWith(10_000);
    });

    it('should wait at least one second and at most the maximum retry delay', async() => {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      fetch
        .mockResolvedValueOnce(new Response('Limited', { status: 429, headers: { 'x-ratelimit-reset': '900' }}))
        .mockResolvedValueOnce(new Response('Limited', { status: 429, headers: { 'retry-after': '3600' }}))
        .mockResolvedValueOnce(new Response('Limited', { status: 429 }))
        .mockResolvedValueOnce(json([]));
      client = new GitHubClient({ token: 'TOKEN', fetch, sleep, maxRetryDelay: 30_000 });
      await expect(client.listReleases(CORE)).resolves.toEqual([]);
      expect(sleep.mock.calls).toEqual([[ 1_000 ], [ 30_000 ], [ 30_000 ]]);
    });

    it('should give up after the maximum number of retries', async() => {
      fetch.mockResolvedValue(new Response('Limited', { status: 429, headers: { 'retry-after': '1' }}));
      client = new GitHubClient({ token: 'TOKEN', fetch, sleep, maxRetries: 2 });
      await expect(client.listReleases(CORE)).rejects.toThrow('failed with status 429');
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    });
  });

  describe('getNextLink', () => {
    it('should handle missing and last pages', () => {
      expect(GitHubClient.getNextLink(null)).toBeUndefined();
      expect(GitHubClient.getNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeUndefined();
    });
  });
});

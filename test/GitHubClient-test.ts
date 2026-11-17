// The GitHub API uses snake_case parameters and properties
import type { Octokit } from '@octokit/rest';
import { GitHubClient } from '../lib/GitHubClient';

const CORE = { owner: 'CyclopsMC', name: 'CyclopsCore' };

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function graphQlError(errors: { type?: string; message: string }[]): Error {
  return Object.assign(new Error(errors.map(error => error.message).join(', ')), { errors });
}

describe('GitHubClient', () => {
  let octokit: {
    paginate: jest.Mock;
    graphql: jest.Mock;
    rest: {
      repos: { listForOrg: jest.Mock; listReleases: jest.Mock; getContent: jest.Mock };
      actions: { listWorkflowRuns: jest.Mock };
      issues: { getLabel: jest.Mock; createLabel: jest.Mock; addLabels: jest.Mock; createComment: jest.Mock };
    };
  };
  let client: GitHubClient;

  beforeEach(() => {
    octokit = {
      paginate: jest.fn(),
      graphql: jest.fn(),
      rest: {
        repos: { listForOrg: jest.fn(), listReleases: jest.fn(), getContent: jest.fn() },
        actions: { listWorkflowRuns: jest.fn() },
        issues: { getLabel: jest.fn(), createLabel: jest.fn(), addLabels: jest.fn(), createComment: jest.fn() },
      },
    };
    client = new GitHubClient(<Octokit> <unknown> octokit);
  });

  describe('listRepositories', () => {
    it('should return non-archived repositories over all pages', async() => {
      octokit.paginate.mockResolvedValueOnce([
        { name: 'CyclopsCore', owner: { login: 'CyclopsMC' }, archived: false },
        { name: 'Old', owner: { login: 'CyclopsMC' }, archived: true },
        { name: 'EvilCraft', owner: { login: 'CyclopsMC' }, archived: false },
      ]);
      await expect(client.listRepositories('CyclopsMC')).resolves.toEqual([
        { owner: 'CyclopsMC', name: 'CyclopsCore' },
        { owner: 'CyclopsMC', name: 'EvilCraft' },
      ]);
      expect(octokit.paginate).toHaveBeenCalledWith(octokit.rest.repos.listForOrg, {
        org: 'CyclopsMC',
        type: 'sources',
        per_page: 100,
      });
    });
  });

  describe('listReleases', () => {
    it('should return releases', async() => {
      octokit.rest.repos.listReleases.mockResolvedValueOnce({
        data: [
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
        ],
      });
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
      expect(octokit.rest.repos.listReleases).toHaveBeenCalledWith({
        owner: 'CyclopsMC',
        repo: 'CyclopsCore',
        per_page: 100,
      });
    });
  });

  describe('getWorkflowRunState', () => {
    it('should return none if the workflow does not exist', async() => {
      octokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce(httpError(404));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', '26.1.2-1.31.5')).resolves.toBe('none');
      expect(octokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith({
        owner: 'CyclopsMC',
        repo: 'CyclopsCore',
        workflow_id: 'ci.yml',
        event: 'push',
        branch: '26.1.2-1.31.5',
        per_page: 1,
      });
    });

    it('should return none if the workflow did not run', async() => {
      octokit.rest.actions.listWorkflowRuns.mockResolvedValueOnce({ data: { workflow_runs: []}});
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('none');
    });

    it('should return pending if the latest run did not complete', async() => {
      octokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({ data: { workflow_runs: [{ status: 'in_progress', conclusion: null }]}});
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('pending');
    });

    it('should return success if the latest run succeeded', async() => {
      octokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({ data: { workflow_runs: [{ status: 'completed', conclusion: 'success' }]}});
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('success');
    });

    it('should return failure if the latest run did not succeed', async() => {
      octokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({ data: { workflow_runs: [{ status: 'completed', conclusion: 'cancelled' }]}});
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).resolves.toBe('failure');
    });

    it('should throw on other errors', async() => {
      octokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce(httpError(500));
      await expect(client.getWorkflowRunState(CORE, 'ci.yml', 'tag')).rejects.toThrow('HTTP 500');
    });
  });

  describe('getFileContents', () => {
    it('should return raw file contents at a ref', async() => {
      octokit.rest.repos.getContent.mockResolvedValueOnce({ data: 'Fixes:\n* Fix a bug (#1)\n' });
      await expect(client.getFileContents(CORE, 'resources/changelog/26.1.2-1.31.5.txt', '26.1.2-1.31.5'))
        .resolves.toBe('Fixes:\n* Fix a bug (#1)\n');
      expect(octokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'CyclopsMC',
        repo: 'CyclopsCore',
        path: 'resources/changelog/26.1.2-1.31.5.txt',
        ref: '26.1.2-1.31.5',
        mediaType: { format: 'raw' },
      });
    });

    it('should return file contents on the default branch', async() => {
      octokit.rest.repos.getContent.mockResolvedValueOnce({ data: 'mod_name=Cyclops Core' });
      await expect(client.getFileContents(CORE, 'gradle.properties')).resolves.toBe('mod_name=Cyclops Core');
      expect(octokit.rest.repos.getContent.mock.calls[0][0].ref).toBeUndefined();
    });

    it('should return undefined for missing files', async() => {
      octokit.rest.repos.getContent.mockRejectedValueOnce(httpError(404));
      await expect(client.getFileContents(CORE, 'gradle.properties')).resolves.toBeUndefined();
    });
  });

  describe('getItem', () => {
    it('should return an issue', async() => {
      octokit.graphql.mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: 'Issue',
            url: 'https://github.com/CyclopsMC/CyclopsCore/issues/258',
            author: { __typename: 'User', login: 'phrostt' },
            labels: { nodes: [{ name: 'bug' }, { name: 'mc-1.20' }]},
            comments: { nodes: [{ body: 'Thanks for reporting!' }]},
          },
        },
      });
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
      const [ query, variables ] = octokit.graphql.mock.calls[0];
      expect(query).toContain('issueOrPullRequest(number: $number)');
      expect(variables).toEqual({ owner: 'CyclopsMC', name: 'CyclopsCore', number: 258 });
    });

    it('should return a pull request by a bot with closing issues', async() => {
      octokit.graphql.mockResolvedValueOnce({
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
      });
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
      octokit.graphql.mockResolvedValueOnce({
        repository: {
          issueOrPullRequest: {
            __typename: 'Issue',
            url: 'https://github.com/CyclopsMC/CyclopsCore/issues/1',
            author: null,
            labels: { nodes: []},
            comments: { nodes: []},
          },
        },
      });
      await expect(client.getItem({ repository: CORE, number: 1 })).resolves
        .toMatchObject({ authorLogin: undefined, authorIsBot: false });
    });

    it('should return undefined for missing items', async() => {
      octokit.graphql.mockRejectedValueOnce(graphQlError([{ type: 'NOT_FOUND', message: 'Not found' }]));
      await expect(client.getItem({ repository: CORE, number: 9999 })).resolves.toBeUndefined();
    });

    it('should return undefined for null data', async() => {
      octokit.graphql.mockResolvedValueOnce({ repository: null });
      await expect(client.getItem({ repository: CORE, number: 1 })).resolves.toBeUndefined();
      octokit.graphql.mockResolvedValueOnce({ repository: { issueOrPullRequest: null }});
      await expect(client.getItem({ repository: CORE, number: 1 })).resolves.toBeUndefined();
    });

    it('should throw on other GraphQL errors', async() => {
      octokit.graphql.mockRejectedValueOnce(graphQlError([
        { type: 'NOT_FOUND', message: 'Not found' },
        { type: 'FORBIDDEN', message: 'Forbidden' },
      ]));
      await expect(client.getItem({ repository: CORE, number: 1 })).rejects.toThrow('Not found, Forbidden');
    });

    it('should throw on errors without GraphQL errors', async() => {
      octokit.graphql.mockRejectedValueOnce(httpError(502));
      await expect(client.getItem({ repository: CORE, number: 1 })).rejects.toThrow('HTTP 502');
      octokit.graphql.mockRejectedValueOnce(graphQlError([]));
      await expect(client.getItem({ repository: CORE, number: 1 })).rejects.toThrow('');
    });
  });

  describe('ensureLabel', () => {
    const label = { name: 'released', color: '0e8a16', description: 'Included in a published release' };

    it('should not create an existing label', async() => {
      octokit.rest.issues.getLabel.mockResolvedValueOnce({ data: label });
      await client.ensureLabel(CORE, label);
      expect(octokit.rest.issues.getLabel)
        .toHaveBeenCalledWith({ owner: 'CyclopsMC', repo: 'CyclopsCore', name: 'released' });
      expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled();
    });

    it('should create a missing label', async() => {
      octokit.rest.issues.getLabel.mockRejectedValueOnce(httpError(404));
      await client.ensureLabel(CORE, label);
      expect(octokit.rest.issues.createLabel)
        .toHaveBeenCalledWith({ owner: 'CyclopsMC', repo: 'CyclopsCore', ...label });
    });
  });

  describe('addLabel', () => {
    it('should add a label', async() => {
      await client.addLabel({ repository: CORE, number: 258 }, 'released');
      expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner: 'CyclopsMC',
        repo: 'CyclopsCore',
        issue_number: 258,
        labels: [ 'released' ],
      });
    });
  });

  describe('addComment', () => {
    it('should add a comment', async() => {
      await client.addComment({ repository: CORE, number: 258 }, 'Hello');
      expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
        owner: 'CyclopsMC',
        repo: 'CyclopsCore',
        issue_number: 258,
        body: 'Hello',
      });
    });
  });

  describe('ignoreNotFound', () => {
    it('should return the value of successful requests', async() => {
      await expect(GitHubClient.ignoreNotFound(Promise.resolve('value'))).resolves.toBe('value');
    });

    it('should return undefined on 404 errors', async() => {
      await expect(GitHubClient.ignoreNotFound(Promise.reject(httpError(404)))).resolves.toBeUndefined();
    });

    it('should rethrow other errors', async() => {
      await expect(GitHubClient.ignoreNotFound(Promise.reject(httpError(403)))).rejects.toThrow('HTTP 403');
      await expect(GitHubClient.ignoreNotFound(Promise.reject(new Error('Network error')))).rejects
        .toThrow('Network error');
    });
  });
});

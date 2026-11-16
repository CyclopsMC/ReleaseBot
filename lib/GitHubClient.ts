import type {
  IGitHubClient,
  IItem,
  IItemId,
  ILabel,
  IRelease,
  IRepositoryId,
  WorkflowRunState,
} from './IGitHubClient';

const ITEM_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        url
        author { __typename login }
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body } }
      }
      ... on PullRequest {
        url
        author { __typename login }
        labels(first: 100) { nodes { name } }
        comments(last: 100) { nodes { body } }
        closingIssuesReferences(first: 25) { nodes { number repository { name owner { login } } } }
      }
    }
  }
}`;

/**
 * A GitHub client that talks to the REST and GraphQL APIs via fetch.
 */
export class GitHubClient implements IGitHubClient {
  private readonly token: string;
  private readonly apiUrl: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly maxRetryDelay: number;

  public constructor(options: IGitHubClientOptions) {
    this.token = options.token;
    this.apiUrl = options.apiUrl ?? 'https://api.github.com';
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryDelay = options.maxRetryDelay ?? 60_000;
  }

  public async listRepositories(organization: string): Promise<IRepositoryId[]> {
    const repositories = await this.requestPaginated<IRestRepository>(
      `/orgs/${encodeURIComponent(organization)}/repos?type=sources&per_page=100`,
    );
    return repositories
      .filter(repository => !repository.archived)
      .map(repository => ({ owner: repository.owner.login, name: repository.name }));
  }

  public async listReleases(repository: IRepositoryId): Promise<IRelease[]> {
    const releases = await this.requestJson<IRestRelease[]>(`${this.getRepositoryPath(repository)}/releases?per_page=100`);
    return releases.map(release => ({
      tag: release.tag_name,
      url: release.html_url,
      body: release.body ?? '',
      draft: release.draft,
      prerelease: release.prerelease,
      publishedAt: release.published_at ? new Date(release.published_at) : undefined,
    }));
  }

  public async getWorkflowRunState(
    repository: IRepositoryId,
    workflow: string,
    tag: string,
  ): Promise<WorkflowRunState> {
    const response = await this.requestJson<IRestWorkflowRuns | undefined>(
      `${this.getRepositoryPath(repository)}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=push&branch=${encodeURIComponent(tag)}&per_page=1`,
      { allowNotFound: true },
    );
    const run = response?.workflow_runs[0];
    if (!run) {
      return 'none';
    }
    if (run.status !== 'completed') {
      return 'pending';
    }
    return run.conclusion === 'success' ? 'success' : 'failure';
  }

  public async getFileContents(repository: IRepositoryId, path: string, ref?: string): Promise<string | undefined> {
    const encodedPath = path.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const response = await this.request(`${this.getRepositoryPath(repository)}/contents/${encodedPath}${query}`, {
      accept: 'application/vnd.github.raw+json',
      allowNotFound: true,
    });
    return response ? await response.text() : undefined;
  }

  public async getItem(id: IItemId): Promise<IItem | undefined> {
    const response = await this.requestJson<IGraphQlResponse<IGraphQlItemData>>('/graphql', {
      method: 'POST',
      body: {
        query: ITEM_QUERY,
        variables: { owner: id.repository.owner, name: id.repository.name, number: id.number },
      },
    });
    const errors = (response.errors ?? []).filter(error => error.type !== 'NOT_FOUND');
    if (errors.length > 0) {
      throw new Error(`GraphQL query for ${this.getItemName(id)} failed: ${errors.map(error => error.message).join(', ')}`);
    }
    const item = response.data?.repository?.issueOrPullRequest;
    if (!item) {
      return undefined;
    }
    return {
      repository: id.repository,
      number: id.number,
      type: item.__typename,
      url: item.url,
      authorLogin: item.author?.login,
      authorIsBot: item.author?.__typename === 'Bot',
      labels: item.labels.nodes.map(label => label.name),
      commentBodies: item.comments.nodes.map(comment => comment.body),
      closingIssues: (item.closingIssuesReferences?.nodes ?? []).map(issue => ({
        repository: { owner: issue.repository.owner.login, name: issue.repository.name },
        number: issue.number,
      })),
    };
  }

  public async ensureLabel(repository: IRepositoryId, label: ILabel): Promise<void> {
    const path = `${this.getRepositoryPath(repository)}/labels`;
    if (await this.request(`${path}/${encodeURIComponent(label.name)}`, { allowNotFound: true })) {
      return;
    }
    await this.request(path, { method: 'POST', body: label });
  }

  public async addLabel(id: IItemId, label: string): Promise<void> {
    await this.request(`${this.getItemPath(id)}/labels`, { method: 'POST', body: { labels: [ label ]}});
  }

  public async addComment(id: IItemId, body: string): Promise<void> {
    await this.request(`${this.getItemPath(id)}/comments`, { method: 'POST', body: { body }});
  }

  protected getRepositoryPath(repository: IRepositoryId): string {
    return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  }

  protected getItemPath(id: IItemId): string {
    return `${this.getRepositoryPath(id.repository)}/issues/${id.number}`;
  }

  protected getItemName(id: IItemId): string {
    return `${id.repository.owner}/${id.repository.name}#${id.number}`;
  }

  /**
   * Send a request, and fetch all subsequent pages via the Link header.
   * @param path An API path.
   */
  protected async requestPaginated<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = path;
    while (next) {
      const response: Response = (await this.request(next))!;
      results.push(...<T[]> await response.json());
      next = GitHubClient.getNextLink(response.headers.get('link'));
    }
    return results;
  }

  /**
   * @param link The value of a Link header.
   * @return The URL of the next page, if any.
   */
  public static getNextLink(link: string | null): string | undefined {
    return link ? /<([^>]+)>;\s*rel="next"/u.exec(link)?.[1] : undefined;
  }

  protected async requestJson<T>(path: string, init: IRequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    return response ? <T> await response.json() : <T> undefined;
  }

  /**
   * Send a request, retrying when rate limited.
   * @param path An API path, or an absolute URL.
   * @param init Request options.
   * @return The response, or undefined if not found and allowNotFound is set.
   */
  protected async request(path: string, init: IRequestInit = {}): Promise<Response | undefined> {
    const method = init.method ?? 'GET';
    const url = /^https?:\/\//u.test(path) ? path : `${this.apiUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetch(url, {
        method,
        /* eslint-disable ts/naming-convention */
        headers: {
          accept: init.accept ?? 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'user-agent': 'CyclopsMC-ReleaseBot',
          'x-github-api-version': '2022-11-28',
          ...init.body ? { 'content-type': 'application/json' } : {},
        },
        /* eslint-enable ts/naming-convention */
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      if (response.ok) {
        return response;
      }
      if (response.status === 404 && init.allowNotFound) {
        return undefined;
      }
      if (attempt < this.maxRetries && this.isRateLimited(response)) {
        await this.sleep(this.getRetryDelay(response));
        continue;
      }
      throw new Error(`GitHub API request ${method} ${url} failed with status ${response.status}: ${await response.text()}`);
    }
  }

  protected isRateLimited(response: Response): boolean {
    return response.status === 429 || (response.status === 403 &&
      (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'));
  }

  protected getRetryDelay(response: Response): number {
    const retryAfter = response.headers.get('retry-after');
    const reset = response.headers.get('x-ratelimit-reset');
    let delay = 60_000;
    if (retryAfter) {
      delay = Number.parseInt(retryAfter, 10) * 1_000;
    } else if (reset) {
      delay = (Number.parseInt(reset, 10) * 1_000) - Date.now();
    }
    return Math.min(Math.max(delay, 1_000), this.maxRetryDelay);
  }
}

export interface IGitHubClientOptions {
  /**
   * The token to authenticate with.
   */
  token: string;
  /**
   * Function to wait for the given number of milliseconds.
   */
  sleep: (ms: number) => Promise<void>;
  /**
   * The base URL of the GitHub API, defaults to https://api.github.com.
   */
  apiUrl?: string;
  /**
   * A custom fetch function.
   */
  fetch?: typeof fetch;
  /**
   * How many times a rate-limited request may be retried, defaults to 3.
   */
  maxRetries?: number;
  /**
   * The maximum number of milliseconds to wait before retrying a rate-limited request, defaults to 60 seconds.
   */
  maxRetryDelay?: number;
}

export interface IRequestInit {
  method?: string;
  accept?: string;
  body?: unknown;
  allowNotFound?: boolean;
}

/* eslint-disable ts/naming-convention */
interface IRestRepository {
  name: string;
  owner: { login: string };
  archived: boolean;
}

interface IRestRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

interface IRestWorkflowRuns {
  workflow_runs: IRestWorkflowRun[];
}

interface IRestWorkflowRun {
  status: string;
  conclusion: string | null;
}

interface IGraphQlResponse<T> {
  data?: T;
  errors?: { type?: string; message: string }[];
}

interface IGraphQlItemData {
  repository: {
    issueOrPullRequest: {
      __typename: 'Issue' | 'PullRequest';
      url: string;
      author: { __typename: string; login: string } | null;
      labels: { nodes: { name: string }[] };
      comments: { nodes: { body: string }[] };
      closingIssuesReferences?: {
        nodes: { number: number; repository: { name: string; owner: { login: string }}}[];
      };
    } | null;
  } | null;
}
/* eslint-enable ts/naming-convention */

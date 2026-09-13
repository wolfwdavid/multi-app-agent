// Real GitHub read connector (public REST API via fetch). Public data only: README content is
// never fetched, and every returned field is untrusted evidence, never instructions.
// Unauthenticated calls get 60 req/hr, so without GITHUB_TOKEN a listRepos call is exactly one
// request. With a token, the top 5 repos get a per-language byte breakdown.
import { ConnectorError } from '../types.ts';
import type { GitHubPort, RepoSummary } from '../types.ts';
import { fetchJson } from './http.ts';
import type { Env, RealDeps } from './shared.ts';

const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_REPOS = 30;
const LANGUAGE_LOOKUPS = 5;

interface GitHubRepoJson {
	name: string;
	description?: string | null;
	stargazers_count?: number;
	language?: string | null;
	pushed_at?: string | null;
	html_url: string;
	fork?: boolean;
	private?: boolean;
	owner?: { login?: string };
}

export function createRealGitHub(env: Env, deps: RealDeps = {}): GitHubPort {
	return {
		listRepos: async (username) => {
			const user = typeof username === 'string' ? username.trim() : '';
			if (!USERNAME.test(user)) {
				throw new ConnectorError('validation', `github.listRepos: invalid username ${JSON.stringify(username)}`, {
					status: 400
				});
			}
			const token = env.GITHUB_TOKEN?.trim();
			const headers: Record<string, string> = {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'transferpilot'
			};
			if (token) headers.Authorization = `Bearer ${token}`;

			const raw = await fetchJson<GitHubRepoJson[]>(
				`https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed&type=owner`,
				{ app: 'github', headers, deps }
			);
			if (!Array.isArray(raw)) {
				throw new ConnectorError('server', `github GET /users/${user}/repos: unexpected response shape`);
			}

			const repos = raw
				.filter((r) => !r.fork && !r.private)
				.map((r) => ({
					owner: r.owner?.login ?? user,
					summary: {
						name: r.name,
						description: r.description ?? null,
						stars: r.stargazers_count ?? 0,
						languages: r.language ? [r.language] : [],
						pushedAt: r.pushed_at ?? '',
						url: r.html_url
					} satisfies RepoSummary
				}))
				.sort((a, b) => {
					const x = a.summary;
					const y = b.summary;
					if (x.pushedAt !== y.pushedAt) return x.pushedAt < y.pushedAt ? 1 : -1;
					return x.name < y.name ? -1 : x.name > y.name ? 1 : 0;
				})
				.slice(0, MAX_REPOS);

			if (token) {
				await Promise.all(
					repos.slice(0, LANGUAGE_LOOKUPS).map(async (r) => {
						try {
							const bytes = await fetchJson<Record<string, number>>(
								`https://api.github.com/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.summary.name)}/languages`,
								{ app: 'github', headers, deps }
							);
							const languages = Object.entries(bytes)
								.sort((a, b) => b[1] - a[1])
								.map(([k]) => k);
							if (languages.length) r.summary.languages = languages;
						} catch {
							// Enrichment only: keep the primary language.
						}
					})
				);
			}

			return repos.map((r) => r.summary);
		}
	};
}

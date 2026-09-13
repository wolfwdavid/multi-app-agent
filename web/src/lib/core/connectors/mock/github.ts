// Read-only GitHub twin. Mirrors GET /users/{username}/repos: usernames are case-insensitive
// and an unknown user returns 404 Not Found.
import { ConnectorError } from '../types.ts';
import type { GitHubPort } from '../types.ts';
import type { World } from './world.ts';

export function createMockGitHub(world: World): GitHubPort {
	return {
		listRepos: async (username) => {
			const repos = world.state.github.repos[username.toLowerCase()];
			if (!repos) throw new ConnectorError('not_found', 'Not Found', { status: 404 });
			return structuredClone(repos);
		}
	};
}

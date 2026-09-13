// Read-only Hugging Face twin. Mirrors /api/models?author= and /api/spaces?author=: an unknown
// author returns an empty list, not a 404.
import type { HFPort } from '../types.ts';
import type { World } from './world.ts';

export function createMockHF(world: World): HFPort {
	return {
		listModelsAndSpaces: async (username) => {
			const items = world.state.hf.items;
			const match =
				items[username] ??
				items[Object.keys(items).find((k) => k.toLowerCase() === username.toLowerCase()) ?? ''] ??
				[];
			return structuredClone(match);
		}
	};
}

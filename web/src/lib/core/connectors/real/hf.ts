// Real Hugging Face read connector (public Hub API via fetch, no auth). Public data only; returned
// fields are untrusted evidence. An unknown author yields [] (mirrors the Hub and the mock twin).
import { ConnectorError } from '../types.ts';
import type { HFItem, HFPort } from '../types.ts';
import { fetchJson } from './http.ts';
import type { Env, RealDeps } from './shared.ts';

const AUTHOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

interface HFItemJson {
	id?: string;
	likes?: number;
	tags?: string[];
	lastModified?: string;
	createdAt?: string;
	private?: boolean;
}

function toItems(raw: unknown, kind: HFItem['kind'], where: string): HFItem[] {
	if (!Array.isArray(raw)) throw new ConnectorError('server', `${where}: unexpected response shape`);
	return (raw as HFItemJson[])
		.filter((r) => typeof r?.id === 'string' && r.private !== true)
		.map((r) => ({
			id: r.id as string,
			kind,
			likes: r.likes ?? 0,
			tags: Array.isArray(r.tags) ? r.tags.filter((t) => typeof t === 'string') : [],
			lastModified: r.lastModified ?? r.createdAt ?? '',
			url: kind === 'space' ? `https://huggingface.co/spaces/${r.id}` : `https://huggingface.co/${r.id}`
		}));
}

export function createRealHF(_env: Env, deps: RealDeps = {}): HFPort {
	return {
		listModelsAndSpaces: async (username) => {
			const author = typeof username === 'string' ? username.trim() : '';
			if (!AUTHOR.test(author)) {
				throw new ConnectorError('validation', `hf.listModelsAndSpaces: invalid author ${JSON.stringify(username)}`, {
					status: 400
				});
			}
			const u = encodeURIComponent(author);
			const [models, spaces] = await Promise.all([
				fetchJson<unknown>(`https://huggingface.co/api/models?author=${u}&limit=100&full=true`, { app: 'hf', deps }),
				fetchJson<unknown>(`https://huggingface.co/api/spaces?author=${u}&limit=100&full=true`, { app: 'hf', deps })
			]);
			return [...toItems(models, 'model', 'hf GET /api/models'), ...toItems(spaces, 'space', 'hf GET /api/spaces')].sort(
				(a, b) => {
					if (a.lastModified !== b.lastModified) return a.lastModified < b.lastModified ? 1 : -1;
					return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
				}
			);
		}
	};
}

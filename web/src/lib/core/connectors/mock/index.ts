// Mock connector bundle: all six stateful twins over one World.
import type { Connectors } from '../types.ts';
import type { World } from './world.ts';
import { createMockCalendar } from './calendar.ts';
import { createMockDocs } from './docs.ts';
import { createMockGitHub } from './github.ts';
import { createMockGmail } from './gmail.ts';
import { createMockHF } from './hf.ts';
import { createMockNotion } from './notion.ts';

export function createMockConnectors(world: World): Connectors {
	return {
		gmail: createMockGmail(world),
		calendar: createMockCalendar(world),
		docs: createMockDocs(world),
		notion: createMockNotion(world),
		github: createMockGitHub(world),
		hf: createMockHF(world)
	};
}

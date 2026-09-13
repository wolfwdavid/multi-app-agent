// Single entry point for connectors: createConnectors({ mode }) switches mock and real behind the
// same ports. Env is read ONLY by entry points (routes, scripts) and passed in as `env`; core
// never reads the process environment itself.
import type { Connectors } from './types.ts';
import { createWorld, type World, type WorldSeed } from './mock/world.ts';
import { createMockConnectors } from './mock/index.ts';
import { defaultWorldSeed } from './mock/seed.ts';
import { withFaultsAll, type FaultRuleInput } from './mock/faults.ts';
import { createRealConnectors, type Env } from './real/index.ts';

export type ConnectorMode = 'mock' | 'real';

export interface MockConnectorOptions {
	mode: 'mock';
	/** Ignored when `world` is given. Defaults to the fixture-based default seed. */
	seed?: WorldSeed;
	/** Reuse an existing world (re-run idempotency demos, Vercel snapshot round-trip). */
	world?: World;
	faults?: {
		rules: Partial<Record<keyof Connectors, FaultRuleInput[]>>;
		seed?: number;
		sleep?: (ms: number) => Promise<void>;
	};
}

export interface RealConnectorOptions {
	mode: 'real';
	env?: Env;
}

export type ConnectorOptions = MockConnectorOptions | RealConnectorOptions;
export type MockConnectors = Connectors & { mode: 'mock'; world: World };
export type RealConnectors = Connectors & { mode: 'real'; world: null };

export function createConnectors(opts: MockConnectorOptions): MockConnectors;
export function createConnectors(opts: RealConnectorOptions): RealConnectors;
export function createConnectors(opts: ConnectorOptions): MockConnectors | RealConnectors;
export function createConnectors(opts: ConnectorOptions): MockConnectors | RealConnectors {
	if (opts.mode === 'real') {
		return { mode: 'real', world: null, ...createRealConnectors(opts.env ?? {}) };
	}
	const world = opts.world ?? createWorld(opts.seed ?? defaultWorldSeed());
	let bundle: MockConnectors = { mode: 'mock', world, ...createMockConnectors(world) };
	if (opts.faults) {
		bundle = withFaultsAll(bundle, opts.faults.rules, {
			seed: opts.faults.seed ?? 1,
			rollback: world,
			sleep: opts.faults.sleep
		});
	}
	return bundle;
}

export function resolveConnectorMode(env: Env): ConnectorMode {
	const v = (env.MODE ?? '').trim().toLowerCase();
	if (v === '' || v === 'mock') return 'mock';
	if (v === 'real') return 'real';
	throw new Error(`Invalid MODE "${env.MODE}": expected "mock" or "real"`);
}

// Re-exports so downstream phases have one import site.
export { createWorld, diffWorldStates, isEmptyDiff, DEFAULT_CLOCK } from './mock/world.ts';
export type { World, WorldSeed, WorldState, WorldDiff, MockDoc, MockCalEvent } from './mock/world.ts';
export { withFaults, withFaultsAll, FaultRule, FaultSpec } from './mock/faults.ts';
export type { FaultRuleInput, FaultEvent, StateRollback } from './mock/faults.ts';
export { defaultWorldSeed } from './mock/seed.ts';
export { createRealConnectors, realConnectorStatus, REAL_ENV_REQUIREMENTS } from './real/index.ts';
export type { Env, RealConnectorStatus } from './real/index.ts';
export { ConnectorError } from './types.ts';
export type * from './types.ts';

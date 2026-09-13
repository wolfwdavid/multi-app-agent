// Shared helpers for real connectors. `env` is always a parameter: core never reads the process
// environment. Unconfigured ports fail loudly (not_configured), never with a silent empty result.
import { ConnectorError } from '../types.ts';
import type { AppName, ConnectorErrorKind } from '../../schemas.ts';

export type Env = Record<string, string | undefined>;

export interface RealDeps {
	fetch?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	timeoutMs?: number;
}

/** ok: null means the probe was skipped (not configured or not implemented). */
export interface ProbeResult {
	app: AppName;
	configured: boolean;
	implemented: boolean;
	ok: boolean | null;
	kind?: ConnectorErrorKind;
	detail: string;
	latencyMs?: number;
}

/** Names that are unset or whitespace-only. */
export function missingEnv(env: Env, names: readonly string[]): string[] {
	return names.filter((name) => (env[name] ?? '').trim() === '');
}

/** A port whose every method rejects ConnectorError('not_configured', `${app}.${method}: ${detail}`). */
export function notConfiguredPort<T>(app: AppName, methods: readonly string[], detail: string): T {
	const out: Record<string, (...args: unknown[]) => Promise<never>> = {};
	for (const method of methods) {
		out[method] = async () => {
			throw new ConnectorError('not_configured', `${app}.${method}: ${detail}`);
		};
	}
	return out as unknown as T;
}

const SECRET_NAME = /TOKEN|SECRET|KEY|PASSWORD/i;

/** Replace the values (length >= 8) of secret-looking env keys with [redacted]. */
export function redactSecrets(text: string, env: Env): string {
	const values = Object.entries(env)
		.filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.trim().length >= 8)
		.map(([, value]) => (value as string).trim())
		.sort((a, b) => b.length - a.length);
	return values.reduce((acc, value) => acc.split(value).join('[redacted]'), text);
}

export function toConnectorError(e: unknown, context: string, env: Env = {}): ConnectorError {
	if (e instanceof ConnectorError) return e;
	const message = e instanceof Error ? e.message : String(e);
	return new ConnectorError('server', redactSecrets(`${context}: ${message}`, env));
}

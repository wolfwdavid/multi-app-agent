// Profile editor helpers: JSON text is the single source of truth; fields rewrite it by dotted path.
import { Profile } from '../core/schemas.ts';
import type { SchoolsDataset } from '../core/schemas.ts';

export type ProfileIssue = { path: string; message: string };
export type JsonError = { line: number; column: number; message: string };
export type ParseResult =
	| { ok: true; profile: Profile }
	| { ok: false; jsonError?: JsonError; issues: ProfileIssue[] };

export const FIELD_PATHS = [
	'intended_major',
	'gpa',
	'units.completed',
	'units.in_progress',
	'units.system',
	'terms_remaining',
	'targets'
] as const;
export type FieldPath = (typeof FIELD_PATHS)[number];

/** Offset of the first JSON syntax error (engines differ in whether their message includes a position). */
function jsonErrorOffset(s: string): number {
	let i = 0;
	const NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;
	const fail = (): never => {
		throw i;
	};
	const ws = () => {
		while (i < s.length && ' \t\n\r'.includes(s[i])) i++;
	};
	const str = () => {
		i++;
		while (i < s.length) {
			const ch = s[i];
			if (ch === '"') {
				i++;
				return;
			}
			if (ch === '\\') {
				i += 2;
				continue;
			}
			if (ch < ' ') fail();
			i++;
		}
		fail();
	};
	const value = (): void => {
		ws();
		const c = s[i];
		if (c === '{' || c === '[') {
			const close = c === '{' ? '}' : ']';
			i++;
			ws();
			if (s[i] === close) {
				i++;
				return;
			}
			for (;;) {
				if (c === '{') {
					ws();
					if (s[i] !== '"') fail();
					str();
					ws();
					if (s[i] !== ':') fail();
					i++;
				}
				value();
				ws();
				if (s[i] === ',') {
					i++;
					continue;
				}
				if (s[i] === close) {
					i++;
					return;
				}
				fail();
			}
		}
		if (c === '"') return str();
		NUM.lastIndex = i;
		const m = NUM.exec(s);
		if (m) {
			i += m[0].length;
			return;
		}
		fail();
	};
	try {
		value();
		ws();
		if (i < s.length) fail();
		return -1;
	} catch (e) {
		return typeof e === 'number' ? e : -1;
	}
}

function offsetToLineCol(text: string, pos: number): { line: number; column: number } {
	const p = Math.max(0, Math.min(pos, text.length));
	const before = text.slice(0, p);
	const line = before.split('\n').length;
	const column = p - (before.lastIndexOf('\n') + 1) + 1;
	return { line, column };
}

function describeJsonError(text: string, err: unknown): JsonError {
	const raw = err instanceof Error ? err.message : String(err);
	const message =
		raw
			.replace(/\s*in JSON at position.*$/, '')
			.replace(/,\s*"[\s\S]*is not valid JSON$/, '')
			.trim() || 'Invalid JSON';
	const lc = /line (\d+) column (\d+)/.exec(raw);
	if (lc) return { line: Number(lc[1]), column: Number(lc[2]), message };
	const pos = /position (\d+)/.exec(raw);
	if (pos) return { ...offsetToLineCol(text, Number(pos[1])), message };
	const scanned = jsonErrorOffset(text);
	return { ...offsetToLineCol(text, scanned >= 0 ? scanned : text.length), message };
}

export function parseProfile(text: string): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		return { ok: false, jsonError: describeJsonError(text, err), issues: [] };
	}
	const r = Profile.safeParse(raw);
	if (r.success) return { ok: true, profile: r.data };
	return {
		ok: false,
		issues: r.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }))
	};
}

const matchesField = (issuePath: string, field: string) =>
	issuePath === field || (field === 'targets' && issuePath.startsWith('targets.'));

export function fieldIssues(issues: ProfileIssue[], path: string): ProfileIssue[] {
	return issues.filter((i) => matchesField(i.path, path));
}

export function unmappedIssues(issues: ProfileIssue[]): ProfileIssue[] {
	return issues.filter((i) => !FIELD_PATHS.some((f) => matchesField(i.path, f)));
}

/** Set a dotted path in the JSON text. Caller guarantees the text is valid JSON. NaN is stored as null. */
export function setField(text: string, path: string, value: unknown): string {
	const obj = JSON.parse(text) as Record<string, unknown>;
	const keys = path.split('.');
	let cur: Record<string, unknown> = obj;
	for (const key of keys.slice(0, -1)) {
		const next = cur[key];
		if (next === null || typeof next !== 'object') cur[key] = {};
		cur = cur[key] as Record<string, unknown>;
	}
	cur[keys[keys.length - 1]] = typeof value === 'number' && Number.isNaN(value) ? null : value;
	return JSON.stringify(obj, null, 2);
}

export interface TargetOption {
	schoolId: string;
	programId: string;
	label: string;
	isFictional: boolean;
}

export function targetOptions(ds: SchoolsDataset): TargetOption[] {
	return ds.schools.flatMap((school) =>
		school.programs.map((program) => ({
			schoolId: school.school_id,
			programId: program.program_id,
			label: `${school.name} — ${program.name}`,
			isFictional: school.is_fictional
		}))
	);
}

/** Add { school_id, program_id, term: ds.cycle } when absent, remove it when present. */
export function toggleTarget(
	text: string,
	target: { schoolId: string; programId: string },
	ds: SchoolsDataset
): string {
	const obj = JSON.parse(text) as Record<string, unknown>;
	const targets = Array.isArray(obj.targets) ? (obj.targets as { program_id?: unknown }[]) : [];
	const present = targets.some((t) => t && t.program_id === target.programId);
	obj.targets = present
		? targets.filter((t) => !(t && t.program_id === target.programId))
		: [...targets, { school_id: target.schoolId, program_id: target.programId, term: ds.cycle }];
	return JSON.stringify(obj, null, 2);
}

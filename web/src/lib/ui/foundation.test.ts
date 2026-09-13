import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import demoJson from '../core/data/profiles/demo.json';
import { requirementIds } from '../core/schemas.ts';
import {
	TONE_CLASSES,
	TONE_OUTLINE,
	traceChip,
	artifactChip,
	prereqChip,
	severityChip,
	gpaChip,
	unitsChip,
	deadlineChip,
	confidenceChip,
	fictionalChip,
	rateTone,
	runStatusChip,
	countTone,
	type Tone
} from './status.ts';
import { fmtDate, fmtDateTime, fmtPct, fmtMs, sha7, truncate, localToday } from './format.ts';
import { DATASET, DEMO_PROFILES } from './dataset.ts';
import { lookupSource, parseRequirementId } from './provenance.ts';
import {
	parseProfile,
	setField,
	toggleTarget,
	targetOptions,
	fieldIssues,
	unmappedIssues,
	FIELD_PATHS
} from './profile-form.ts';
import { loadStatic, fromSchema, HeroRunFile } from './data.ts';
import { detectMode } from './mode.ts';
import { DATA_PATHS, LIVE_SOURCE_AVAILABLE, APP_LABELS, PLAN_APP_ORDER } from './config.ts';

const TONES: Tone[] = ['ok', 'warn', 'info', 'block', 'fail', 'idle'];

describe('config', () => {
	it('exposes static data paths and app labels', () => {
		expect(DATA_PATHS.hero).toBe('data/hero-run.json');
		expect(DATA_PATHS.evals).toBe('data/evals.json');
		expect(DATA_PATHS.silentFailure).toBe('data/silent-failure-run.json');
		expect(LIVE_SOURCE_AVAILABLE).toBe(false);
		expect(APP_LABELS.calendar).toBe('Google Calendar');
		expect([...PLAN_APP_ORDER]).toEqual(['notion', 'calendar', 'docs', 'gmail']);
	});
});

describe('status', () => {
	it('maps trace statuses', () => {
		expect(traceChip('retried', 3)).toEqual({ tone: 'warn', glyph: '↻', label: 'Retried ×3' });
		expect(traceChip('deduped').label).toBe('Deduped');
		expect(traceChip('blocked').tone).toBe('block');
		expect(traceChip('failed')).toEqual({ tone: 'fail', glyph: '✕', label: 'Failed' });
	});

	it('maps artifact statuses', () => {
		expect(artifactChip('mismatch')).toEqual({
			tone: 'fail',
			glyph: '≠',
			label: 'Mismatch: reported OK, not found on read-back'
		});
		expect(artifactChip('skipped').label).toBe('Not approved');
		expect(artifactChip('verified').tone).toBe('ok');
	});

	it('maps prereqs, severities, gpa, units', () => {
		expect(prereqChip({ status: 'met', pendingCompletion: true }).label).toBe('Met (in progress)');
		expect(prereqChip({ status: 'unknown-equivalency', pendingCompletion: false })).toEqual({
			tone: 'warn',
			glyph: '?',
			label: 'Unknown equivalency'
		});
		expect(prereqChip({ status: 'missing', pendingCompletion: false }).tone).toBe('fail');
		expect(severityChip('blocker')).toEqual({ tone: 'fail', glyph: '✕', label: 'Blocker' });
		expect(severityChip('info').tone).toBe('info');
		expect(unitsChip({ status: 'short', shortfall: 6 }).label).toBe('Short by 6');
		expect(unitsChip({ status: 'met_with_in_progress', shortfall: 0 }).label).toBe(
			'Met with in-progress units'
		);
		expect(gpaChip('below_minimum').tone).toBe('fail');
		expect(gpaChip('below_competitive').tone).toBe('warn');
		expect(gpaChip('not_published').label).toBe('Not published');
		expect(fictionalChip()).toEqual({ tone: 'block', glyph: '◆', label: 'Fictional test school' });
	});

	it('maps deadlines', () => {
		expect(deadlineChip({ daysUntil: 45, status: 'upcoming' })).toEqual({
			tone: 'idle',
			glyph: '◷',
			label: '45 days left'
		});
		expect(deadlineChip({ daysUntil: 12, status: 'upcoming' })).toEqual({
			tone: 'warn',
			glyph: '◷',
			label: '12 days left'
		});
		expect(deadlineChip({ daysUntil: 0, status: 'upcoming' })).toEqual({
			tone: 'warn',
			glyph: '◷',
			label: 'Due today'
		});
		expect(deadlineChip({ daysUntil: -3, status: 'passed' })).toEqual({
			tone: 'fail',
			glyph: '✕',
			label: 'Passed 3 days ago'
		});
		expect(deadlineChip(null)).toEqual({ tone: 'idle', glyph: '–', label: 'No deadline published' });
	});

	it('maps confidence, rates, run status and counts', () => {
		expect(confidenceChip('LOW')).toMatchObject({ tone: 'warn', label: 'Low confidence: verify' });
		expect(confidenceChip('HIGH')).toMatchObject({ tone: 'idle', label: 'High confidence' });
		expect(confidenceChip('MEDIUM').label).toBe('Medium confidence');
		expect(rateTone(0.9)).toBe('ok');
		expect(rateTone(0.89)).toBe('warn');
		expect(rateTone(0.5)).toBe('warn');
		expect(rateTone(0.49)).toBe('fail');
		expect(runStatusChip('partial').label).toBe(
			'Some artifacts failed verification. See the failed items below.'
		);
		expect(runStatusChip('ok').tone).toBe('ok');
		expect(countTone(0, 'fail')).toBe('idle');
		expect(countTone(2, 'fail')).toBe('fail');
	});

	it('uses literal tone class strings', () => {
		for (const tone of TONES) {
			expect(TONE_CLASSES[tone]).toContain(`bg-${tone}-bg`);
			expect(TONE_CLASSES[tone]).toContain(`text-${tone}-fg`);
			expect(TONE_CLASSES[tone]).toContain(`border-${tone}-border`);
			expect(TONE_OUTLINE[tone]).toContain(`text-${tone}-fg`);
			expect(TONE_OUTLINE[tone]).toContain('bg-transparent');
		}
	});
});

describe('format', () => {
	it('formats dates without timezone shift', () => {
		expect(fmtDate('2026-11-30')).toBe('Nov 30, 2026');
		expect(fmtDate('2026-01-01')).toBe('Jan 1, 2026');
		expect(fmtDateTime('2026-09-13T20:02:00.000Z', 'UTC')).toBe('Sep 13, 2026, 8:02 PM');
	});

	it('formats numbers and strings', () => {
		expect(fmtPct(0.956)).toBe('96%');
		expect(fmtMs(12.4)).toBe('12 ms');
		expect(sha7('abcdef1234567')).toBe('abcdef1');
		const t = truncate('x'.repeat(200), 160);
		expect(t).toHaveLength(160);
		expect(t.endsWith('…')).toBe(true);
		expect(truncate('short', 160)).toBe('short');
		expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('provenance', () => {
	const programs = DATASET.schools.flatMap((s) => s.programs.map((p) => ({ school: s, program: p })));

	it('resolves every requirement id in the dataset', () => {
		let count = 0;
		for (const { program } of programs) {
			for (const id of requirementIds(program)) {
				const src = lookupSource(DATASET, id);
				expect(src, id).not.toBeNull();
				expect(src!.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(['HIGH', 'MEDIUM', 'LOW']).toContain(src!.confidence);
				count++;
			}
		}
		expect(count).toBeGreaterThan(20);
	});

	it('marks fictional school sources', () => {
		const fictional = programs.filter((x) => x.school.is_fictional);
		expect(fictional.length).toBeGreaterThan(0);
		const urls = fictional.flatMap(({ program }) =>
			requirementIds(program).map((id) => lookupSource(DATASET, id)!.source_url)
		);
		expect(urls).toContain('about:fictional');
	});

	it('returns null for unknown ids', () => {
		const pid = programs[0].program.program_id;
		expect(lookupSource(DATASET, 'nope#min_gpa')).toBeNull();
		expect(lookupSource(DATASET, `${pid}#course:does-not-exist`)).toBeNull();
		expect(lookupSource(DATASET, `${pid}#not_a_field`)).toBeNull();
		expect(lookupSource(DATASET, 'garbage')).toBeNull();
	});

	it('parses requirement ids', () => {
		expect(parseRequirementId('p#course:calc-1')).toEqual({ programId: 'p', kind: 'course', id: 'calc-1' });
		expect(parseRequirementId('p#min_gpa')).toEqual({ programId: 'p', kind: 'scalar', id: 'min_gpa' });
		expect(parseRequirementId('p#deadline:x#y')).toEqual({ programId: 'p', kind: 'deadline', id: 'x#y' });
		expect(parseRequirementId('garbage')).toBeNull();
	});
});

describe('profile-form', () => {
	const text = JSON.stringify(demoJson, null, 2);

	it('parses a valid profile', () => {
		const r = parseProfile(text);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.profile.profile_id).toBe('demo');
	});

	it('reports JSON syntax errors with line and column', () => {
		const r = parseProfile('{');
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.jsonError).toBeDefined();
			expect(r.jsonError!.line).toBeGreaterThanOrEqual(1);
			expect(r.jsonError!.column).toBeGreaterThanOrEqual(1);
			expect(r.jsonError!.message.length).toBeGreaterThan(0);
		}
		const r2 = parseProfile('{\n  "a": 1,\n  "b": x\n}');
		expect(r2.ok).toBe(false);
		if (!r2.ok) expect(r2.jsonError!.line).toBe(3);
	});

	it('reports zod issues by path', () => {
		const r = parseProfile(JSON.stringify({ ...demoJson, gpa: 5 }));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.issues.some((i) => i.path === 'gpa')).toBe(true);
	});

	it('sets fields by dotted path', () => {
		const a = parseProfile(setField(text, 'gpa', 3.9));
		expect(a.ok && a.profile.gpa).toBe(3.9);
		const b = parseProfile(setField(text, 'units.system', 'quarter'));
		expect(b.ok && b.profile.units.system).toBe('quarter');
		const c = parseProfile(setField(text, 'gpa', NaN));
		expect(c.ok).toBe(false);
		if (!c.ok) expect(c.issues.some((i) => i.path === 'gpa')).toBe(true);
	});

	it('toggles targets', () => {
		const opts = targetOptions(DATASET);
		const absent = opts.find((o) => !demoJson.targets.some((t) => t.program_id === o.programId))!;
		const added = toggleTarget(text, absent, DATASET);
		const parsedAdded = JSON.parse(added);
		expect(parsedAdded.targets).toContainEqual({
			school_id: absent.schoolId,
			program_id: absent.programId,
			term: DATASET.cycle
		});
		const removed = JSON.parse(toggleTarget(added, absent, DATASET));
		expect(removed.targets).toEqual(demoJson.targets);
	});

	it('splits field and unmapped issues', () => {
		const issues = [
			{ path: 'units.completed', message: 'a' },
			{ path: 'gpa', message: 'b' },
			{ path: 'targets.0.term', message: 'c' },
			{ path: 'courses.2.units', message: 'd' }
		];
		expect(fieldIssues(issues, 'units.completed')).toEqual([{ path: 'units.completed', message: 'a' }]);
		expect(fieldIssues(issues, 'targets')).toHaveLength(1);
		expect(unmappedIssues(issues)).toEqual([{ path: 'courses.2.units', message: 'd' }]);
		expect(FIELD_PATHS).toContain('terms_remaining');
	});

	it('lists target options for every program', () => {
		const opts = targetOptions(DATASET);
		const total = DATASET.schools.reduce((n, s) => n + s.programs.length, 0);
		expect(opts).toHaveLength(total);
		const fictionalIds = DATASET.schools.filter((s) => s.is_fictional).map((s) => s.school_id);
		for (const o of opts) expect(o.isFictional).toBe(fictionalIds.includes(o.schoolId));
		expect(DEMO_PROFILES.map((p) => p.id)).toEqual(['demo', 'demo-quarter']);
		expect(DEMO_PROFILES[1].profile.units.system).toBe('quarter');
	});
});

describe('data', () => {
	const schema = fromSchema(z.object({ a: z.number() }));
	const res = (status: number, body: unknown) =>
		(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

	it('loads valid data', async () => {
		expect(await loadStatic('/x', schema, res(200, { a: 1 }))).toEqual({ state: 'ok', data: { a: 1 } });
	});

	it('reports http, invalid and network errors', async () => {
		expect(await loadStatic('/x', schema, res(404, {}))).toMatchObject({
			state: 'error',
			status: 404,
			reason: 'http'
		});
		const invalid = await loadStatic('/x', schema, res(200, { a: 'x' }));
		expect(invalid).toMatchObject({ state: 'error', reason: 'invalid' });
		if (invalid.state === 'error') expect(invalid.message).toContain('a');
		const thrower = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await loadStatic('/x', schema, thrower)).toMatchObject({
			state: 'error',
			status: null,
			reason: 'network'
		});
	});

	it('parses the committed hero-run.json', () => {
		const path = fileURLToPath(new URL('../../../static/data/hero-run.json', import.meta.url));
		const raw = JSON.parse(readFileSync(path, 'utf8'));
		const r = fromSchema(HeroRunFile)(raw);
		expect(r.ok).toBe(true);
	});
});

describe('mode', () => {
	const jsonRes = (body: unknown, contentType: string, status = 200) =>
		new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

	it('forces replay without probing', async () => {
		const f1 = vi.fn();
		expect(
			await detectMode({
				url: new URL('https://x.test/?replay'),
				base: '',
				liveAvailable: true,
				fetchFn: f1 as unknown as typeof fetch
			})
		).toBe('replay');
		expect(f1).not.toHaveBeenCalled();
		const f2 = vi.fn();
		expect(
			await detectMode({
				url: new URL('https://x.test/'),
				base: '',
				liveAvailable: false,
				fetchFn: f2 as unknown as typeof fetch
			})
		).toBe('replay');
		expect(f2).not.toHaveBeenCalled();
	});

	it('probes /api/health', async () => {
		const url = new URL('https://x.test/multi-app-agent/');
		const run = (fetchFn: unknown, timeoutMs?: number) =>
			detectMode({ url, base: '/multi-app-agent', liveAvailable: true, fetchFn: fetchFn as typeof fetch, timeoutMs });

		const html = vi.fn(async () => new Response('<html>', { status: 404, headers: { 'content-type': 'text/html' } }));
		expect(await run(html)).toBe('replay');
		expect(html).toHaveBeenCalledWith('/multi-app-agent/api/health', expect.anything());

		expect(await run(async () => jsonRes({ target: 'local' }, 'application/json'))).toBe('replay');
		expect(await run(async () => jsonRes({ target: 'vercel' }, 'application/json; charset=utf-8'))).toBe('live');

		const hang = (_u: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
			});
		expect(await run(hang, 10)).toBe('replay');

		expect(
			await run(async () => {
				throw new Error('offline');
			})
		).toBe('replay');
	});
});

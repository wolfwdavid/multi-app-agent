import { describe, it, expect } from 'vitest';
import schoolsRaw from './schools.json';
import demoRaw from './profiles/demo.json';
import demoQuarterRaw from './profiles/demo-quarter.json';
import essayRaw from './fixtures/essay-doc.json';
import essayInjectionRaw from './fixtures/essay-doc-injection.json';
import inboxInjectionRaw from './fixtures/inbox-email-injection.json';
import { EssayDocFixture, InboxEmailFixture, Profile, SchoolsDataset } from '../schemas.ts';

const schools = SchoolsDataset.parse(schoolsRaw);
const programs = schools.schools.flatMap((s) => s.programs);
const demo = Profile.parse(demoRaw);
const demoQuarter = Profile.parse(demoQuarterRaw);

const wordCount = (s: string) => s.trim().split(/\s+/).length;
const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

describe('demo profiles', () => {
	it('validate against Profile', () => {
		expect(Profile.safeParse(demoRaw).success).toBe(true);
		expect(Profile.safeParse(demoQuarterRaw).success).toBe(true);
	});

	it('target only school/program pairs that exist in schools.json', () => {
		for (const profile of [demo, demoQuarter]) {
			for (const t of profile.targets) {
				const program = programs.find((p) => p.program_id === t.program_id);
				expect(program, `${profile.profile_id} -> ${t.program_id}`).toBeDefined();
				expect(program?.school_id).toBe(t.school_id);
				expect(schools.schools.some((s) => s.school_id === t.school_id)).toBe(true);
			}
		}
	});

	it('maps every satisfies id to a required course of a targeted program', () => {
		for (const profile of [demo, demoQuarter]) {
			const targeted = programs.filter((p) => profile.targets.some((t) => t.program_id === p.program_id));
			const courseIds = new Set(targeted.flatMap((p) => p.required_courses.map((c) => c.id)));
			const unknown = profile.courses.flatMap((c) => c.satisfies).filter((id) => !courseIds.has(id));
			expect(unknown, profile.profile_id).toEqual([]);
		}
	});

	it('demo uses semester units totalling 60, GPA 3.3, and targets the fictional school', () => {
		expect(demo.units.system).toBe('semester');
		expect(demo.units.completed + demo.units.in_progress).toBe(60);
		expect(demo.gpa).toBe(3.3);
		const cornellAs = programs.find((p) => p.program_id === 'cornell-as-economics');
		const berkeley = programs.find((p) => p.program_id === 'uc-berkeley-data-science-ba');
		expect(demo.gpa).toBeLessThan(cornellAs?.competitive_gpa.value ?? 0);
		expect(demo.gpa).toBeGreaterThanOrEqual(berkeley?.min_gpa.value ?? Infinity);
		expect(demo.targets.map((t) => t.program_id)).toContain('northfield-fictional-cs');
	});

	it('demo-quarter uses quarter units (4 or 5 per course) totalling 90', () => {
		expect(demoQuarter.units.system).toBe('quarter');
		expect(demoQuarter.units.completed + demoQuarter.units.in_progress).toBe(90);
		for (const c of demoQuarter.courses) expect([4, 5], c.code).toContain(c.units);
	});

	it('rejects duplicate activity or contact ids', () => {
		const dupActivity = structuredClone(demoRaw);
		dupActivity.activities[1].id = dupActivity.activities[0].id;
		expect(Profile.safeParse(dupActivity).success).toBe(false);
		const dupContact = structuredClone(demoRaw);
		dupContact.contacts[1].id = dupContact.contacts[0].id;
		expect(Profile.safeParse(dupContact).success).toBe(false);
	});
});

describe('content fixtures', () => {
	it('clean essay validates, has no injection, and is the demo essay doc', () => {
		const essay = EssayDocFixture.parse(essayRaw);
		expect(essay.adversarial).toBeNull();
		expect(essay.body.toLowerCase()).not.toContain('ignore');
		expect(essay.body).not.toContain('evil.example');
		expect(essay.doc_id).toBe(demo.essay_doc_id);
	});

	it('clean essay is over the UC 350 limit and under the Cornell 650 limit (380-480 words)', () => {
		const n = wordCount(EssayDocFixture.parse(essayRaw).body);
		expect(n).toBeGreaterThanOrEqual(380);
		expect(n).toBeLessThanOrEqual(480);
	});

	it('injection fixtures validate and carry a marker from an outside domain', () => {
		const essayInj = EssayDocFixture.parse(essayInjectionRaw);
		const inboxInj = InboxEmailFixture.parse(inboxInjectionRaw);
		const knownDomains = new Set([demo.student.email, ...demo.contacts.map((c) => c.email)].map(domainOf));
		for (const f of [essayInj, inboxInj]) {
			expect(f.adversarial).not.toBeNull();
			const marker = f.adversarial!.marker;
			expect(f.body).toContain(marker);
			expect(knownDomains.has(domainOf(marker))).toBe(false);
		}
	});

	it('injected essay is the clean essay plus the injection paragraph', () => {
		const clean = EssayDocFixture.parse(essayRaw).body.split('\n\n');
		const injected = EssayDocFixture.parse(essayInjectionRaw).body.split('\n\n');
		expect(injected).toHaveLength(clean.length + 1);
		expect(injected[2]).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
		expect([...injected.slice(0, 2), ...injected.slice(3)]).toEqual(clean);
	});

	it('rejects an injection fixture whose marker is missing from the body', () => {
		const essay = structuredClone(essayInjectionRaw);
		essay.body = essay.body.replaceAll(essay.adversarial.marker, 'someone@example.com');
		const essayResult = EssayDocFixture.safeParse(essay);
		expect(essayResult.success).toBe(false);
		expect(essayResult.error?.issues.some((i) => i.path.join('.') === 'adversarial.marker')).toBe(true);

		const email = structuredClone(inboxInjectionRaw);
		email.body = email.body.replaceAll(email.adversarial.marker, 'someone@example.com');
		expect(InboxEmailFixture.safeParse(email).success).toBe(false);
	});
});

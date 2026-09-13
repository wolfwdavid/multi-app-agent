// Evidence is read-only portfolio/profile data. The catalog is the ONLY source of truth a claim may cite (ESSAY-04, PORT-04).
import type { Profile } from '../schemas.ts';
import type { HFItem, RepoSummary } from '../connectors/types.ts';
import type { EvidenceItem, RubricCriterion, UnusedEvidence } from '../critique/types.ts';

const STOP: ReadonlySet<string> = new Set(['with', 'from', 'that', 'this', 'your', 'into', 'about']);

function normalize(t: string): string {
	return ' ' + t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

function significantTokens(t: string): string[] {
	return normalize(t)
		.trim()
		.split(' ')
		.filter((w) => w.length >= 4 && !STOP.has(w));
}

/** True when the whole term appears, or every significant token (>= 4 chars) appears as a word. */
export function isMentioned(term: string, essayText: string): boolean {
	const ne = normalize(essayText);
	const nt = normalize(term);
	if (nt.trim() !== '' && ne.includes(nt)) return true;
	const tokens = significantTokens(term);
	return tokens.length > 0 && tokens.every((t) => ne.includes(' ' + t + ' '));
}

export function buildEvidenceCatalog(
	profile: Profile,
	portfolio: { repos: readonly RepoSummary[]; hfItems: readonly HFItem[] }
): EvidenceItem[] {
	const items: EvidenceItem[] = [];
	for (const a of profile.activities) {
		items.push({
			id: `activity:${a.id}`,
			kind: 'activity',
			label: a.title,
			detail: `${a.role}: ${a.description}`,
			mentionTerm: a.title,
			portfolio: true
		});
	}
	for (const c of profile.courses) {
		if (c.status !== 'completed' && c.status !== 'in_progress') continue;
		items.push({
			id: `course:${c.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
			kind: 'course',
			label: `${c.code} ${c.title}`,
			detail: c.status + (c.grade ? `, grade ${c.grade}` : ''),
			mentionTerm: c.title,
			portfolio: false
		});
	}
	for (const r of portfolio.repos) {
		if (r.description === null) continue;
		items.push({
			id: `github:${r.name}`,
			kind: 'github',
			label: r.name,
			detail: r.description,
			...(r.url ? { url: r.url } : {}),
			mentionTerm: r.name.replace(/[-_]+/g, ' '),
			portfolio: true
		});
	}
	for (const h of portfolio.hfItems) {
		items.push({
			id: `hf:${h.id}`,
			kind: 'hf',
			label: `${h.id} (${h.kind})`,
			detail: `Hugging Face ${h.kind}; tags: ${h.tags.join(', ')}`,
			...(h.url ? { url: h.url } : {}),
			mentionTerm: (h.id.split('/').pop() ?? h.id).replace(/[-_]+/g, ' '),
			portfolio: true
		});
	}
	const seen = new Set<string>();
	return items.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export function mentionedEvidenceIds(catalog: readonly EvidenceItem[], essayText: string): string[] {
	return catalog.filter((e) => isMentioned(e.mentionTerm, essayText)).map((e) => e.id);
}

export function criterionForPrompt(prompt: string | null): RubricCriterion {
	if (prompt === null) return 'evidence';
	if (/prepared|major|academic|coursework|upper-division/i.test(prompt)) return 'academic_trajectory';
	if (/transfer|new institution|goals|future/i.test(prompt)) return 'why_transfer';
	if (/attract|fit|this (school|college|university)/i.test(prompt)) return 'why_this_school';
	return 'evidence';
}

/** Portfolio items (activities, repos, HF) the essay does not mention, mapped to the prompt's rubric criterion. */
export function findUnusedEvidence(
	catalog: readonly EvidenceItem[],
	essayText: string,
	prompt: string | null
): UnusedEvidence[] {
	const criterion = criterionForPrompt(prompt);
	return catalog
		.filter((e) => e.portfolio && !isMentioned(e.mentionTerm, essayText))
		.map((item) => ({ item, criterion }));
}

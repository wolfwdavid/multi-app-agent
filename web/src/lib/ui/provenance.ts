// requirementId → SourceRef. GapReport provenance carries sourceUrl + confidence but not retrieved_at,
// so the UI resolves the full source from the dataset.
import { SCALAR_REQUIREMENT_FIELDS } from '../core/schemas.ts';
import type { Program, SchoolsDataset, SourceRef } from '../core/schemas.ts';

export type RequirementKind = 'scalar' | 'course' | 'deadline' | 'essay';
export interface ParsedRequirementId {
	programId: string;
	kind: RequirementKind;
	id: string;
}

/** `${programId}#${field}` | `#course:${id}` | `#deadline:${id}` | `#essay:${id}`. Splits on the first '#'. */
export function parseRequirementId(requirementId: string): ParsedRequirementId | null {
	const hash = requirementId.indexOf('#');
	if (hash <= 0 || hash === requirementId.length - 1) return null;
	const programId = requirementId.slice(0, hash);
	const rest = requirementId.slice(hash + 1);
	const m = /^(course|deadline|essay):([\s\S]+)$/.exec(rest);
	if (m) return { programId, kind: m[1] as RequirementKind, id: m[2] };
	if (rest.includes(':')) return null;
	return { programId, kind: 'scalar', id: rest };
}

const programIndex = new WeakMap<SchoolsDataset, Map<string, Program>>();

function indexFor(ds: SchoolsDataset): Map<string, Program> {
	let idx = programIndex.get(ds);
	if (!idx) {
		idx = new Map(ds.schools.flatMap((s) => s.programs.map((p) => [p.program_id, p] as const)));
		programIndex.set(ds, idx);
	}
	return idx;
}

const pick = (r: SourceRef): SourceRef => ({
	source_url: r.source_url,
	additional_source_urls: r.additional_source_urls ?? [],
	retrieved_at: r.retrieved_at,
	confidence: r.confidence,
	note: r.note
});

export function lookupSource(ds: SchoolsDataset, requirementId: string): SourceRef | null {
	const parsed = parseRequirementId(requirementId);
	if (!parsed) return null;
	const program = indexFor(ds).get(parsed.programId);
	if (!program) return null;
	let ref: SourceRef | undefined;
	switch (parsed.kind) {
		case 'scalar':
			if ((SCALAR_REQUIREMENT_FIELDS as readonly string[]).includes(parsed.id)) {
				ref = program[parsed.id as (typeof SCALAR_REQUIREMENT_FIELDS)[number]];
			}
			break;
		case 'course':
			ref = program.required_courses.find((c) => c.id === parsed.id);
			break;
		case 'deadline':
			ref = program.deadlines.find((d) => d.id === parsed.id);
			break;
		case 'essay':
			ref = program.essays.find((e) => e.id === parsed.id);
			break;
	}
	return ref ? pick(ref) : null;
}

import type { Profile } from '../schemas/profile.ts';
import type { Program, School } from '../schemas/school.ts';
import type { FeasibilityWarning, GapReport } from './types.ts';

export interface WarningInput {
	profile: Profile;
	school: School;
	program: Program;
	report: Omit<GapReport, 'warnings' | 'summary'>;
}

export function buildWarnings(_input: WarningInput): FeasibilityWarning[] {
	return [];
}

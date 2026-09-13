// Seeded dataset and demo profiles, validated once at module load.
import schoolsJson from '../core/data/schools.json';
import demoJson from '../core/data/profiles/demo.json';
import demoQuarterJson from '../core/data/profiles/demo-quarter.json';
import { Profile, SchoolsDataset } from '../core/schemas.ts';

export const DATASET = SchoolsDataset.parse(schoolsJson);

export const DEMO_PROFILES = [
	{ id: 'demo', label: 'Demo student (semester units)', profile: Profile.parse(demoJson) },
	{ id: 'demo-quarter', label: 'Demo student (quarter units)', profile: Profile.parse(demoQuarterJson) }
] as const;

export type DemoProfileId = (typeof DEMO_PROFILES)[number]['id'];

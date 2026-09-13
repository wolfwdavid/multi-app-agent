import type { UnitSystem } from '../schemas/school.ts';

/** 1 semester unit = 1.5 quarter units (Berkeley 60 semester = 90 quarter, per seed data). */
export const QUARTER_UNITS_PER_SEMESTER_UNIT = 1.5;

export function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export function convertUnits(value: number, from: UnitSystem, to: UnitSystem): number {
	if (from === to) return value;
	return from === 'semester'
		? round2(value * QUARTER_UNITS_PER_SEMESTER_UNIT)
		: round2(value / QUARTER_UNITS_PER_SEMESTER_UNIT);
}

import { z } from 'zod';
import { UnitSystem } from './school.ts';

const Slug = z.string().regex(/^[a-z0-9-]+$/);

export const ProfileCourse = z.object({
	code: z.string().min(1),
	title: z.string().min(1),
	units: z.number().positive(),
	status: z.enum(['completed', 'in_progress', 'planned']),
	grade: z.string().nullable(),
	/** Dataset required_courses ids this course is known to meet. Unmapped requirement = unknown-equivalency. */
	satisfies: z.array(z.string()).default([])
});
export type ProfileCourse = z.infer<typeof ProfileCourse>;

export const Activity = z.object({
	id: Slug,
	title: z.string().min(1),
	role: z.string().min(1),
	description: z.string().min(1),
	hours_per_week: z.number().nonnegative().optional()
});
export type Activity = z.infer<typeof Activity>;

export const Contact = z.object({
	id: Slug,
	role: z.enum(['admissions_rep', 'professor', 'cc_advisor']),
	name: z.string().min(1),
	email: z.email(),
	school_id: z.string().optional()
});
export type Contact = z.infer<typeof Contact>;

export const Target = z.object({
	school_id: z.string().min(1),
	program_id: z.string().min(1),
	term: z.string().min(1)
});
export type Target = z.infer<typeof Target>;

export const Profile = z
	.object({
		profile_id: Slug,
		student: z.object({ name: z.string().min(1), email: z.email() }),
		current_school: z.object({
			name: z.string().min(1),
			kind: z.enum(['community_college', 'four_year']),
			state: z.string().length(2)
		}),
		intended_major: z.string().min(1),
		gpa: z.number().min(0).max(4),
		units: z.object({
			completed: z.number().nonnegative(),
			in_progress: z.number().nonnegative(),
			system: UnitSystem
		}),
		terms_remaining: z.number().int().nonnegative(),
		courses: z.array(ProfileCourse),
		activities: z.array(Activity),
		goals: z.string().min(1),
		targets: z.array(Target).min(1),
		contacts: z.array(Contact),
		portfolio: z.object({
			github_username: z.string().nullable(),
			hf_username: z.string().nullable()
		}),
		/** The only document the agent may read (ESSAY-01). */
		essay_doc_id: z.string().min(1)
	})
	.superRefine((p, ctx) => {
		const checkUnique = (items: { id: string }[], key: 'activities' | 'contacts') => {
			const seen = new Set<string>();
			items.forEach((item, i) => {
				if (seen.has(item.id)) {
					ctx.addIssue({
						code: 'custom',
						message: `duplicate ${key} id "${item.id}"`,
						path: [key, i, 'id']
					});
				}
				seen.add(item.id);
			});
		};
		checkUnique(p.activities, 'activities');
		checkUnique(p.contacts, 'contacts');
	});
export type Profile = z.infer<typeof Profile>;

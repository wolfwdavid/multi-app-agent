import { z } from 'zod';

export const Adversarial = z.object({
	kind: z.literal('prompt_injection'),
	/** Substring guaranteed to appear in the content; evals use it to detect leakage. */
	marker: z.string().min(1),
	description: z.string().min(1)
});
export type Adversarial = z.infer<typeof Adversarial>;

const markerInBody = (
	d: { body: string; adversarial: Adversarial | null },
	ctx: z.RefinementCtx
) => {
	if (d.adversarial && !d.body.includes(d.adversarial.marker)) {
		ctx.addIssue({ code: 'custom', message: 'marker not in body', path: ['adversarial', 'marker'] });
	}
};

export const EssayDocFixture = z
	.object({
		doc_id: z.string().min(1),
		title: z.string().min(1),
		owner_profile_id: z.string().min(1),
		body: z.string().min(1),
		adversarial: Adversarial.nullable()
	})
	.superRefine(markerInBody);
export type EssayDocFixture = z.infer<typeof EssayDocFixture>;

export const InboxEmailFixture = z
	.object({
		message_id: z.string().min(1),
		thread_id: z.string().min(1),
		from: z.email(),
		to: z.array(z.email()).min(1),
		subject: z.string().min(1),
		date: z.iso.datetime(),
		body: z.string().min(1),
		adversarial: Adversarial.nullable()
	})
	.superRefine(markerInBody);
export type InboxEmailFixture = z.infer<typeof InboxEmailFixture>;

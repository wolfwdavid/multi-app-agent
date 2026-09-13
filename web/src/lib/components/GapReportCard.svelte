<script lang="ts">
	import type { GapReport } from '$lib/core/gap';
	import {
		TONE_CLASSES,
		AI_POLICY_LABELS,
		countTone,
		deadlineChip,
		fictionalChip,
		gpaChip,
		prereqChip,
		severityChip,
		unitsChip
	} from '$lib/ui/status';
	import { fmtDate } from '$lib/ui/format';
	import StatusChip from './StatusChip.svelte';
	import SourceLink from './SourceLink.svelte';

	let { report }: { report: GapReport } = $props();

	const DEADLINE_TYPE_LABELS: Record<string, string> = {
		filing_open: 'Filing opens',
		application: 'Application due',
		docs: 'Documents due'
	};

	const n1 = (x: number) => String(Math.round(x * 10) / 10);
	const orNotPublished = (v: number | null) => (v === null ? 'not published' : String(v));
	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
	const essays = $derived([...report.essays.required, ...report.essays.optional]);
	const blockers = $derived(report.warnings.filter((w) => w.severity === 'blocker'));
	const others = $derived(report.warnings.filter((w) => w.severity !== 'blocker'));
	const rowClass = 'grid sm:grid-cols-[10rem_1fr] gap-2 py-2';
</script>

<article class="rounded-lg border border-border bg-surface p-4 sm:p-6 space-y-4">
	<div class="flex flex-wrap items-start justify-between gap-2">
		<div>
			<h3 class="text-xl font-semibold">{report.schoolName}</h3>
			<p class="text-base text-fg-muted">{report.programName} · {report.targetTerm}</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<StatusChip chip={deadlineChip(report.deadline)} />
			{#if report.deadline}
				<span class="text-sm text-fg-muted">{fmtDate(report.deadline.date)}</span>
			{/if}
			{#if report.isFictional}<StatusChip chip={fictionalChip()} />{/if}
		</div>
	</div>

	<div class="flex flex-wrap gap-2">
		<StatusChip chip={{ tone: countTone(report.summary.met, 'ok'), glyph: '✓', label: `${report.summary.met} met` }} />
		<StatusChip
			chip={{ tone: countTone(report.summary.missing, 'fail'), glyph: '✕', label: `${report.summary.missing} missing` }}
		/>
		<StatusChip
			chip={{
				tone: countTone(report.summary.unknownEquivalency, 'warn'),
				glyph: '?',
				label: `${report.summary.unknownEquivalency} unknown`
			}}
		/>
		{#if report.summary.blockers > 0}
			<StatusChip chip={{ tone: 'fail', glyph: '✕', label: plural(report.summary.blockers, 'blocker') }} />
		{/if}
	</div>

	{#snippet warningList(list: typeof report.warnings)}
		<ul class="space-y-2">
			{#each list as w, i (i)}
				<li class="rounded-md border p-2 space-y-1 {TONE_CLASSES[severityChip(w.severity).tone]}">
					<div class="flex flex-wrap items-center gap-2">
						<StatusChip chip={severityChip(w.severity)} />
						<span class="text-base">{w.message}</span>
					</div>
					<div class="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
						<span class="font-mono">{w.code}</span>
						<span aria-hidden="true">·</span>
						<SourceLink requirementId={w.requirementId} variant="compact" label={w.code} />
					</div>
				</li>
			{/each}
		</ul>
	{/snippet}

	<!-- Blockers stay visible; the full report is collapsed so the plan CTA is not thousands of pixels down. -->
	{#if blockers.length}{@render warningList(blockers)}{/if}

	<details class="rounded-md border border-border">
		<summary class="min-h-11 cursor-pointer px-2 py-2 text-sm font-semibold"
			>Full gap report: {others.length
				? `${plural(others.length, 'warning')}, `
				: ''}GPA, units, courses, essays, deadlines</summary
		>
		<div class="space-y-4 px-2 pb-2">
			{#if others.length}{@render warningList(others)}{/if}

			<dl class="divide-y divide-border">
				<div class={rowClass}>
					<dt class="text-sm font-semibold">GPA</dt>
					<dd class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-base"
								>{report.gpa.student} · minimum {orNotPublished(report.gpa.min.value)} · competitive {orNotPublished(
									report.gpa.competitive.value
								)}</span
							>
							<StatusChip chip={gpaChip(report.gpa.status)} />
						</div>
						<div><SourceLink requirementId={report.gpa.min.requirementId} /></div>
						{#if report.gpa.competitive.requirementId !== report.gpa.min.requirementId}
							<div><SourceLink requirementId={report.gpa.competitive.requirementId} /></div>
						{/if}
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">Units</dt>
					<dd class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-base">
								{#if report.units.converted}
									{n1(report.units.studentCompleted)} + {n1(report.units.studentInProgress)}
									{report.units.studentSystem} units → {n1(report.units.projectedInRequiredSystem)}
									{report.units.requiredSystem} units (converted){report.units.requiredMin === null
										? ' · no minimum published'
										: ` of ${report.units.requiredMin} required`}
								{:else if report.units.requiredMin === null}
									{n1(report.units.studentCompleted)} completed + {n1(report.units.studentInProgress)} in progress · no minimum
									published
								{:else}
									{n1(report.units.studentCompleted)} completed + {n1(report.units.studentInProgress)} in progress of
									{report.units.requiredMin}
									{report.units.requiredSystem} units
								{/if}
							</span>
							<StatusChip chip={unitsChip(report.units)} />
						</div>
						<div><SourceLink requirementId={report.units.requirementId} /></div>
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">Transfer program</dt>
					<dd class="space-y-1">
						<div class="flex flex-wrap items-center gap-2">
							{#if report.hasTransferProgram.value}
								<StatusChip chip={{ tone: 'ok', glyph: '✓', label: 'Accepts transfer applicants' }} />
							{:else}
								<span class="text-base">Does not accept transfer applicants</span>
								<StatusChip chip={severityChip('blocker')} />
							{/if}
						</div>
						<div><SourceLink requirementId={report.hasTransferProgram.requirementId} /></div>
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">Recommendations</dt>
					<dd class="space-y-1">
						<p class="text-base">
							{report.recs.required > 0
								? `${plural(report.recs.required, 'recommendation')} required`
								: 'No recommendations required'}
						</p>
						<div><SourceLink requirementId={report.recs.requirementId} /></div>
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">Essays</dt>
					<dd class="space-y-1">
						<p class="text-base">{report.essays.requiredCount} required · {report.essays.optionalCount} optional</p>
						{#if essays.length}
							<details>
								<summary class="min-h-11 cursor-pointer text-sm">Essay prompts ({essays.length})</summary>
								<ul class="space-y-2">
									{#each essays as essay (essay.essayId)}
										<li class="space-y-1">
											{#if essay.prompt}
												<p class="text-base">{essay.prompt}</p>
											{:else}
												<p class="text-base text-fg-muted">
													Prompt not publicly available; check the application portal.
												</p>
											{/if}
											<p class="text-sm text-fg-muted">
												{essay.required ? 'Required' : 'Optional'} ·
												{essay.wordLimit
													? `${essay.wordLimit} words`
													: essay.charLimit
														? `${essay.charLimit} characters`
														: 'No limit published'}
											</p>
											<div><SourceLink requirementId={essay.requirementId} /></div>
										</li>
									{/each}
								</ul>
							</details>
						{/if}
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">GE pattern</dt>
					<dd class="space-y-1">
						<p class="text-base">{report.gePattern.text ?? 'No GE pattern published'}</p>
						<div><SourceLink requirementId={report.gePattern.requirementId} /></div>
					</dd>
				</div>

				<div class={rowClass}>
					<dt class="text-sm font-semibold">AI policy</dt>
					<dd class="space-y-1">
						<p class="text-base">{AI_POLICY_LABELS[report.aiPolicy.mode] ?? report.aiPolicy.mode}</p>
						<div><SourceLink requirementId={report.aiPolicy.requirementId} /></div>
					</dd>
				</div>
			</dl>

			{#if report.prereqs.length}
				<div class="space-y-2">
					<h4 class="text-sm font-semibold">Required courses</h4>
					<ul class="space-y-2">
						{#each report.prereqs as p (p.courseId)}
							<li class="flex flex-wrap items-center gap-2">
								<StatusChip chip={prereqChip(p)} />
								<span class="text-base">{p.name}</span>
								{#if p.status === 'met' && p.matchedCourses.length}
									<span class="text-sm text-fg-muted">via {p.matchedCourses.join(', ')}</span>
								{:else if p.status === 'unknown-equivalency' && p.possibleEquivalents.length}
									<span class="text-sm text-fg-muted"
										>possible match: {p.possibleEquivalents.join(', ')}, ask an advisor</span
									>
								{:else if p.status === 'missing' && p.plannedCourses.length}
									<span class="text-sm text-fg-muted">planned: {p.plannedCourses.join(', ')}</span>
								{/if}
								<SourceLink requirementId={p.requirementId} variant="compact" label={p.name} />
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if report.allDeadlines.length}
				<details>
					<summary class="min-h-11 cursor-pointer text-sm">All deadlines ({report.allDeadlines.length})</summary>
					<ul class="space-y-1 text-sm">
						{#each report.allDeadlines as d (d.deadlineId)}
							<li class="tabular-nums">
								{DEADLINE_TYPE_LABELS[d.type] ?? d.type} · {fmtDate(d.date)} · {d.daysUntil} days
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	</details>
</article>

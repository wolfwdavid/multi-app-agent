<script lang="ts">
	import type { AppName, ContentFlag, Plan, RunReport } from '$lib/core/schemas';
	import { APP_LABELS, PLAN_APP_ORDER } from '$lib/ui/config';
	import { TONE_CLASSES, artifactChip, countTone, runStatusChip } from '$lib/ui/status';
	import { truncate } from '$lib/ui/format';
	import { DATASET } from '$lib/ui/dataset';
	import { actionTargetLabel, targetOptions } from '$lib/ui/profile-form';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let {
		report,
		plan,
		onRerun,
		rerunning = false
	}: { report: RunReport; plan: Plan; onRerun?: () => void; rerunning?: boolean } = $props();

	const banner = $derived(runStatusChip(report.status));
	const TARGETS = targetOptions(DATASET);
	const summaries = $derived(new Map(plan.actions.map((a) => [a.id, a.summary])));
	// Same-summary artifacts (e.g. two prerequisite drafts to one advisor) differ only by program, so show it.
	const targets = $derived(new Map(plan.actions.map((a) => [a.id, actionTargetLabel(a, TARGETS)])));

	const groups = $derived.by(() => {
		const order: AppName[] = [...PLAN_APP_ORDER];
		for (const a of report.artifacts) if (!order.includes(a.app)) order.push(a.app);
		return order
			.map((app) => ({ app, items: report.artifacts.filter((a) => a.app === app) }))
			.filter((g) => g.items.length > 0);
	});

	const counts = $derived([
		{ tone: countTone(report.counts.verified, 'ok'), glyph: '✓', label: `${report.counts.verified} verified` },
		{ tone: countTone(report.counts.deduped, 'info'), glyph: '=', label: `${report.counts.deduped} deduped` },
		{ tone: countTone(report.counts.failed, 'fail'), glyph: '✕', label: `${report.counts.failed} failed` },
		{ tone: countTone(report.counts.skipped, 'idle'), glyph: '–', label: `${report.counts.skipped} not approved` }
	]);

	// Mock refs (mock://…) are not browsable; only real web links get an "Open" link.
	const isWebUrl = (url?: string) => !!url && /^https?:\/\//.test(url);

	function flagTitle(f: ContentFlag): string {
		if (f.kind === 'prompt_injection') return `Ignored instruction found in ${f.source}`;
		if (f.kind === 'conflicting_deadline') return 'Conflicting deadline';
		if (f.kind === 'unsupported_claim') return 'Unsupported claim';
		return 'Flagged content';
	}

	const SECONDARY =
		'bg-bg border border-border text-fg hover:bg-surface rounded-md px-4 min-h-11 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div class="space-y-4">
	<div role="status" class="rounded-md border p-2 flex items-center gap-2 {TONE_CLASSES[banner.tone]}">
		<span aria-hidden="true">{banner.glyph}</span>
		<span class="text-base">{banner.label}</span>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each counts as chip (chip.label)}
			<StatusChip {chip} />
		{/each}
	</div>

	{#each groups as g (g.app)}
		<div class="space-y-2">
			<h3 class="text-sm font-semibold">{APP_LABELS[g.app]}</h3>
			<ul class="space-y-2">
				{#each g.items as a (a.actionId)}
					<li class="rounded-md border border-border p-2 flex flex-wrap items-center gap-2">
						<StatusChip chip={artifactChip(a.status)} />
						<span class="text-base">{summaries.get(a.actionId) ?? a.actionId}</span>
						{#if a.ref}<span class="font-mono text-sm text-fg-muted">{a.ref.id}</span>{/if}
						{#if isWebUrl(a.ref?.url)}
							<a
								href={a.ref?.url}
								target="_blank"
								rel="noopener noreferrer"
								class="text-sm text-fg underline underline-offset-2"
								>Open<span aria-hidden="true">&nbsp;↗</span><span class="sr-only"> (opens in new tab)</span></a
							>
						{/if}
						<span class="text-sm text-fg-muted tabular-nums">{a.attempts} {a.attempts === 1 ? 'attempt' : 'attempts'}</span>
						{#if targets.get(a.actionId)}<p class="basis-full text-sm text-fg-muted break-words">
								{targets.get(a.actionId)}
							</p>{/if}
						{#if a.detail}<p class="basis-full text-sm text-fg-muted break-words">{a.detail}</p>{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}

	{#if report.blockers.length > 0}
		<ul class="space-y-2">
			{#each report.blockers as b (b.code + (b.programId ?? '') + b.message)}
				<li class="rounded-md border p-2 space-y-1 {TONE_CLASSES.fail}">
					<p class="text-base">{b.message}</p>
					<p class="font-mono text-sm">{b.code}</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if report.flags.length > 0}
		<ul class="space-y-2">
			{#each report.flags as f, i (i)}
				<li class="rounded-md border p-2 space-y-1 {TONE_CLASSES.block}">
					<p class="text-sm font-semibold">{flagTitle(f)}</p>
					<blockquote class="font-mono text-sm break-words">{truncate(f.excerpt, 160)}</blockquote>
					<p class="text-sm">Treated as data. It cannot add or change actions.</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if onRerun}
		<div class="space-y-1">
			<button type="button" class={SECONDARY} disabled={rerunning} onclick={onRerun}>Run again</button>
			<p class="text-sm text-fg-muted">Same plan, same keys. Every action should come back deduped.</p>
		</div>
	{/if}
</div>

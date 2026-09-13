<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { BRIEF_URL, DATA_PATHS } from '$lib/ui/config';
	import { loadStatic, type LoadResult } from '$lib/ui/data';
	import {
		adversarialCount,
		llmModel,
		parseEvalsFile,
		parseSilentFailureRun,
		primaryModel,
		silentFailurePath,
		type EvalsFile,
		type SilentFailureRun
	} from '$lib/ui/evals';
	import { fmtDateTime, fmtPct, sha7 } from '$lib/ui/format';
	import { rateTone, type ChipSpec } from '$lib/ui/status';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import ScenarioTable from '$lib/components/ScenarioTable.svelte';
	import TaxonomyBreakdown from '$lib/components/TaxonomyBreakdown.svelte';
	import SilentFailureReplay from '$lib/components/SilentFailureReplay.svelte';

	let evalsState = $state.raw<LoadResult<EvalsFile> | null>(null);
	let sfState = $state.raw<LoadResult<SilentFailureRun> | null>(null);

	onMount(async () => {
		const loaded = await loadStatic(`${base}/${DATA_PATHS.evals}`, parseEvalsFile);
		evalsState = loaded;
		if (loaded.state === 'ok') {
			const path = silentFailurePath(loaded.data).replace(/^\/+/, '');
			sfState = await loadStatic(`${base}/${path}`, parseSilentFailureRun);
		}
	});

	const evals = $derived(evalsState?.state === 'ok' ? evalsState.data : null);
	const loadError = $derived(evalsState?.state === 'error' ? evalsState : null);
	const silentRun = $derived(sfState?.state === 'ok' ? sfState.data : null);

	const errorWhat = $derived(
		!loadError
			? ''
			: loadError.reason === 'http'
				? `HTTP ${loadError.status}`
				: loadError.reason === 'network'
					? 'a network error'
					: 'an invalid format'
	);

	function rateChip(rate: number): ChipSpec {
		const tone = rateTone(rate);
		if (tone === 'ok') return { tone, glyph: '✓', label: '90% or more' };
		if (tone === 'warn') return { tone, glyph: '!', label: '50–89%' };
		return { tone, glyph: '✕', label: 'Below 50%' };
	}

	const stats = $derived.by(() => {
		if (!evals) return [];
		const p = primaryModel(evals);
		const pt = evals.totals[p.id];
		const llm = llmModel(evals);
		const lt = llm ? evals.totals[llm.id] : undefined;
		const adv = adversarialCount(evals);
		const caught =
			sfState === null
				? { value: '…', sub: 'Loading the lying-API replay' }
				: silentRun
					? { value: silentRun.oracle.caught ? '1' : '0', sub: 'Lying-API run caught by read-back' }
					: { value: '—', sub: 'Replay file missing from this build' };
		return [
			{
				label: 'Pass rate',
				value: pt ? fmtPct(pt.passRate) : '—',
				chip: pt ? rateChip(pt.passRate) : undefined,
				sub: pt ? `${pt.passed} of ${pt.runs} runs · ${p.label}` : `No totals for ${p.label}`,
				sub2: llm && lt ? `${llm.label}: ${fmtPct(lt.passRate)}` : undefined
			},
			{
				label: 'pass^k',
				value: pt ? fmtPct(pt.passK) : '—',
				chip: undefined,
				sub: `Scenarios where all ${evals.n} runs passed`,
				sub2: llm && lt ? `${llm.label}: ${fmtPct(lt.passK)}` : undefined
			},
			{
				label: 'Scenarios',
				value: String(evals.scenarios.length),
				chip: undefined,
				sub: adv !== null ? `Including ${adv} adversarial` : 'Seeded, adversarial suite',
				sub2: undefined
			},
			{ label: 'Silent failures caught', value: caught.value, chip: undefined, sub: caught.sub, sub2: undefined }
		];
	});
</script>

<svelte:head><title>Evals · TransferPilot</title></svelte:head>

<div class="pt-8 space-y-2">
	<h1 class="text-2xl font-semibold">Eval results</h1>
	<p class="text-base text-fg-muted">
		Each scenario runs N times against stateful mock apps. A run passes only when an independent oracle finds the
		expected final app state, not when the agent says it succeeded.
	</p>
	{#if evals}
		<p class="text-sm text-fg-muted">
			Commit <span class="font-mono">{sha7(evals.commitSha)}</span> · Generated {fmtDateTime(evals.generatedAt)} · {evals.n}
			runs per scenario
		</p>
	{/if}
	<p class="text-sm">
		<a href={BRIEF_URL} target="_blank" rel="noopener noreferrer" class="text-fg underline underline-offset-2"
			>Read the reliability brief (BRIEF.md)<span aria-hidden="true"> ↗</span><span class="sr-only">
				(opens in new tab)</span
			></a
		>
	</p>
</div>

<div class="mt-8 space-y-12">
	{#if evalsState === null}
		<div class="space-y-4" aria-hidden="true">
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
				{#each [0, 1, 2, 3] as k (k)}
					<div class="motion-safe:animate-pulse h-24 rounded-lg bg-surface"></div>
				{/each}
			</div>
			<div class="motion-safe:animate-pulse h-64 rounded-lg bg-surface"></div>
		</div>
		<p class="text-sm text-fg-muted" role="status">Loading eval results…</p>
	{:else if loadError}
		<EmptyState
			tone="fail"
			heading="Couldn't load eval results"
			body={`data/evals.json returned ${errorWhat}. The numbers are also in BRIEF.md.`}
		>
			<a href={BRIEF_URL} target="_blank" rel="noopener noreferrer" class="text-sm text-fg underline underline-offset-2"
				>Read BRIEF.md<span aria-hidden="true"> ↗</span><span class="sr-only"> (opens in new tab)</span></a
			>
		</EmptyState>
	{:else if evals && evals.scenarios.length === 0}
		<EmptyState heading="No eval results yet" body="Run npx tsx scripts/eval.ts --n 10 in web/, then rebuild the site." />
	{:else if evals}
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
			{#each stats as s (s.label)}
				<StatCard label={s.label} value={s.value} sub={s.sub} sub2={s.sub2} chip={s.chip} />
			{/each}
		</div>

		<section class="space-y-4">
			<h2 class="text-xl font-semibold">Per-scenario results</h2>
			<ScenarioTable {evals} />
		</section>

		<div class="grid lg:grid-cols-12 gap-6">
			<div class="lg:col-span-4">
				<TaxonomyBreakdown {evals} />
			</div>
			<div class="lg:col-span-8">
				{#if sfState === null}
					<p class="text-sm text-fg-muted" role="status">Loading the silent-failure replay…</p>
				{:else if silentRun}
					<SilentFailureReplay run={silentRun} />
				{:else}
					<EmptyState
						heading="Replay not available"
						body="The recorded silent-failure trace is missing from this build."
					/>
				{/if}
			</div>
		</div>
	{/if}
</div>

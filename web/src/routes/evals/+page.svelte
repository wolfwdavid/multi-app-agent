<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { BRIEF_URL, DATA_PATHS } from '$lib/ui/config';
	import { loadStatic, type LoadResult } from '$lib/ui/data';
	import {
		adversarialCount,
		columnSilentFailures,
		headlinePassHatK,
		kCurve,
		knownWeaknessFailing,
		llmColumns,
		silentFailureStats,
		parseEvalsFile,
		parseSilentFailureRun,
		primaryModel,
		silentFailurePath,
		verifierComparison,
		type EvalsFile,
		type SilentFailureRun
	} from '$lib/ui/evals';
	import { fmtDateTimeUtc, fmtPct, sha7 } from '$lib/ui/format';
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
	const comparison = $derived(evals ? verifierComparison(evals) : null);
	const llms = $derived(evals ? llmColumns(evals) : []);

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
		if (tone === 'ok') return { tone, glyph: '✓', label: 'Meets 90% target' };
		if (tone === 'warn') return { tone, glyph: '!', label: 'Below 90% target' };
		return { tone, glyph: '✕', label: 'Below 50%' };
	}

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	// Headline cards use the scripted baseline only; LLM columns are reported in their own section below.
	const stats = $derived.by(() => {
		if (!evals) return [];
		const p = primaryModel(evals);
		const pt = evals.totals[p.id];
		const adv = adversarialCount(evals);
		const weak = knownWeaknessFailing(evals, p.id);
		const replay =
			sfState === null
				? 'Loading the lying-API replay'
				: silentRun
					? silentRun.oracle.caught
						? 'Lying-API replay: caught by read-back'
						: 'Lying-API replay: missed by read-back'
					: 'Replay file missing from this build';
		// Headline the uncaught count from the eval totals; the single replay is supporting evidence, not the number.
		const sf = silentFailureStats(evals);
		const silentCard = sf
			? {
					label: 'Uncaught silent failures',
					value: String(sf.uncaught),
					sub:
						sf.uncaught === 0
							? `None in ${pt?.runs ?? 0} runs · ${p.label}`
							: sf.knownWeaknessScenarios === sf.scenarios
								? `All in ${plural(sf.scenarios, 'known-weakness scenario')} · ${p.label}`
								: `Across ${plural(sf.scenarios, 'scenario')} · ${p.label}`,
					sub2: sf.comparison ? `${sf.comparison.label}: ${sf.comparison.uncaught}` : undefined,
					sub3: replay
				}
			: {
					label: 'Silent failures caught',
					value: sfState === null ? '…' : silentRun ? (silentRun.oracle.caught ? '1' : '0') : '—',
					sub: replay
				};

		// Real pass^k (tau-bench estimate) at k = N, averaged over scenarios; boolean share only for older files.
		const head = headlinePassHatK(evals, p);
		const curve = kCurve(evals, p.id) ?? [];
		const passKCard = head
			? {
					label: `pass^${head.k} · all ${head.k} runs pass`,
					value: fmtPct(head.mean),
					sub: `Mean over ${plural(head.scenarios, 'scenario')} · ${p.label}`,
					// A no-break space (\u00a0) keeps each "k=10 87%" pair on one line; only the " · " separators may wrap.
					sub2: curve.map((c) => `k=${c.k}\u00a0${fmtPct(c.mean)}`).join(' · '),
					bars: curve.map((c) => ({ label: `k=${c.k}`, value: c.mean }))
				}
			: {
					label: 'pass^k',
					value: pt ? fmtPct(pt.passK) : '—',
					sub: `Share of scenarios where all ${evals.n} runs passed · ${p.label}`
				};

		return [
			{
				label: 'Pass rate',
				value: pt ? fmtPct(pt.passRate) : '—',
				chip: pt ? rateChip(pt.passRate) : undefined,
				sub: pt ? `${pt.passed} of ${pt.runs} runs · ${p.label}` : `No totals for ${p.label}`,
				sub3: weak > 0 ? `Includes ${plural(weak, 'known-weakness scenario')} that fail` : undefined
			},
			passKCard,
			{
				label: 'Scenarios',
				value: String(evals.scenarios.length),
				sub: adv !== null ? `Including ${adv} adversarial` : 'Seeded, adversarial suite'
			},
			silentCard
		] as {
			label: string;
			value: string;
			sub: string;
			sub2?: string;
			sub3?: string;
			chip?: ChipSpec;
			bars?: { label: string; value: number }[];
		}[];
	});

	const ratio = (passed: number, runs: number) => `${passed}/${runs} runs`;
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
			Eval commit <span class="font-mono">{sha7(evals.commitSha)}</span> · Generated {fmtDateTimeUtc(evals.generatedAt)} ·
			{evals.n} runs per scenario (scripted baseline)
		</p>
	{/if}
	<p class="text-sm">
		<a href={BRIEF_URL} target="_blank" rel="noopener noreferrer" class="text-fg underline underline-offset-2"
			>Read the reliability brief (BRIEF.md)<span aria-hidden="true">&nbsp;↗</span><span class="sr-only">
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
				>Read BRIEF.md<span aria-hidden="true">&nbsp;↗</span><span class="sr-only"> (opens in new tab)</span></a
			>
		</EmptyState>
	{:else if evals && evals.scenarios.length === 0}
		<EmptyState heading="No eval results yet" body="Run npx tsx scripts/eval.ts --n 10 in web/, then rebuild the site." />
	{:else if evals}
		<div class="space-y-4">
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
				{#each stats as s (s.label)}
					<StatCard
						label={s.label}
						value={s.value}
						sub={s.sub}
						sub2={s.sub2}
						sub3={s.sub3}
						chip={s.chip}
						bars={s.bars}
					/>
				{/each}
			</div>

			{#if comparison}
				<section aria-labelledby="verifier-compare" class="rounded-lg border border-border p-4 space-y-2">
					<h2 id="verifier-compare" class="text-xl font-semibold">Verifier on vs verifier off</h2>
					<p class="text-sm text-fg-muted">
						Same scripted policy and scenarios. The "before" config's report trusts the executor instead of read-back.
						Totals from evals.json.
					</p>
					<div class="overflow-x-auto">
						<table class="w-full min-w-[480px] text-sm">
							<caption class="sr-only">Totals with the verifier on and off</caption>
							<thead>
								<tr class="text-left align-bottom">
									<th scope="col" class="p-2 font-semibold">Metric</th>
									<th scope="col" class="p-2 font-semibold">{comparison.on.label}</th>
									<th scope="col" class="p-2 font-semibold">{comparison.off.label}</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-border tabular-nums">
								<tr>
									<th scope="row" class="p-2 text-left font-normal">Pass rate</th>
									<td class="p-2"
										><span class="font-semibold">{fmtPct(comparison.on.passRate)}</span>
										<span class="text-fg-muted">· {ratio(comparison.on.passed, comparison.on.runs)}</span></td
									>
									<td class="p-2"
										><span class="font-semibold">{fmtPct(comparison.off.passRate)}</span>
										<span class="text-fg-muted">· {ratio(comparison.off.passed, comparison.off.runs)}</span></td
									>
								</tr>
								{#if comparison.on.passHatN && comparison.off.passHatN}
									<tr>
										<th scope="row" class="p-2 text-left font-normal">pass^{comparison.on.passHatN.k} (mean)</th>
										<td class="p-2 font-semibold">{fmtPct(comparison.on.passHatN.mean)}</td>
										<td class="p-2 font-semibold">{fmtPct(comparison.off.passHatN.mean)}</td>
									</tr>
								{/if}
								{#if comparison.on.silentFailures !== null && comparison.off.silentFailures !== null}
									<tr>
										<th scope="row" class="p-2 text-left font-normal">Uncaught silent failures</th>
										<td class="p-2 font-semibold">{comparison.on.silentFailures}</td>
										<td class="p-2 font-semibold">{comparison.off.silentFailures}</td>
									</tr>
								{/if}
							</tbody>
						</table>
					</div>
				</section>
			{/if}
		</div>

		{#if llms.length}
			<section aria-labelledby="llm-columns" class="rounded-lg border border-border p-4 space-y-4">
				<div class="space-y-1">
					<h2 id="llm-columns" class="text-xl font-semibold">Real LLM columns</h2>
					<p class="text-sm text-fg-muted">
						Reported on their own. The headline cards above use the scripted baseline only, and scenarios an LLM column
						did not run show "Not run" in the table.
					</p>
				</div>
				<ul class="space-y-4">
					{#each llms as c (c.model.id)}
						{@const sf = columnSilentFailures(evals, c.model.id)}
						<li class="space-y-1 text-sm">
							<p class="text-base font-semibold">{c.model.label}</p>
							{#if c.meta}<p class="font-mono text-fg-muted">{c.meta}</p>{/if}
							<p class="tabular-nums">
								{#if c.coverage.passRate !== null}
									<span class="font-semibold">{fmtPct(c.coverage.passRate)}</span> pass rate · {ratio(
										c.coverage.passed,
										c.coverage.runs
									)}
								{:else}
									No completed runs
								{/if}
								· N={c.coverage.n} per scenario · {c.coverage.scenariosRun} of {c.coverage.scenariosTotal} scenarios run
							</p>
							{#if sf}
								<p class="tabular-nums">
									<span class="font-semibold">{sf.uncaught}</span>
									uncaught silent {sf.uncaught === 1 ? 'failure' : 'failures'}{#if sf.scenarios.length}{' · '}<span
											class="font-mono">{sf.scenarios.map((s) => (s.count > 1 ? `${s.id} ×${s.count}` : s.id)).join(', ')}</span
										>{/if}
								</p>
								{#if sf.uncaught > 0}
									<p class="text-fg-muted">
										{sf.uncaught === 1 ? 'In that run' : 'In each of those runs'}, the run report said ok while the oracle
										found the goal unmet{#if sf.classes.length}; failure class recorded: {sf.classes.join(', ')}{/if}.
									</p>
								{/if}
							{/if}
							{#if c.coverage.partial}
								<p class="text-fg-muted">
									Partial column: a small sample, not comparable to the {evals.n}-run scripted baseline.
								</p>
							{/if}
							{#if c.model.commitSha || c.model.generatedAt}
								<p class="text-fg-muted">
									{#if c.model.commitSha}Eval commit <span class="font-mono">{sha7(c.model.commitSha)}</span>{/if}
									{#if c.model.commitSha && c.model.generatedAt}
										·
									{/if}
									{#if c.model.generatedAt}Generated {fmtDateTimeUtc(c.model.generatedAt)}{/if}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="space-y-4">
			<h2 class="text-xl font-semibold">Per-scenario results</h2>
			<ScenarioTable {evals} />
		</section>

		<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
			<div class="min-w-0 lg:col-span-4">
				<TaxonomyBreakdown {evals} />
			</div>
			<div class="min-w-0 lg:col-span-8">
				{#if sfState === null}
					<p class="text-sm text-fg-muted" role="status">Loading the silent-failure replay…</p>
				{:else if silentRun}
					<p class="mb-2 text-sm text-fg-muted">
						Replay recorded {fmtDateTimeUtc(silentRun.recordedAt)} · replay commit
						<span class="font-mono">{sha7(silentRun.commitSha)}</span>
					</p>
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

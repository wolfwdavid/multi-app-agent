<script lang="ts">
	import {
		FAILURE_LABELS,
		coverageTag,
		isKnownWeakness,
		passHatK,
		scenarioAllPassed,
		topFailureFor,
		type EvalScenario,
		type EvalsFile,
		type ScenarioResult
	} from '$lib/ui/evals';
	import { REPO_URL } from '$lib/ui/config';
	import { fmtPct } from '$lib/ui/format';
	import { rateTone } from '$lib/ui/status';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let { evals }: { evals: EvalsFile } = $props();

	// The committed eval tables list the Phase 5 known weaknesses (W1-W3) with their failure classes.
	const WEAKNESS_URL = `${REPO_URL}/blob/main/web/static/data/evals.md`;

	// Literal class names so Tailwind generates them.
	const BAR_CLASSES: Record<string, string> = {
		ok: 'bg-ok-fg',
		warn: 'bg-warn-fg',
		fail: 'bg-fail-fg'
	};
	const TEXT_CLASSES: Record<string, string> = {
		ok: 'text-ok-fg',
		warn: 'text-warn-fg',
		fail: 'text-fail-fg'
	};

	const pct = (rate: number) => Math.round(rate * 100);

	/** pass^k at k = this result's run count (k = N), plus the smaller reported k values. */
	function kView(r: ScenarioResult) {
		const entries = passHatK(r);
		if (!entries) return null;
		const head = entries.find((e) => e.k === r.runs) ?? entries[entries.length - 1];
		return { head, rest: entries.filter((e) => e !== head) };
	}

	// The table scrolls sideways when the model columns do not fit; show a hint only then.
	let wrapWidth = $state(0);
	let tableWidth = $state(0);
	const overflowing = $derived(wrapWidth > 0 && tableWidth > wrapWidth + 1);
</script>

{#snippet scenarioHead(s: EvalScenario)}
	<span class="block text-fg">{s.name}</span>
	<span class="block font-mono text-fg-muted">{s.id}</span>
	{#if isKnownWeakness(s)}
		<details class="mt-1">
			<summary
				class="min-h-11 inline-flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 [&::-webkit-details-marker]:hidden"
			>
				<span class="whitespace-nowrap"
					><StatusChip chip={{ tone: 'warn', glyph: '!', label: 'Known weakness' }} /></span
				>
				<span class="text-sm underline underline-offset-2">Why</span>
			</summary>
			<div class="space-y-1 pt-1">
				<p class="text-sm font-semibold">Fails by design: a documented weakness this scenario keeps visible.</p>
				<p class="text-sm text-fg-muted">{s.description}</p>
				<a
					href={WEAKNESS_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="text-sm text-fg underline underline-offset-2"
					>Known weaknesses W1-W3 in the eval tables<span aria-hidden="true">&nbsp;↗</span><span class="sr-only">
						(opens in new tab)</span
					></a
				>
			</div>
		</details>
	{/if}
{/snippet}

{#snippet rateCell(r: ScenarioResult)}
	{@const top = topFailureFor(r)}
	<div class="space-y-1">
		<span class="tabular-nums">{fmtPct(r.passRate)} <span class="text-fg-muted">· {r.passed}/{r.runs} runs</span></span>
		<div class="h-2 w-full min-w-16 rounded-full bg-border" aria-hidden="true">
			<div class="h-2 rounded-full {BAR_CLASSES[rateTone(r.passRate)]}" style="width: {pct(r.passRate)}%"></div>
		</div>
		{#if top}
			<div class="pt-1">
				<span class="sr-only">Top failure: </span><StatusChip
					chip={{ tone: 'idle', glyph: '', label: FAILURE_LABELS[top].label }}
				/>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet kCell(r: ScenarioResult)}
	{@const kv = kView(r)}
	{#if kv}
		<div class="space-y-1 tabular-nums">
			<span class="block whitespace-nowrap"
				>pass^{kv.head.k}
				<span class="font-semibold {TEXT_CLASSES[rateTone(kv.head.value)]}">{fmtPct(kv.head.value)}</span></span
			>
			{#if kv.rest.length}
				<span class="block whitespace-nowrap text-fg-muted"
					>{kv.rest.map((e) => `k=${e.k} ${fmtPct(e.value)}`).join(' · ')}</span
				>
			{/if}
		</div>
	{:else if scenarioAllPassed(r)}
		<StatusChip chip={{ tone: 'ok', glyph: '✓', label: `All ${r.runs} passed` }} />
	{:else}
		<StatusChip chip={{ tone: 'fail', glyph: '✕', label: 'Not all' }} />
	{/if}
{/snippet}

<p class="text-sm text-fg-muted">
	pass^k is the chance that k runs in a row all pass (tau-bench estimate C(c,k)/C(n,k)); pass^N at k = N means every run
	passed. A failure class shows only in a column below 100%.
</p>

<!-- Below sm: one stacked card per scenario instead of a clipped wide table. -->
<ul class="sm:hidden space-y-4">
	{#each evals.scenarios as s (s.id)}
		<li class="rounded-lg border border-border p-4 space-y-2 text-sm">
			<div>{@render scenarioHead(s)}</div>
			<dl class="divide-y divide-border">
				{#each evals.models as m (m.id)}
					{@const r = s.results[m.id]}
					<div class="py-2 space-y-1">
						<dt class="font-semibold">
							{m.label} <span class="font-normal text-fg-muted">· {coverageTag(evals, m)}</span>
						</dt>
						<dd class="space-y-2">
							{#if r}
								{@render rateCell(r)}
								{@render kCell(r)}
							{:else}
								<span class="text-fg-muted">Not run</span>
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		</li>
	{/each}
</ul>

<div class="hidden sm:block space-y-2">
	{#if overflowing}
		<p class="text-sm text-fg-muted">
			Scroll the table sideways to see every model column <span aria-hidden="true">→</span>
		</p>
	{/if}
	<div class="overflow-x-auto rounded-lg border border-border" bind:clientWidth={wrapWidth}>
		<table class="w-full min-w-[640px] text-sm" bind:offsetWidth={tableWidth}>
			<caption class="sr-only">Pass rate and pass^k per scenario and model</caption>
			<thead class="bg-surface">
				<tr class="text-left align-bottom">
					<th scope="col" class="p-2 font-semibold min-w-52">Scenario</th>
					{#each evals.models as m (m.id)}
						<th scope="col" class="p-2 font-semibold"
							>Pass rate · {m.label}<span class="block font-normal text-fg-muted">{coverageTag(evals, m)}</span></th
						>
						<th scope="col" class="p-2 font-semibold"
							>pass^k · {m.label}<span class="block font-normal text-fg-muted">k = N, then smaller k</span></th
						>
					{/each}
				</tr>
			</thead>
			<tbody class="divide-y divide-border">
				{#each evals.scenarios as s (s.id)}
					<tr class="align-top">
						<th scope="row" class="p-2 text-left font-normal">{@render scenarioHead(s)}</th>
						{#each evals.models as m (m.id)}
							{@const r = s.results[m.id]}
							{#if r}
								<td class="p-2">{@render rateCell(r)}</td>
								<td class="p-2">{@render kCell(r)}</td>
							{:else}
								<td class="p-2 text-fg-muted" colspan="2">Not run</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

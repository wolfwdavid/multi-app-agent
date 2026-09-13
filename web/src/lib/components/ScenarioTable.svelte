<script lang="ts">
	import {
		FAILURE_LABELS,
		primaryModel,
		scenarioAllPassed,
		topFailure,
		type EvalScenario,
		type EvalsFile
	} from '$lib/ui/evals';
	import { fmtPct } from '$lib/ui/format';
	import { rateTone } from '$lib/ui/status';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let { evals }: { evals: EvalsFile } = $props();

	const primary = $derived(primaryModel(evals));

	// Literal class names so Tailwind generates them.
	const BAR_CLASSES: Record<string, string> = {
		ok: 'bg-ok-fg',
		warn: 'bg-warn-fg',
		fail: 'bg-fail-fg'
	};

	function runsFor(s: EvalScenario): number {
		return s.results[primary.id]?.runs ?? Math.max(0, ...Object.values(s.results).map((r) => r.runs));
	}

	const pct = (rate: number) => Math.round(rate * 100);
</script>

<div class="overflow-x-auto rounded-lg border border-border">
	<table class="w-full min-w-[640px] text-sm">
		<caption class="sr-only">Pass rate per scenario and model</caption>
		<thead class="bg-surface">
			<tr class="text-left align-bottom">
				<th scope="col" class="p-2 font-semibold">Scenario</th>
				<th scope="col" class="p-2 font-semibold">Runs</th>
				{#each evals.models as m (m.id)}
					<th scope="col" class="p-2 font-semibold">Pass rate · {m.label}</th>
					<th scope="col" class="p-2 font-semibold">pass^k · {m.label}</th>
				{/each}
				<th scope="col" class="p-2 font-semibold">Top failure</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-border">
			{#each evals.scenarios as s (s.id)}
				{@const top = topFailure(s)}
				<tr class="align-top">
					<th scope="row" class="p-2 text-left font-normal">
						<span class="block text-fg">{s.name}</span>
						<span class="block font-mono text-fg-muted">{s.id}</span>
					</th>
					<td class="p-2 tabular-nums">{runsFor(s)}</td>
					{#each evals.models as m (m.id)}
						{@const r = s.results[m.id]}
						{#if r}
							<td class="p-2">
								<div class="space-y-1">
									<span class="tabular-nums">{fmtPct(r.passRate)}</span>
									<div class="h-2 w-full min-w-16 rounded-full bg-border" aria-hidden="true">
										<div
											class="h-2 rounded-full {BAR_CLASSES[rateTone(r.passRate)]}"
											style="width: {pct(r.passRate)}%"
										></div>
									</div>
								</div>
							</td>
							<td class="p-2">
								{#if scenarioAllPassed(r)}
									<StatusChip chip={{ tone: 'ok', glyph: '✓', label: 'All passed' }} />
								{:else}
									<StatusChip chip={{ tone: 'fail', glyph: '✕', label: 'Not all' }} />
								{/if}
							</td>
						{:else}
							<td class="p-2 text-fg-muted" colspan="2">Not run</td>
						{/if}
					{/each}
					<td class="p-2">
						{#if top}
							<StatusChip chip={{ tone: 'idle', glyph: '', label: FAILURE_LABELS[top].label }} />
						{:else}
							<span class="text-fg-muted">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

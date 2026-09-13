<script lang="ts">
	import { primaryModel, taxonomy, type EvalsFile } from '$lib/ui/evals';

	let { evals }: { evals: EvalsFile } = $props();

	let picked = $state<string | null>(null);
	const modelId = $derived(
		picked !== null && evals.models.some((m) => m.id === picked) ? picked : primaryModel(evals).id
	);
	const t = $derived(taxonomy(evals, modelId));
</script>

<div class="space-y-4">
	<div class="space-y-1">
		<h2 class="text-xl font-semibold">Failure taxonomy</h2>
		<p class="text-sm text-fg-muted">Failed runs by primary failure class, summed across scenarios.</p>
	</div>
	{#if evals.models.length > 1}
		<label class="flex flex-col gap-1 text-sm">
			Model
			<select class="min-h-11 rounded-md text-sm" onchange={(e) => (picked = e.currentTarget.value)}>
				{#each evals.models as m (m.id)}
					<option value={m.id} selected={m.id === modelId}>{m.label}</option>
				{/each}
			</select>
		</label>
	{/if}
	<ul class="space-y-4">
		{#each t.entries as e (e.cls)}
			<li class="space-y-1">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-semibold">{e.label}</span>
					<span class={['text-sm tabular-nums', e.count === 0 ? 'text-fg-muted' : 'text-fg']}>{e.count}</span>
				</div>
				{#if e.count > 0 && t.max > 0}
					<div
						class="h-2 rounded-full bg-fail-fg"
						style="width: {Math.round((e.count / t.max) * 100)}%"
						aria-hidden="true"
					></div>
				{/if}
				<p class="text-sm text-fg-muted">{e.definition}</p>
			</li>
		{/each}
	</ul>
</div>

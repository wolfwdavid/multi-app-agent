<script lang="ts">
	import type { ChipSpec } from '$lib/ui/status';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let {
		label,
		value,
		sub,
		sub2,
		sub3,
		chip,
		bars
	}: {
		label: string;
		value: string;
		sub: string;
		sub2?: string;
		sub3?: string;
		chip?: ChipSpec;
		/** Small decorative curve (e.g. pass^k by k); the same numbers must also appear in a sub line. */
		bars?: { label: string; value: number }[];
	} = $props();
</script>

<div class="rounded-lg border border-border bg-surface p-4 space-y-1">
	<p class="text-sm text-fg-muted">{label}</p>
	<div class="flex flex-wrap items-center gap-2">
		<p class="text-2xl font-semibold tabular-nums text-fg">{value}</p>
		{#if chip}<StatusChip {chip} />{/if}
	</div>
	<p class="text-sm text-fg-muted">{sub}</p>
	{#if sub2}<p class="text-sm text-fg-muted">{sub2}</p>{/if}
	{#if sub3}<p class="text-sm text-fg-muted">{sub3}</p>{/if}
	{#if bars?.length}
		<div class="flex items-end gap-2 pt-1" aria-hidden="true">
			{#each bars as b (b.label)}
				<div class="flex flex-1 flex-col items-center gap-1">
					<div class="flex h-8 w-full items-end rounded-sm bg-border">
						<div class="w-full rounded-sm bg-accent" style="height: {Math.round(b.value * 100)}%"></div>
					</div>
					<span class="text-sm text-fg-muted tabular-nums">{b.label}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

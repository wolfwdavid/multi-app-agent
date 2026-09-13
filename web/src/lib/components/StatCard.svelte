<script lang="ts">
	import type { ChipSpec } from '$lib/ui/status';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let {
		label,
		value,
		sub,
		sub2,
		chip
	}: { label: string; value: string; sub: string; sub2?: string; chip?: ChipSpec } = $props();
</script>

<div class="rounded-lg border border-border bg-surface p-4 space-y-1">
	<p class="text-sm text-fg-muted">{label}</p>
	<div class="flex flex-wrap items-center gap-2">
		<p class="text-2xl font-semibold tabular-nums text-fg">{value}</p>
		{#if chip}<StatusChip {chip} />{/if}
	</div>
	<p class="text-sm text-fg-muted">{sub}</p>
	{#if sub2}<p class="text-sm text-fg-muted">{sub2}</p>{/if}
</div>

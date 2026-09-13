<script lang="ts">
	import { DATASET } from '$lib/ui/dataset';
	import { lookupSource } from '$lib/ui/provenance';
	import { fmtDate } from '$lib/ui/format';
	import ConfidenceBadge from './ConfidenceBadge.svelte';

	let {
		requirementId,
		variant = 'full',
		label = 'this requirement'
	}: { requirementId: string; variant?: 'full' | 'compact'; label?: string } = $props();

	const src = $derived(lookupSource(DATASET, requirementId));
	const fictional = $derived(src?.source_url === 'about:fictional');
</script>

{#if src}
	<span class="inline-flex flex-wrap items-center gap-2 text-sm text-fg-muted">
		{#if fictional}
			<span>Fictional school: no official page</span>
		{:else if variant === 'compact'}
			<a
				href={src.source_url}
				target="_blank"
				rel="noopener noreferrer"
				class="text-fg underline underline-offset-2"
				aria-label="Verify {label} on the official page (opens in new tab)"
				>Verify<span aria-hidden="true">&nbsp;↗</span></a
			>
		{:else}
			<a href={src.source_url} target="_blank" rel="noopener noreferrer" class="text-fg underline underline-offset-2"
				>Verify on official page<span aria-hidden="true">&nbsp;↗</span><span class="sr-only"> (opens in new tab)</span></a
			>
		{/if}
		<span>· Retrieved {fmtDate(src.retrieved_at)}</span>
		<ConfidenceBadge confidence={src.confidence} note={src.note} />
		{#if src.note && variant === 'full'}
			<details class="w-full">
				<summary class="cursor-pointer">Source note</summary>
				<p>{src.note}</p>
			</details>
		{/if}
	</span>
{:else}
	<span class="text-sm text-fg-muted">Source not found</span>
{/if}

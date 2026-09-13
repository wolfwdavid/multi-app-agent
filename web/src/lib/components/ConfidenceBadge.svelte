<script lang="ts">
	import type { Confidence } from '$lib/core/schemas';
	import { TONE_OUTLINE, confidenceChip } from '$lib/ui/status';

	let { confidence, note }: { confidence: Confidence; note?: string } = $props();
	const chip = $derived(confidenceChip(confidence));
</script>

<span
	class="inline-flex items-center rounded-md border px-2 py-1 text-sm font-semibold {TONE_OUTLINE[chip.tone]}"
	title={note}>{chip.label}</span
>

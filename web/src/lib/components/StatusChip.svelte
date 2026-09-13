<script lang="ts">
	import { TONE_CLASSES, type ChipSpec } from '$lib/ui/status';

	let { chip }: { chip: ChipSpec } = $props();
</script>

<span
	class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm font-semibold {TONE_CLASSES[chip.tone]}"
	><span aria-hidden="true">{chip.glyph}</span>{chip.label}</span
>

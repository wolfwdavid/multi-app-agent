<script lang="ts">
	import { BRIEF_URL } from '$lib/ui/config';
</script>

<svelte:head><title>Evals · TransferPilot</title></svelte:head>

<div class="pt-8 space-y-2">
	<h1 class="text-2xl font-semibold">Eval results</h1>
	<p class="text-base text-fg-muted">
		Each scenario runs N times against stateful mock apps. A run passes only when an independent oracle finds the
		expected final app state, not when the agent says it succeeded.
	</p>
	<p class="text-sm">
		<a href={BRIEF_URL} target="_blank" rel="noopener noreferrer" class="text-fg underline underline-offset-2"
			>Read the reliability brief (BRIEF.md)<span aria-hidden="true"> ↗</span><span class="sr-only">
				(opens in new tab)</span
			></a
		>
	</p>
</div>

<p class="mt-8 text-sm text-fg-muted" role="status">Loading eval results…</p>

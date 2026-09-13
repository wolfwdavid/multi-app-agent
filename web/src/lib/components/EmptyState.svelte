<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		heading,
		body,
		tone = 'idle',
		children
	}: { heading: string; body: string; tone?: 'idle' | 'fail'; children?: Snippet } = $props();
</script>

<div
	class={[
		'rounded-lg border border-dashed p-6 text-center space-y-2',
		tone === 'fail' ? 'border-fail-border' : 'border-border'
	]}
>
	<p class="text-base font-semibold">{heading}</p>
	<p class="text-sm text-fg-muted">{body}</p>
	{@render children?.()}
</div>

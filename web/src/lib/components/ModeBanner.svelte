<script lang="ts">
	import type { HeroRunFile, LoadResult } from '$lib/ui/data';
	import { LIVE_URL } from '$lib/ui/config';
	import { fmtDate, sha7 } from '$lib/ui/format';

	let { hero }: { hero: LoadResult<HeroRunFile> | null } = $props();

	const recording = $derived(hero?.state === 'ok' ? hero.data : null);
</script>

<div class="bg-info-bg text-info-fg border-b border-info-border">
	<p class="mx-auto max-w-6xl px-4 sm:px-6 py-2 text-sm">
		<strong class="font-semibold">Recorded run.</strong>
		{#if recording}
			This static site replays a mock-mode run recorded on {fmtDate(recording.recordedAt.slice(0, 10))} (commit
			<code class="font-mono">{sha7(recording.commitSha)}</code>).
		{:else}
			This static site replays a recorded mock-mode run.
		{/if}
		Gap analysis runs live in your browser; the plan, trace and results come from the recording. Personal details in
		the recording are redacted.
		{#if LIVE_URL}
			<a href={LIVE_URL} target="_blank" rel="noopener noreferrer" class="underline underline-offset-2"
				>Open the live version<span aria-hidden="true">&nbsp;↗</span><span class="sr-only"> (opens in new tab)</span></a
			>
		{/if}
	</p>
</div>

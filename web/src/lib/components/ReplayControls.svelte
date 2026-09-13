<script lang="ts">
	import { REPLAY_SPEEDS } from '$lib/ui/config';

	let {
		playing,
		index,
		total,
		onPlay,
		onPause,
		onStep,
		onPrev,
		onRestart,
		speedMs,
		onSpeed
	}: {
		playing: boolean;
		index: number;
		total: number;
		onPlay: () => void;
		onPause: () => void;
		onStep: () => void;
		onPrev?: () => void;
		onRestart: () => void;
		speedMs?: number;
		onSpeed?: (ms: number) => void;
	} = $props();

	const SECONDARY =
		'bg-bg border border-border text-fg hover:bg-surface rounded-md px-4 min-h-11 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<div class="flex flex-wrap items-center gap-2">
	{#if onPrev}
		<button type="button" class={SECONDARY} disabled={index <= 0} onclick={onPrev}>Previous step</button>
		<button
			type="button"
			class="bg-accent text-accent-fg hover:bg-accent-hover rounded-md px-4 min-h-11 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
			disabled={index >= total}
			onclick={onStep}>Next step</button
		>
	{/if}
	<button type="button" class={SECONDARY} aria-pressed={playing} onclick={() => (playing ? onPause() : onPlay())}
		>{playing ? 'Pause' : 'Play'}</button
	>
	{#if !onPrev}
		<button type="button" class={SECONDARY} disabled={playing} onclick={onStep}>Step</button>
	{/if}
	<button type="button" class={SECONDARY} onclick={onRestart}>Restart</button>
	{#if onSpeed}
		<label class="inline-flex items-center gap-2 text-sm">
			Speed
			<select class="min-h-11 rounded-md text-sm" onchange={(e) => onSpeed(Number(e.currentTarget.value))}>
				{#each REPLAY_SPEEDS as s (s.id)}
					<option value={s.ms} selected={s.ms === speedMs}>{s.label}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if onPrev}
		<span class="text-sm tabular-nums" aria-live="polite">Step {index} of {total}</span>
	{/if}
</div>

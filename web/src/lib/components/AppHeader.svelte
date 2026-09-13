<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import type { AppMode } from '$lib/ui/mode';
	import type { ChipSpec } from '$lib/ui/status';
	import { REPO_URL } from '$lib/ui/config';
	import StatusChip from './StatusChip.svelte';

	let { mode }: { mode: AppMode } = $props();

	// Route ids are base-independent, so prerendered relative links stay correct under /multi-app-agent.
	const sprintActive = $derived(page.route.id === '/');
	const evalsActive = $derived(page.route.id?.startsWith('/evals') ?? false);

	const pill = $derived<ChipSpec>(
		mode === 'live'
			? { tone: 'ok', glyph: '●', label: 'Live · mock apps' }
			: mode === 'replay'
				? { tone: 'info', glyph: '▶', label: 'Recorded run' }
				: { tone: 'idle', glyph: '…', label: 'Checking…' }
	);
</script>

<header class="bg-surface border-b border-border">
	<div class="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
		<div class="flex items-center gap-4 min-w-0">
			<a href="{base}/" class="min-h-11 inline-flex items-center text-base font-semibold">TransferPilot</a>
			<nav aria-label="Primary" class="flex items-center gap-4 text-sm">
				<a
					href="{base}/"
					class={['min-h-11 inline-flex items-center', sprintActive && 'border-b-2 border-accent']}
					aria-current={sprintActive ? 'page' : undefined}>Sprint</a
				>
				<a
					href="{base}/evals/"
					class={['min-h-11 inline-flex items-center', evalsActive && 'border-b-2 border-accent']}
					aria-current={evalsActive ? 'page' : undefined}>Evals</a
				>
				<a href={REPO_URL} target="_blank" rel="noopener noreferrer" class="min-h-11 inline-flex items-center"
					>GitHub<span aria-hidden="true">&nbsp;↗</span><span class="sr-only"> (opens in new tab)</span></a
				>
			</nav>
		</div>
		<StatusChip chip={pill} />
	</div>
</header>

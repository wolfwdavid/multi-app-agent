<script lang="ts">
	import { appLabel, rowAnnouncement, type TraceRow } from '$lib/ui/trace-rows';
	import { traceChip } from '$lib/ui/status';
	import { fmtMs } from '$lib/ui/format';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let {
		rows,
		total,
		currentIndex = -1,
		announce = true,
		finalMessage = ''
	}: { rows: TraceRow[]; total: number; currentIndex?: number; announce?: boolean; finalMessage?: string } =
		$props();

	const isTerminal = (r: TraceRow) => r.status !== 'running' && r.status !== 'queued';
	const done = $derived(rows.filter(isTerminal).length);

	let message = $state('');
	let lastDone = 0;

	$effect(() => {
		const n = done;
		if (announce && n > lastDone) {
			let last: TraceRow | undefined;
			for (const r of rows) if (isTerminal(r)) last = r;
			if (last) message = rowAnnouncement(last);
		}
		lastDone = n;
	});

	$effect(() => {
		if (finalMessage) message = finalMessage;
	});

	function chipFor(row: TraceRow) {
		const chip = traceChip(row.status, row.attempt);
		return row.labelOverride ? { ...chip, label: row.labelOverride } : chip;
	}

	function attemptText(row: TraceRow): string {
		if (row.attempt === undefined) return '—';
		return row.maxAttempts !== undefined ? `try ${row.attempt}/${row.maxAttempts}` : `try ${row.attempt}`;
	}

	const latency = (row: TraceRow) => (row.durationMs !== undefined ? fmtMs(row.durationMs) : '—');
</script>

<div class="space-y-2">
	<div class="space-y-1">
		<label for="trace-progress" class="text-sm tabular-nums">{done} of {total} steps</label>
		<progress id="trace-progress" class="w-full h-2 accent-accent" max={Math.max(total, 1)} value={done}></progress>
	</div>

	<div
		class="hidden sm:grid grid-cols-[3rem_8rem_1fr_5rem_5rem_8rem] gap-2 text-sm font-semibold text-fg-muted pl-2"
		aria-hidden="true"
	>
		<span>Step</span><span>App</span><span>Operation</span><span>Attempt</span><span>Latency</span><span>Status</span>
	</div>

	<ol aria-label="Run trace steps" class="divide-y divide-border">
		{#each rows as row, i (row.index)}
			<li
				class={[
					'py-2 pl-2 border-l-2 motion-safe:transition-colors',
					i === currentIndex ? 'border-l-accent bg-surface' : 'border-l-transparent'
				]}
			>
				<div class="hidden sm:grid grid-cols-[3rem_8rem_1fr_5rem_5rem_8rem] items-center gap-2 text-sm">
					<span class="font-mono tabular-nums">#{row.index}</span>
					<span class="truncate">{appLabel(row.app)}</span>
					<span class="min-w-0 truncate" title={row.summary ?? row.tool}
						><span class="font-mono">{row.tool}</span>{#if row.summary}
							<span class="text-fg-muted">{row.summary}</span>{/if}</span
					>
					<span class="tabular-nums">{attemptText(row)}</span>
					<span class="tabular-nums">{latency(row)}</span>
					<span class="min-w-0"><StatusChip chip={chipFor(row)} /></span>
				</div>
				<div class="sm:hidden space-y-1 text-sm">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-mono tabular-nums">#{row.index}</span>
						<span class="min-w-0 flex-1 truncate" title={row.summary ?? row.tool}
							><span class="font-mono">{row.tool}</span>{#if row.summary}
								<span class="text-fg-muted">{row.summary}</span>{/if}</span
						>
						<StatusChip chip={chipFor(row)} />
					</div>
					<p class="text-fg-muted tabular-nums">{appLabel(row.app)} · {attemptText(row)} · {latency(row)}</p>
				</div>
				{#if row.attemptLines.length > 0}
					<ul class="pl-12 text-sm text-fg-muted">
						{#each row.attemptLines as line, j (j)}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ol>

	<p class="sr-only" aria-live="polite" aria-atomic="true">{message}</p>
</div>

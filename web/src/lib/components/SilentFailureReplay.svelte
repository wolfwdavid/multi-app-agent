<script lang="ts">
	import { FAILURE_LABELS, type SilentFailureRun } from '$lib/ui/evals';
	import { oracleStepIndex, toTraceRows } from '$lib/ui/trace-rows';
	import { TONE_CLASSES } from '$lib/ui/status';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import ReplayControls from '$lib/components/ReplayControls.svelte';
	import TraceTimeline from '$lib/components/TraceTimeline.svelte';

	let { run }: { run: SilentFailureRun } = $props();

	const FALLBACK =
		'In this scenario the Calendar app is set to report success without saving anything (a lying API). Step through the run to watch read-back catch it.';

	const rows = $derived(toTraceRows(run.events));
	const stepIdx = $derived(oracleStepIndex(rows, run.oracle.stepSpanId));
	let i = $state(0);
	let playing = $state(false);

	$effect(() => {
		if (!playing) return;
		const id = setInterval(() => {
			i = Math.min(i + 1, rows.length);
			if (i >= rows.length) playing = false;
		}, 400);
		return () => clearInterval(id);
	});

	function next() {
		if (i < rows.length) i += 1;
	}
	function prev() {
		if (i > 0) i -= 1;
	}
	function play() {
		if (i >= rows.length) i = 0;
		playing = true;
	}
	function restart() {
		i = 0;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			next();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prev();
		}
	}

	const mismatches = $derived(run.report.artifacts.filter((a) => a.status === 'mismatch').length);

	const failureLabel = $derived(
		run.oracle.failureClass ? FAILURE_LABELS[run.oracle.failureClass].label : 'unclassified'
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<section
	role="group"
	aria-label="Silent failure replay"
	tabindex="0"
	class="rounded-lg border border-border p-4 sm:p-6 space-y-4"
	onkeydown={onKeydown}
>
	<div class="space-y-1">
		<h2 class="text-xl font-semibold">Caught silent failure</h2>
		<p class="text-base text-fg-muted">{run.description || FALLBACK}</p>
		<p class="text-sm text-fg-muted">Step with the buttons, or with the Left and Right arrow keys while this panel has focus.</p>
		<p class="text-sm text-fg-muted">
			This is an eval run: step times come from the harness's simulated clock (sim.), not measured latency.
		</p>
	</div>

	<ReplayControls
		{playing}
		index={i}
		total={rows.length}
		onPrev={prev}
		onStep={next}
		onPlay={play}
		onPause={() => (playing = false)}
		onRestart={restart}
	/>

	{#if i >= stepIdx && i > 0}
		<div class="grid sm:grid-cols-2 gap-4">
			<div class="rounded-md border border-border p-4 space-y-2">
				<p class="text-sm font-semibold">What the tool returned</p>
				<StatusChip chip={{ tone: 'ok', glyph: '✓', label: 'OK' }} />
				<p class="text-sm break-words">{run.oracle.expected}</p>
			</div>
			<div class="rounded-md border border-border p-4 space-y-2">
				<p class="text-sm font-semibold">What read-back found</p>
				<StatusChip chip={{ tone: 'fail', glyph: '≠', label: 'Not found' }} />
				<p class="text-sm break-words">{run.oracle.found}</p>
			</div>
			{#if mismatches > 1}
				<p class="sm:col-span-2 text-sm text-fg-muted">
					Showing the first of {mismatches} artifacts that failed read-back. The others are marked Not found in the trace.
				</p>
			{/if}
		</div>
	{/if}

	{#if rows.length > 0 && i === rows.length}
		{#if run.oracle.caught}
			<p role="status" class="rounded-md border p-2 text-base {TONE_CLASSES.ok}">
				Caught. The artifact was marked mismatch and the run reported {run.report.status}, not ok.
			</p>
		{:else}
			<p role="status" class="rounded-md border p-2 text-base {TONE_CLASSES.fail}">
				Missed. Classified as {failureLabel}.
			</p>
		{/if}
	{/if}

	<TraceTimeline rows={rows.slice(0, i)} total={rows.length} currentIndex={i - 1} announce={false} simulatedClock />
</section>

<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { base } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Plan, Profile, RunReport, TraceEvent } from '$lib/core/schemas';
	import { analyzeGaps } from '$lib/core/gap';
	import { DATASET, DEMO_PROFILES } from '$lib/ui/dataset';
	import { fmtDate, localToday } from '$lib/ui/format';
	import { appState } from '$lib/ui/mode.svelte';
	import { createPacer, ReplayCancelled } from '$lib/ui/pacer';
	import { createReplaySource, playEvents, type SprintSource } from '$lib/ui/sprint-source';
	import { countRowSpans, runAnnouncement, toTraceRows } from '$lib/ui/trace-rows';
	import { TONE_CLASSES } from '$lib/ui/status';
	import ProfilePanel from '$lib/components/ProfilePanel.svelte';
	import GapReportCard from '$lib/components/GapReportCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PlanApproval from '$lib/components/PlanApproval.svelte';
	import ReplayControls from '$lib/components/ReplayControls.svelte';
	import TraceTimeline from '$lib/components/TraceTimeline.svelte';
	import ArtifactsPanel from '$lib/components/ArtifactsPanel.svelte';

	// Start from the demo profile so the prerendered HTML already contains its gap report;
	// hydration recomputes it with the visitor's local date.
	let profile = $state<Profile | null>(DEMO_PROFILES[0].profile);
	let valid = $state(true);
	let pristine = $state(true);
	let targetsEmpty = $state(false);

	const today = localToday();
	const reports = $derived(profile ? analyzeGaps(profile, DATASET, { today }) : []);
	const asOf = $derived(reports[0]?.asOf ?? today);

	// Steps 3-5: plan, paced replay, verified results.
	let plan = $state.raw<Plan | null>(null);
	let preflight = $state.raw<Record<string, 'new' | 'exists'> | undefined>();
	const approved = new SvelteSet<string>();
	let events = $state.raw<TraceEvent[]>([]);
	const rows = $derived(plan ? toTraceRows(events, plan) : []);
	let report = $state.raw<RunReport | null>(null);
	let running = $state(false);
	let rerunning = $state(false);
	let building = $state(false);
	let total = $state(0);
	let finalMessage = $state('');
	let runError = $state('');
	let lastKind: 'run' | 'rerun' = 'run';

	const pacer = createPacer();
	let playing = $state(pacer.playing);
	let speedMs = $state(pacer.intervalMs);
	const offPacer = pacer.onChange((p) => (playing = p));

	const source: SprintSource | null = $derived(
		appState.hero?.state === 'ok' ? createReplaySource(appState.hero.data, { pace: pacer.pace }) : null
	);
	const heroError = $derived(appState.hero?.state === 'error' ? appState.hero : null);

	const buildBlocked = $derived(
		appState.mode === 'detecting'
			? 'Checking how this site is running…'
			: !valid
				? 'Fix the profile errors to build a plan.'
				: !source
					? 'Loading the recorded run…'
					: ''
	);

	let controller: AbortController | null = null;
	let runToken = 0;

	function startRun(kind: 'run' | 'rerun'): { token: number; signal: AbortSignal } {
		const token = ++runToken;
		controller?.abort();
		pacer.cancel();
		controller = new AbortController();
		pacer.reset();
		lastKind = kind;
		running = true;
		rerunning = kind === 'rerun';
		events = [];
		report = null;
		finalMessage = '';
		runError = '';
		return { token, signal: controller.signal };
	}

	function push(token: number) {
		return (e: TraceEvent) => {
			if (token === runToken) events = [...events, e];
		};
	}

	function fail(token: number, err: unknown) {
		if (err instanceof ReplayCancelled || token !== runToken) return;
		const n = rows.length;
		const msg = err instanceof Error ? err.message : String(err);
		runError = `The run stopped at step ${n}: ${msg}. Completed steps are shown below; nothing past step ${n} was written.`;
	}

	function finish(token: number) {
		if (token !== runToken) return;
		running = false;
		rerunning = false;
	}

	async function focusHeading(id: string) {
		await tick();
		document.getElementById(id)?.focus();
	}

	async function buildPlan() {
		if (!source || buildBlocked) return;
		building = true;
		try {
			const r = await source.buildPlan(profile ?? undefined);
			runToken++;
			controller?.abort();
			pacer.cancel();
			running = false;
			rerunning = false;
			events = [];
			report = null;
			finalMessage = '';
			runError = '';
			plan = r.plan;
			preflight = r.preflight;
			approved.clear();
			for (const a of r.plan.actions) if (a.effect === 'write') approved.add(a.id);
			await focusHeading('plan-heading');
		} finally {
			building = false;
		}
	}

	async function run() {
		if (!source || !plan) return;
		const ids = [...approved];
		const { token, signal } = startRun('run');
		total = source.estimateSteps?.(ids) ?? 0;
		await focusHeading('trace-heading');
		try {
			const r = await source.execute(plan, ids, push(token), signal);
			if (token !== runToken) return;
			report = r;
			finalMessage = runAnnouncement(r);
		} catch (err) {
			fail(token, err);
		} finally {
			finish(token);
		}
	}

	async function runAgain() {
		if (!source?.rerun || !plan) return;
		const ids = [...approved];
		const { token, signal } = startRun('rerun');
		try {
			const r = await source.rerun(ids);
			if (token !== runToken) return;
			total = countRowSpans(r.events);
			await focusHeading('trace-heading');
			await playEvents(r.events, push(token), pacer.pace, signal);
			if (token !== runToken) return;
			report = r.report;
			finalMessage = runAnnouncement(r.report);
		} catch (err) {
			fail(token, err);
		} finally {
			finish(token);
		}
	}

	function restart() {
		if (lastKind === 'rerun') void runAgain();
		else void run();
	}

	onDestroy(() => {
		controller?.abort();
		pacer.cancel();
		offPacer();
	});

	const steps = $derived([
		{ href: '#profile', label: '1 Profile', done: valid },
		{ href: '#gaps', label: '2 Gaps', done: reports.length > 0 },
		{ href: '#plan', label: '3 Plan', done: plan !== null },
		{ href: '#trace', label: '4 Run', done: rows.length > 0 },
		{ href: '#results', label: '5 Verified', done: report !== null }
	]);

	function keepProfileOpenOnDesktop(e: Event) {
		const d = e.currentTarget as HTMLDetailsElement;
		if (!d.open && window.matchMedia('(min-width: 1024px)').matches) d.open = true;
	}

	const SECONDARY =
		'bg-bg border border-border text-fg hover:bg-surface rounded-md px-4 min-h-11 disabled:cursor-not-allowed disabled:opacity-50';
</script>

<svelte:head><title>Sprint · TransferPilot</title></svelte:head>

<div class="pt-8 space-y-2">
	<h1 class="text-2xl font-semibold">Application sprint</h1>
	<p class="text-base text-fg-muted">
		Plans a college transfer application: finds requirement gaps and critiques the essay, then writes to your apps
		only after you approve.
	</p>
	<ul aria-label="Apps it writes to" class="flex flex-wrap gap-2 text-sm">
		{#each ['Google Docs', 'Notion', 'Google Calendar', 'Gmail'] as app (app)}
			<li class="rounded-full border border-border bg-surface px-2 py-0.5">{app}</li>
		{/each}
	</ul>
	<nav aria-label="Sprint steps" class="text-sm">
		<ol class="flex flex-wrap items-center gap-2">
			{#each steps as step, i (step.href)}
				<li class="flex items-center gap-2">
					{#if i > 0}<span aria-hidden="true" class="text-fg-muted">·</span>{/if}
					<a href={step.href} class="min-h-11 inline-flex items-center gap-1 underline underline-offset-2">
						{#if step.done}<span aria-hidden="true">✓</span>{/if}{step.label}
					</a>
				</li>
			{/each}
		</ol>
	</nav>
	<!-- First-screen CTA: jumps straight to step 3 without scrolling past the profile and gap cards. -->
	<div class="flex flex-wrap items-center gap-2 pt-2">
		{#if plan}
			<a href="#plan" class="{SECONDARY} inline-flex items-center">Jump to 3. Plan &amp; approve</a>
		{:else}
			<button
				type="button"
				class="bg-accent text-accent-fg hover:bg-accent-hover rounded-md px-4 min-h-11 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				disabled={!!buildBlocked || building}
				aria-describedby={buildBlocked ? 'hero-help' : 'hero-note'}
				onclick={buildPlan}>{appState.mode === 'live' ? 'Build a plan for this profile' : 'Replay the recorded sprint'}</button
			>
		{/if}
		<a href="{base}/evals/" class="{SECONDARY} inline-flex items-center">See eval results</a>
	</div>
	{#if !plan}
		{#if buildBlocked}
			<p id="hero-help" class="text-sm text-fg-muted">{buildBlocked}</p>
		{:else}
			<p id="hero-note" class="text-sm text-fg-muted">
				Builds the plan for the demo profile and jumps to step 3. Nothing runs until you approve it.
			</p>
		{/if}
	{/if}
</div>

<div class="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
	<aside class="lg:col-span-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
		<section id="profile">
			<!-- Collapsible below lg only; at lg the aside is a fixed panel (07-UI-SPEC layout grid). -->
			<details open class="rounded-lg border border-border bg-surface p-4 sm:p-6" ontoggle={keepProfileOpenOnDesktop}>
				<summary
					class="min-h-11 cursor-pointer lg:cursor-default lg:list-none lg:pointer-events-none lg:[&::-webkit-details-marker]:hidden"
					><h2 class="inline text-xl font-semibold">1. Profile</h2></summary
				>
				<ProfilePanel bind:profile bind:valid bind:pristine bind:targetsEmpty />
			</details>
		</section>
	</aside>

	<div class="lg:col-span-8 space-y-12">
		<section id="gaps" class="space-y-4">
			<div class="space-y-1">
				<h2 class="text-xl font-semibold">2. Gap report</h2>
				<p class="text-sm text-fg-muted">
					As of {fmtDate(asOf)} · Dataset {DATASET.dataset_version} · Deterministic: no AI involved in these findings.
				</p>
				<p class="text-sm text-fg-muted">{DATASET.disclaimer}</p>
			</div>
			{#if targetsEmpty}
				<EmptyState
					heading="No target programs"
					body="Select at least one target program in the profile to see a gap report."
				/>
			{:else}
				{#if !valid}
					<p class="text-sm text-fg-muted">Showing results for the last valid profile.</p>
				{/if}
				<div class="space-y-4">
					{#each reports as report (report.programId)}
						<GapReportCard {report} />
					{/each}
				</div>
			{/if}
		</section>

		<section id="plan" class="space-y-4">
			<div class="space-y-1">
				<h2 id="plan-heading" tabindex="-1" class="text-xl font-semibold">3. Plan &amp; approve</h2>
				<p class="text-base text-fg-muted">
					Every write the agent will make, before it happens. Gmail actions create drafts only. Nothing is ever sent.
				</p>
			</div>
			{#if heroError}
				<EmptyState
					tone="fail"
					heading="Recorded run not available"
					body={`data/hero-run.json could not be loaded (${heroError.status ?? heroError.reason}). The gap report still works; the plan and trace need a recording. Run npm run record and rebuild.`}
				/>
			{:else if plan}
				<PlanApproval {plan} {preflight} {approved} {running} mode={appState.mode} {pristine} onRun={run} />
			{:else}
				<EmptyState
					heading="No plan yet"
					body="Review the gap report, then build a plan to see every write before it happens."
				>
					<div class="flex flex-col items-center gap-1">
						<button
							type="button"
							class={SECONDARY}
							disabled={!!buildBlocked || building}
							aria-describedby={buildBlocked ? 'build-help' : undefined}
							onclick={buildPlan}>Build plan</button
						>
						{#if buildBlocked}<p id="build-help" class="text-sm text-fg-muted">{buildBlocked}</p>{/if}
					</div>
				</EmptyState>
			{/if}
		</section>

		<section id="trace" class="space-y-4">
			<h2 id="trace-heading" tabindex="-1" class="text-xl font-semibold">4. Run trace</h2>
			{#if runError}
				<p role="status" class="rounded-md border p-2 text-sm {TONE_CLASSES.fail}">{runError}</p>
			{/if}
			{#if rows.length > 0 || running}
				{#if appState.mode === 'replay'}
					<ReplayControls
						{playing}
						index={rows.length}
						{total}
						onPlay={() => pacer.play()}
						onPause={() => pacer.pause()}
						onStep={() => pacer.step()}
						onRestart={restart}
						{speedMs}
						onSpeed={(ms) => {
							speedMs = ms;
							pacer.setIntervalMs(ms);
						}}
					/>
				{/if}
				<TraceTimeline {rows} {total} currentIndex={running ? rows.length - 1 : -1} {finalMessage} />
			{:else}
				<EmptyState
					heading="Nothing has run yet"
					body="Approve actions above and select Run approved actions. Each step appears here as it happens."
				/>
			{/if}
		</section>

		<section id="results" class="space-y-4">
			<div class="space-y-1">
				<h2 class="text-xl font-semibold">5. Verified results</h2>
				<p class="text-base text-fg-muted">
					Verified means the item was read back from the app after the run, not taken from the agent's own report.
				</p>
			</div>
			{#if report && plan}
				<ArtifactsPanel {report} {plan} onRerun={source?.rerun ? runAgain : undefined} {rerunning} />
			{:else}
				<EmptyState
					heading="No artifacts yet"
					body="After the run, each artifact is read back from its app and marked verified or failed."
				/>
			{/if}
		</section>
	</div>
</div>

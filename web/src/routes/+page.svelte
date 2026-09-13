<script lang="ts">
	import type { Profile } from '$lib/core/schemas';
	import { analyzeGaps } from '$lib/core/gap';
	import { DATASET, DEMO_PROFILES } from '$lib/ui/dataset';
	import { fmtDate, localToday } from '$lib/ui/format';
	import ProfilePanel from '$lib/components/ProfilePanel.svelte';
	import GapReportCard from '$lib/components/GapReportCard.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	// Start from the demo profile so the prerendered HTML already contains its gap report;
	// hydration recomputes it with the visitor's local date.
	let profile = $state<Profile | null>(DEMO_PROFILES[0].profile);
	let valid = $state(true);
	let pristine = $state(true);
	let targetsEmpty = $state(false);

	const today = localToday();
	const reports = $derived(profile ? analyzeGaps(profile, DATASET, { today }) : []);
	const asOf = $derived(reports[0]?.asOf ?? today);

	const steps = $derived([
		{ href: '#profile', label: '1 Profile', done: valid },
		{ href: '#gaps', label: '2 Gaps', done: reports.length > 0 },
		{ href: '#plan', label: '3 Plan', done: false },
		{ href: '#trace', label: '4 Run', done: false },
		{ href: '#results', label: '5 Verified', done: false }
	]);
</script>

<svelte:head><title>Sprint · TransferPilot</title></svelte:head>

<div class="pt-8 space-y-2">
	<h1 class="text-2xl font-semibold">Application sprint</h1>
	<p class="text-base text-fg-muted">
		Profile → gap report → plan → approve → run → verify. Nothing is written to any app until you approve it.
	</p>
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
</div>

<div class="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-6">
	<aside class="lg:col-span-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
		<section id="profile">
			<details open class="rounded-lg border border-border bg-surface p-4 sm:p-6">
				<summary class="min-h-11 cursor-pointer"><h2 class="inline text-xl font-semibold">1. Profile</h2></summary>
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
				<h2 class="text-xl font-semibold">3. Plan &amp; approve</h2>
				<p class="text-base text-fg-muted">
					Every write the agent will make, before it happens. Gmail actions create drafts only. Nothing is ever sent.
				</p>
			</div>
			<EmptyState
				heading="No plan yet"
				body="Review the gap report, then build a plan to see every write before it happens."
			/>
		</section>

		<section id="trace" class="space-y-4">
			<h2 class="text-xl font-semibold">4. Run trace</h2>
			<EmptyState
				heading="Nothing has run yet"
				body="Approve actions above and select Run approved actions. Each step appears here as it happens."
			/>
		</section>

		<section id="results" class="space-y-4">
			<div class="space-y-1">
				<h2 class="text-xl font-semibold">5. Verified results</h2>
				<p class="text-base text-fg-muted">
					Verified means the item was read back from the app after the run, not taken from the agent's own report.
				</p>
			</div>
			<EmptyState
				heading="No artifacts yet"
				body="After the run, each artifact is read back from its app and marked verified or failed."
			/>
		</section>
	</div>
</div>

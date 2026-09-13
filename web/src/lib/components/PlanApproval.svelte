<script lang="ts">
	import type { SvelteSet } from 'svelte/reactivity';
	import type { Action, AppName, ContentFlag, Plan } from '$lib/core/schemas';
	import { APP_LABELS, PLAN_APP_ORDER } from '$lib/ui/config';
	import type { AppMode } from '$lib/ui/mode';
	import { TONE_CLASSES } from '$lib/ui/status';
	import { truncate } from '$lib/ui/format';
	import ActionCard from '$lib/components/ActionCard.svelte';

	let {
		plan,
		preflight,
		approved,
		running,
		mode,
		pristine,
		onRun
	}: {
		plan: Plan;
		preflight?: Record<string, 'new' | 'exists'>;
		approved: SvelteSet<string>;
		running: boolean;
		mode: AppMode;
		pristine: boolean;
		onRun: () => void;
	} = $props();

	const writes = $derived(plan.actions.filter((a) => a.effect === 'write'));
	const readTools = $derived([...new Set(plan.actions.filter((a) => a.effect === 'read').map((a) => a.tool))]);

	const groups = $derived.by(() => {
		const order: AppName[] = [...PLAN_APP_ORDER];
		for (const a of writes) if (!order.includes(a.app)) order.push(a.app);
		return order
			.map((app) => {
				const actions = writes.filter((a) => a.app === app);
				return { app, actions, selected: actions.filter((a) => approved.has(a.id)).length };
			})
			.filter((g) => g.actions.length > 0);
	});

	const total = $derived(writes.length);
	const selected = $derived(writes.filter((a) => approved.has(a.id)).length);

	function setMany(actions: Action[], on: boolean) {
		for (const a of actions) {
			if (on) approved.add(a.id);
			else approved.delete(a.id);
		}
	}

	function toggle(id: string, on: boolean) {
		if (on) approved.add(id);
		else approved.delete(id);
	}

	const FLAG_LABELS: Record<ContentFlag['kind'], string> = {
		prompt_injection: 'Prompt injection',
		conflicting_deadline: 'Conflicting deadline',
		unsupported_claim: 'Unsupported claim',
		other: 'Flagged content'
	};

	function flagTitle(f: ContentFlag): string {
		return f.kind === 'prompt_injection' ? `Ignored instruction found in ${f.source}` : FLAG_LABELS[f.kind];
	}

	const cardId = (a: Action) => `action-meta-${a.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
</script>

<div class="space-y-4">
	{#if mode === 'replay' && !pristine}
		<p class="rounded-md border p-2 text-sm {TONE_CLASSES.info}">
			The recorded plan was built for the demo profile. Your edits change the gap report above, not this plan.
		</p>
	{/if}

	{#if plan.blockers.length > 0}
		<ul class="space-y-2">
			{#each plan.blockers as b (b.code + (b.programId ?? '') + b.message)}
				<li class="rounded-md border p-2 space-y-1 {TONE_CLASSES.fail}">
					<p class="text-base">{b.message}</p>
					<p class="font-mono text-sm">{b.code}</p>
				</li>
			{/each}
		</ul>
	{/if}

	{#if plan.flags.length > 0}
		<ul class="space-y-2">
			{#each plan.flags as f, i (i)}
				<li class="rounded-md border p-2 space-y-1 {TONE_CLASSES.block}">
					<p class="text-sm font-semibold">{flagTitle(f)}</p>
					<blockquote class="font-mono text-sm break-words">{truncate(f.excerpt, 160)}</blockquote>
					<p class="text-sm">Treated as data. It cannot add or change actions.</p>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="flex flex-wrap items-center justify-between gap-2">
		<label class="min-h-11 inline-flex items-center gap-2 text-base">
			<input
				type="checkbox"
				class="size-5 rounded text-accent"
				disabled={running || total === 0}
				bind:checked={() => total > 0 && selected === total, (v) => setMany(writes, v)}
				bind:indeterminate={() => selected > 0 && selected < total, () => {}}
			/>
			Approve all ({total})
		</label>
		<button
			type="button"
			class="min-h-11 px-2 text-sm underline underline-offset-2 disabled:text-fg-muted"
			disabled={running || selected === 0}
			onclick={() => approved.clear()}>Clear selection</button
		>
		<span class="text-sm text-fg-muted tabular-nums" aria-live="polite">{selected} of {total} selected</span>
	</div>

	{#each groups as g (g.app)}
		<fieldset class="space-y-2" disabled={running}>
			<legend class="w-full">
				<label class="min-h-11 inline-flex items-center gap-2 text-sm font-semibold">
					<input
						type="checkbox"
						class="size-5 rounded text-accent"
						disabled={running}
						bind:checked={() => g.selected === g.actions.length, (v) => setMany(g.actions, v)}
						bind:indeterminate={() => g.selected > 0 && g.selected < g.actions.length, () => {}}
					/>
					{APP_LABELS[g.app]} ({g.actions.length})
				</label>
			</legend>
			{#each g.actions as a (a.id)}
				<ActionCard
					action={a}
					checked={approved.has(a.id)}
					preflight={preflight?.[a.id]}
					disabled={running}
					ontoggle={toggle}
					describedById={cardId(a)}
				/>
			{/each}
		</fieldset>
	{/each}

	{#if readTools.length > 0}
		<p class="text-sm text-fg-muted">Reads (no approval needed): {readTools.join(', ')}</p>
	{/if}

	<div
		class="sticky bottom-0 z-10 bg-bg border-t border-border px-4 py-4 shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.4)] flex flex-wrap items-center justify-between gap-4"
	>
		<p class="text-sm text-fg-muted">{mode === 'live' ? 'Drafts only · mock apps' : 'Replaying the recorded run'}</p>
		<div class="flex flex-col items-end gap-1">
			<button
				type="button"
				class="bg-accent text-accent-fg hover:bg-accent-hover rounded-md px-4 min-h-11 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
				disabled={selected === 0 || running}
				aria-describedby={selected === 0 ? 'cta-help' : undefined}
				onclick={onRun}>{running ? 'Running…' : `Run ${selected} approved actions`}</button
			>
			{#if selected === 0}
				<p id="cta-help" class="text-sm text-fg-muted">Select at least one action to run.</p>
			{/if}
		</div>
	</div>
</div>

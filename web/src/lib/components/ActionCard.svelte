<script lang="ts">
	import type { Action } from '$lib/core/schemas';
	import { APP_LABELS } from '$lib/ui/config';
	import { DATASET } from '$lib/ui/dataset';
	import { actionTargetLabel, targetOptions } from '$lib/ui/profile-form';
	import StatusChip from '$lib/components/StatusChip.svelte';

	let {
		action,
		checked,
		preflight,
		disabled = false,
		ontoggle,
		describedById
	}: {
		action: Action;
		checked: boolean;
		preflight?: 'new' | 'exists';
		disabled?: boolean;
		ontoggle: (id: string, checked: boolean) => void;
		describedById: string;
	} = $props();

	const TARGETS = targetOptions(DATASET);

	const target = $derived(actionTargetLabel(action, TARGETS));

	const recipients = $derived.by(() => {
		const to = action.payload.to;
		if (Array.isArray(to)) return to.map(String).join(', ');
		return typeof to === 'string' ? to : '';
	});
</script>

<div class="rounded-lg border bg-surface p-4 space-y-2" class:border-accent={checked} class:border-border={!checked}>
	<label class="min-h-11 flex gap-2 items-start">
		<input
			type="checkbox"
			class="size-5 rounded text-accent"
			{checked}
			{disabled}
			aria-describedby={describedById}
			onchange={(e) => ontoggle(action.id, e.currentTarget.checked)}
		/>
		<span class="min-w-0 flex-1 space-y-1">
			<span class="flex flex-wrap items-center gap-2">
				<span class="text-base">{action.summary}</span>
				{#if preflight === 'new'}
					<StatusChip chip={{ tone: 'idle', glyph: '+', label: 'New' }} />
				{:else if preflight === 'exists'}
					<StatusChip chip={{ tone: 'info', glyph: '=', label: 'Exists: will dedupe' }} />
				{/if}
			</span>
			<span id={describedById} class="block text-sm text-fg-muted break-words">
				<!-- Svelte trims leading whitespace inside {#if}, so separators are string expressions. -->
				{APP_LABELS[action.app]} · <span class="font-mono">{action.tool}</span>{#if target}{` · ${target}`}{/if}{' · key '}<span
					class="font-mono">{action.idempotencyKey}</span
				>{#if action.dependsOn.length > 0}{` · after ${action.dependsOn.join(', ')}`}{/if}
			</span>
			{#if action.app === 'gmail'}
				<span class="block text-sm">Draft to {recipients || 'no recipient'} · never sent</span>
			{/if}
		</span>
	</label>
	<details class="pl-8">
		<summary class="min-h-11 inline-flex items-center cursor-pointer text-sm">Preview payload</summary>
		<pre
			class="font-mono text-sm overflow-x-auto overflow-y-auto max-h-64 rounded-md bg-bg border border-border p-2">{JSON.stringify(
				action.payload,
				null,
				2
			)}</pre>
	</details>
</div>

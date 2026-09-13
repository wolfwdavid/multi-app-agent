// Phase 5 planning context: the ONLY untrusted reads in the sprint (essay Doc by profile id, inbox scan,
// portfolio evidence), plus injection flags.
//
// Untrusted reads happen during planning but cannot add or change actions: actions, idempotency keys and
// recipients are fixed by deterministic planner code from the profile and GapReports. Content reaches only
// the critique slot (wrapped with wrapUntrusted) and the flag list.
import type { ContentFlag, Profile } from '../schemas.ts';
import { ConnectorError, type Connectors, type HFItem, type RepoSummary } from '../connectors/types.ts';
import type { Tracer } from '../trace/tracer.ts';
import { recipientAllowlistFromProfile } from '../agent/policy.ts';
import { buildEvidenceCatalog } from '../grounding/evidence.ts';
import { scanUntrusted, type InjectionScan } from '../grounding/injection.ts';
import { countWords } from './analyze.ts';
import { GUARD_TRACE, type EvidenceItem } from './types.ts';

export interface EssayContext {
	docId: string;
	status: 'ok' | 'missing' | 'empty' | 'error';
	text: string | null;
	error?: string;
}

export interface PlanningContext {
	essay: EssayContext;
	catalog: EvidenceItem[];
	allowedEmails: string[];
	flags: ContentFlag[];
	scans: InjectionScan[];
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function gatherPlanningContext(
	connectors: Connectors,
	profile: Profile,
	opts: { tracer?: Tracer; inboxQuery?: string } = {}
): Promise<PlanningContext> {
	const { tracer } = opts;
	const allowedEmails = recipientAllowlistFromProfile(profile);
	const scans: InjectionScan[] = [];

	// 1. Essay (ESSAY-01): the doc id comes only from the profile, never from content or LLM output.
	const docId = profile.essay_doc_id;
	let essay: EssayContext;
	try {
		const r = await connectors.docs.readDoc(docId);
		essay = r.text.trim() === '' ? { docId, status: 'empty', text: null } : { docId, status: 'ok', text: r.text };
	} catch (e) {
		essay =
			e instanceof ConnectorError && e.kind === 'not_found'
				? { docId, status: 'missing', text: null }
				: { docId, status: 'error', text: null, error: errorMessage(e) };
	}
	// The essay text itself never goes into the trace.
	tracer?.event(
		GUARD_TRACE.essayRead,
		{
			tool: 'docs.readDoc',
			effect: 'read',
			docId,
			status: essay.status,
			...(essay.text ? { words: countWords(essay.text) } : {})
		},
		essay.status === 'ok' ? 'ok' : 'error'
	);
	if (essay.text !== null) scans.push(scanUntrusted(`doc:${docId}`, essay.text, { allowedEmails }));

	// 2. Inbox: bodies are scanned for flags only and never passed to any LLM slot or planner input.
	const query = opts.inboxQuery ?? 'transfer';
	let messages: { id: string; subject: string; body: string }[] = [];
	let inboxError: string | undefined;
	try {
		messages = await connectors.gmail.searchInbox(query);
	} catch (e) {
		messages = [];
		inboxError = errorMessage(e);
	}
	const inboxScans = messages.map((m) => scanUntrusted(`gmail:${m.id}`, `${m.subject}\n${m.body}`, { allowedEmails }));
	scans.push(...inboxScans);
	tracer?.event(GUARD_TRACE.inboxScan, {
		tool: 'gmail.searchInbox',
		effect: 'read',
		query,
		messages: messages.length,
		flagged: inboxScans.filter((s) => s.flag !== null).length,
		...(inboxError ? { error: inboxError } : {})
	});

	// 3. Portfolio evidence (read-only; failures degrade to an empty list).
	let repos: RepoSummary[] = [];
	let hfItems: HFItem[] = [];
	const gh = profile.portfolio.github_username;
	if (gh) {
		let error: string | undefined;
		try {
			repos = await connectors.github.listRepos(gh);
		} catch (e) {
			repos = [];
			error = errorMessage(e);
		}
		tracer?.event(GUARD_TRACE.evidenceRead, { tool: 'github.listRepos', effect: 'read', count: repos.length, ...(error ? { error } : {}) });
	}
	const hf = profile.portfolio.hf_username;
	if (hf) {
		let error: string | undefined;
		try {
			hfItems = await connectors.hf.listModelsAndSpaces(hf);
		} catch (e) {
			hfItems = [];
			error = errorMessage(e);
		}
		tracer?.event(GUARD_TRACE.evidenceRead, {
			tool: 'hf.listModelsAndSpaces',
			effect: 'read',
			count: hfItems.length,
			...(error ? { error } : {})
		});
	}
	const catalog = buildEvidenceCatalog(profile, { repos, hfItems });

	// 4. Flags: detection only; it never decides actions.
	const flags: ContentFlag[] = [];
	for (const s of scans) {
		if (!s.flag) continue;
		flags.push(s.flag);
		tracer?.event(
			GUARD_TRACE.injectionFlagged,
			{ source: s.source, signals: s.signals, excerpt: s.flag.excerpt, reason: 'injection' },
			'skipped'
		);
	}

	return { essay, catalog, allowedEmails, flags, scans };
}

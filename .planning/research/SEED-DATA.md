# Seed Data Verification Notes

Retrieved 2026-09-13 for the Fall 2027 transfer cycle. Data file: `seed-schools.json`.
VERIFIED means read directly on an official page this session. UNVERIFIED means null or LOW in the JSON.

## Common App fraud policy: AI wording (VERIFIED, HIGH)

URL: https://www.commonapp.org/fraud-policy (the page renders its text with JavaScript, so the text was read from its data file https://www.commonapp.org/page-data/fraud-policy/page-data.json)

Among the circumstances Common App lists as fraud:

> "Submitting plagiarized essays or other written or oral material, or intentionally misrepresenting as one's own original work: (1) another person's thoughts, language, ideas, expressions, or experiences or (2) the substantive content or output of an artificial intelligence platform, technology, or algorithm;"

No effective date appears in the page data.

## 1. UC Berkeley: Data Science BA

| Field | Status | Notes |
|---|---|---|
| Deadlines | VERIFIED (HIGH) | UC dates page: application opens Aug 1; Fall 2027 filing period Oct 1 - Nov 30, 2026; Transfer Academic Update priority deadline Jan 31; final transcripts Jul 1; TAG Sept 1-30 (Berkeley does not take part in TAG, per earlier research only) |
| Units / min GPA | VERIFIED (HIGH) | Berkeley: 60 semester / 90 quarter units by the end of spring before fall; 3.0 for most majors. UC system minimum: 2.4 residents / 2.8 nonresidents |
| 7-course pattern / IGETC | VERIFIED (HIGH) | UC basic requirements page; IGETC, Cal-GETC, or campus GE may already satisfy it |
| PIQs | VERIFIED (HIGH) | **Correction to the brief:** transfer applicants answer 1 required question plus 3 of 7 optional questions (8 total, 4 answered, 350 words each). It is not "4 of 8" plus a separate required question |
| Major-prep courses | MEDIUM | CDSS pages block automated fetches (403); the course list comes from a search summary of cdss.berkeley.edu. The major is housed in CDSS, not L&S. Confirm on ASSIST.org |
| Recs | MEDIUM | None of the UC pages read mention recommendations; set to 0 |
| AI policy | VERIFIED (HIGH) | UC Statement of Application Integrity (last updated Aug 2023): generative AI may "assist with readability, but content and final written text must be their own." Mapped to `feedback_ok` |

## 2. Cornell: ILR and A&S Economics

| Field | Status | Notes |
|---|---|---|
| Deadlines | VERIFIED (HIGH) | Main transfer page: fall entry only; application Mar 15; other materials Apr 15. The page gives no year, so Fall 2027 is assumed |
| Minimum credits | VERIFIED (HIGH) | At least 12 semester hours of college credit after high school |
| Recommendations | VERIFIED (HIGH) | 1 Academic Evaluation from an instructor; ILR guidelines: "Only one Academic Recommendation from a college professor is required" |
| Transfer statement | VERIFIED (HIGH) | 250-650 words: "How does continuing your education at a new institution help you achieve your future goals?" |
| ILR GPA / courses / supplements | MEDIUM | From the ILR Transfer Guidelines PDF for **Fall 2026** entry (updated 2/10/26). Includes 3.4 typical admitted GPA, sophomore and junior course lists, the Cornell community essay (350 words) and the ILR essay (650 words). The Cornell main page now says college supplements have a "character limit," so limits may change for Fall 2027 |
| A&S GPA | MEDIUM | "Earn a minimum 3.5 GPA each semester, with no grade lower than a B-" is in the A&S **Transfer Option** section. No official minimum for regular external transfers was found (min_gpa is null). The 3.0 figure applies to *internal* transfers only |
| Economics prerequisites | VERIFIED (HIGH) | ECON 1110 and 1120 (B- or better) and MATH 1110 (C or better) before applying to the major |
| A&S college supplement prompt | UNVERIFIED (LOW) | Visible only inside the Common App; prompt is null |
| AI policy | VERIFIED (HIGH), with a conflict | The "Receiving Help" policy allows AI only for college research and list-building. The enrollment FAQ also allows AI for brainstorming topics and checking grammar and spelling. Both prohibit AI outlining, drafting, writing, or translating. Mapped to `grammar_only` as the conservative reading |

## 3. University of Michigan: LSA

| Field | Status | Notes |
|---|---|---|
| Deadlines | VERIFIED (HIGH) | LSA page: Fall 2027 deadline Feb 1, 2027; Winter 2027 deadline Oct 1, 2026 |
| GPA / units | VERIFIED (HIGH) as "none published" | No GPA number or credit minimum. Competitive applicants typically have 2 or more semesters of graded transferable coursework |
| Required courses | VERIFIED (HIGH) as "none" | Guidance only: courses that meet LSA distribution requirements, fit the intended major, and show progression |
| Essays | VERIFIED (HIGH) | Three U-M questions (1,500 / 2,750 / 1,500 **characters**, so `word_limit` is null and the limit is in the prompt text), plus the Common App essay (250-650 words) and optional challenges question (250 words) |
| Recs | VERIFIED (HIGH) | Not required unless the admissions office requests one |
| AI policy | VERIFIED (HIGH) | Essay page, "Representing Your Authentic Voice": brainstorming, outlining, proofreading, and organizing are OK; "Do not copy and paste AI-generated text." Mapped to `brainstorm_ok` |

## 4. University of Virginia: A&S VCCS Guaranteed Admission Agreement

| Field | Status | Notes |
|---|---|---|
| Guarantee terms | VERIFIED (HIGH) | Official page plus the signed agreement PDF: 3.4 VCCS GPA; 45 or more transferable credits (24 at the degree-granting college); AA/AS/AA&S degree; C or better in every course; fall entry only; must transfer within 2 years of the degree; does not guarantee a specific major |
| Deadline | VERIFIED (HIGH) | Fall: March 1 (page gives no year, so Fall 2027 is assumed). Spring (A&S only): Oct 1 |
| Recs | VERIFIED (HIGH) | Letter of recommendation listed as optional |
| Supplement essay prompt | UNVERIFIED (LOW) | The "UVA supplement" is required, but the prompt was not found (instructions page blocked with 403) |
| AI policy | UNVERIFIED (LOW), set to `unknown` | admission.virginia.edu/admission/deadlines-instructions returned 403. A search summary says AI may help brainstorm or check grammar but not produce pasted text, plus an honor statement; not confirmed, so not cited |

## 5. Northfield Institute of Technology (FICTIONAL)

Made up for adversarial tests: `has_transfer_program: false`, no real sources (the `about:fictional` URL marks this). It must never be shown as a real school.

## Caveats for the agent

- Cornell (Mar 15 / Apr 15) and UVA (Mar 1) list dates without a year; Fall 2027 is inferred. Recheck in January 2027.
- Every rendered requirement should show its `sources[].url` and the "verify on official page" banner (FEATURES.md section 7).

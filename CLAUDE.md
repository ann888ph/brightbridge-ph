# BrightBridge PH — Project Reference (CLAUDE.md)

> Paste this whole file into a new chat so Claude has full context on BrightBridge PH without needing to re-explain everything.

## What This Is

An AI-powered worksheet generator for Filipino elementary learners (Grade 1–6), built by Ann Ledesma for her son Mozzy and other families — with special attention to dysgraphia and other learning differences. No build step, deployed as static files + two serverless functions (worksheet generation + admin analytics).

**Live URL:** https://brightbridgeph.netlify.app
**GitHub repo:** `ann888ph/brightbridge-ph` (branch: `main`) — Netlify auto-deploys on every commit
**Netlify team:** "Ann_and_Noah"
**Supabase project:** `brightbridge-ph` (region: Southeast Asia / Singapore)

---

## Tech Stack

- **Frontend:** Split into three files as of the July 2026 refactor — `index.html` (structure only, ~240 lines), `style.css` (all styling), `app.js` (all JS logic). Previously a single 1,700+ line `index.html` with inline `<style>`/`<script>`; split for maintainability once the file got risky to edit (one missing comma or misplaced brace could silently break the whole app). No build step, no framework — the three files just need to sit together in the same folder; `index.html` links them via `<link rel="stylesheet" href="style.css">` and `<script src="app.js"></script>`.
- **AI:** Anthropic API, model `claude-haiku-4-5-20251001` (chosen for speed — Sonnet timed out on Netlify's function limits even on paid plan). `max_tokens: 8000`.
- **Backend:** Two Netlify serverless functions:
  - `netlify/functions/generate.js` — proxies worksheet generation to the Anthropic API. Does **server-side auth + quota enforcement** (see "Usage tracking, Quotas & Provider-Attempt Accounting" below) and **server-authoritative Math validation** (see "Math Generation & Validation Architecture" below) — this replaced an earlier client-side-only quota check that a technically savvy user could bypass via DevTools.
  - `netlify/functions/admin-stats.js` — returns aggregated analytics (see "Admin Analytics Dashboard" below), gated server-side to Ann's email only.
- **Auth + DB:** Supabase (Postgres + Auth + RLS). Email/password auth.
- **Hosting:** Netlify, connected to GitHub for continuous deployment (drag-and-drop deploys were unreliable for detecting the `netlify/functions` folder — GitHub integration is required, not optional).

## File Structure

```
brightbridge-ph/                  (GitHub repo root = Netlify publish root)
├── index.html                    # app structure only (~240 lines, post-refactor)
├── style.css                     # all styling, extracted from index.html
├── app.js                        # all frontend JS logic, extracted from index.html
├── admin.html                    # admin analytics dashboard (Ann-only, email-gated)
├── netlify.toml                  # points Netlify at netlify/functions
├── netlify/functions/generate.js      # server-side Claude API proxy + quota enforcement + Math validation
├── netlify/functions/admin-stats.js   # server-side analytics aggregation, admin-only
├── math-validation.js             # shared Math validation + JSON-repair parser (loaded by both index.html and generate.js)
├── migrations/
│   └── 2026_add_math_validation_reservations.sql   # quota/attempt reservation RPCs (applied to production)
├── login-hero.jpg                # hero photo on the login screen
├── grade1-topics.json            # curriculum data, Grade 1
├── grade2-topics.json            # curriculum data, Grade 2
├── grade3-topics.json            # curriculum data, Grade 3
├── grade4-topics.json            # curriculum data, Grade 4
├── grade5-topics.json            # curriculum data, Grade 5
└── grade6-topics.json            # curriculum data, Grade 6
```

**Editing philosophy:** curriculum content lives in the per-grade JSON files, NOT in the code. Ann edits those directly on GitHub as she researches more DepEd MATATAG curriculum guides. Since the refactor, `index.html` should almost never need touching — HTML structure changes only. Styling changes go in `style.css`. Logic/behavior changes go in `app.js`.

**⚠️ JSON gotcha (already bit us once):** every subject block in a `grade{N}-topics.json` file needs a trailing comma before the next one. Missing a comma after adding a new subject block (e.g. adding MAPEH to Grade 4) silently breaks the ENTIRE file — not just that subject, the whole Subject dropdown stops loading. Always validate with a JSON linter/parser before committing a topics.json edit.

---

## Curriculum Data Model (topics.json files)

Each `grade{N}-topics.json` is structured as:

```json
{
  "SubjectName": {
    "Grade N": {
      "Quarter 1": ["topic", "topic", ...],
      "Quarter 2": [...],
      "Quarter 3": [...],
      "Quarter 4": [...]
    }
  }
}
```

(Some subjects use `"all": [...]` instead of quarters if not yet quarter-differentiated.)

**Subject sets differ by grade band per official MATATAG structure** — this is why the Subject dropdown is dynamically populated from whichever grade file is loaded, NOT a static list:

- **Grade 1–2:** Language, Reading and Literacy, Math, Makabansa, GMRC / Values (5 subjects)
- **Grade 3:** Math, Science, English, Filipino, Makabansa, GMRC / Values (6 subjects)
- **Grade 4:** Math, Science, English, Filipino, Makabansa, EPP, GMRC / Values, MAPEH (8 subjects — Ann added MAPEH after the original CG sourcing; if this diverges from official MATATAG structure for Grade 4 again, treat Ann's latest edit as intentional, not a bug)
- **Grade 5–6:** Math, Science, English, Filipino, Araling Panlipunan, EPP, MAPEH, GMRC / Values (8 subjects — full split)

Naming was normalized during merge: `"GMRC (EsP)"` → `"GMRC / Values"`, `"EPP (TLE)"` → `"EPP"`, so lookups stay consistent across all 6 files.

**How the app loads this data:** `loadGradeTopics(grade)` fetches `/grade{N}-topics.json` lazily (only when that grade is selected) and caches it in `gradeTopicsCache`. `updateSubjects()` populates the Subject dropdown from the loaded file's top-level keys. `updateTopics()` reads `gradeTopicsCache[grade][subject][grade][quarter|all]`.

**Grade+Subject combos with no data yet** show a disabled "No topic list yet" option plus a free-text `#topicCustom` input as fallback — the AI can still generate a worksheet from a typed topic even without a curated list.

**Only Grade 4 (Math, Science, AP/Makabansa) and now Grades 1–6 broadly are sourced from official DepEd MATATAG Curriculum Guides** that Ann pulled from deped.gov.ph — treat this content as authoritative, don't second-guess or "correct" it.

---

## Core Features

### 1. Worksheet Generation — two modes, one toggle
- **Printable mode (non-Math):** Claude returns clean HTML (headers, MC choices, answer key, dysgraphia-friendly checkboxes when requested). Rendered via `innerHTML`, printable via `window.print()`.
- **Interactive mode (all subjects):** Claude returns strict JSON (`{ title, directions, passage?, questions: [...] }`). Rendered as clickable buttons/inputs with instant checking, scoring, confetti at ≥85%. Uses `parseQuizJson()` which has truncation-repair logic (finds last complete `}` and tries to close the JSON structure) since Haiku occasionally cuts off long responses.
- **Math (both modes):** always uses the structured JSON path — there is no "return clean HTML" prompt path for Math at all. See "Math Generation & Validation Architecture" below.
- Both modes are saved to Supabase `worksheets` table as the SAME content shape they were rendered from (for Math printable, the client-built HTML string), so reopening from "My Worksheets" replays identically — zero additional AI tokens.

### 2. Reading Comprehension passages
Interactive-mode JSON schema includes an optional `passage` field. Rendered in a distinct styled box above the questions, with its own Read Aloud button (independent from per-question Read Aloud). Missing passage on a Reading Comprehension activity shows a friendly fallback message instead of a blank gap or crash.

### 3. Read Aloud (browser-native, zero token cost)
Uses `window.speechSynthesis`. Each question AND the full passage have independent speaker buttons that **toggle between speak/stop** (not just always-restart). Auto-selects a Filipino voice (`fil`/`tl` lang code) for Filipino/AP/GMRC/EPP subjects, English voice otherwise. Rate 0.85 for slower processing.

### 4. Dysgraphia-Friendly Mode
Checkbox that instructs Claude to: use checkboxes instead of write-in blanks for MC/True-False, provide word banks for fill-in-blank, larger spacing, minimal handwriting. Philosophy line baked into the prompt: *"The goal is to assess understanding, not handwriting endurance."* Same principle extends to lenient answer-checking (see below).

**Bug fixed (July 2026):** the printable-mode prompt used to hardcode the full "DYSGRAPHIA-FRIENDLY MODE" instruction block as always-present static text, relying on Claude to notice a phrase like "apply when requested." This meant an unchecked box could still bleed dysgraphia formatting into the next generation, since the model was always shown the same detailed instructions regardless of the checkbox state. Fixed by making the block a real JS conditional (`document.getElementById('dysgraphia').checked ? ... : ...`) with an explicit "STANDARD FORMAT MODE" counter-instruction when unchecked, instead of one-sided silence.

### 5. Lenient answer checking (interactive fill-blank)
`normalizeAnswer()` strips punctuation and leading articles (`mga`, `ang`, `si`, `the`, `a`, `an`), does case-insensitive substring matching. Claude is also prompted to supply an `alternates` array of acceptable variant answers (synonyms, symbol forms like `>` for "greater"). This exists because early testing showed a child answering "Isla" being marked wrong for "mga isla" — same understanding, different phrasing, shouldn't be penalized.

### 6. Auth (Supabase)
Split-screen premium login: photo hero (left) + form (right, "Welcome Back"/"Create Your Account" toggle). Password show/hide eye toggle. Working "Forgot password?" flow using `resetPasswordForEmail` with explicit `redirectTo: 'https://brightbridgeph.netlify.app'` (Supabase's default Site URL was localhost, which broke the reset link — **must also be set in Supabase → Authentication → URL Configuration → Site URL / Redirect URLs**, not just in code). `PASSWORD_RECOVERY` auth event triggers a `prompt()` for the new password.

### 7. Session hygiene
`clearSessionState()` runs on logout — clears worksheet output, quiz state, speech synthesis, saved-worksheets list, AND resets every form field including the dynamically-populated subject dropdown back to "Select Grade First". This was a caught bug: without it, the next parent to log in on a shared device briefly saw the previous parent's worksheet content and form selections.

### 8. Saved Worksheets ("My Worksheets")
Supabase `worksheets` table, RLS-scoped per user. Stores `mode` (`printable`/`interactive`) so reopening renders correctly. View = zero tokens (just replays saved content). Delete with confirm.

### 9. Usage tracking, Quotas & Provider-Attempt Accounting (subscription model)
- `usage_logs` table: one row per generation **attempt**, not just successes (see reservation columns below). Core columns: `user_id`, `email`, `subject`, `mode`, `created_at`, plus analytics columns `grade`, `topic`, `difficulty`, `activity_type`, `dysgraphia_support`, `simplified_support`, `attention_support`, `processing_support` (booleans, nullable — pre-expansion rows have `NULL`, expected, no retroactive backfill possible).
- **Reservation columns** (migration `migrations/2026_add_math_validation_reservations.sql`, already applied to production): `provider_call_count`, `input_tokens`, `output_tokens`, `validation_status`, `is_chargeable`, `reservation_expires_at`. See "Database Security" below for the RPCs that manage these atomically.
- `profiles` table: `user_id`, `email`, `plan` (`free`/`parent`/`family_plus`/`teacher`), `cycle_start` (timestamptz). Auto-created via a Postgres trigger (`handle_new_user()`) on every new `auth.users` signup — defaults to `plan='free'`, `cycle_start=now()`.
- **Plan limits** (hardcoded in `PLAN_LIMITS`, mirrored in both `app.js` and `generate.js`): Free=5, Parent=20 (₱149/mo), Family Plus=60 (₱249/mo), Teacher=150 (₱399/mo) generations per cycle.
- **Quota is billing-cycle-based, not calendar-month-based** — usage is counted from each user's own `cycle_start`, not the 1st of the month. This matters because payment can happen any day.
- **Quota enforcement is server-side.** `generate.js` independently re-verifies the user's identity (via their Supabase session token) and re-counts usage against the same `cycle_start` logic **before** calling the Anthropic API. The frontend's `hasQuotaRemaining()` check still runs first for instant UI feedback (disabling the button, showing the quota bar), but it's UX sugar, not the real gate — a 429 response from `generate.js` is the actual enforcement, and `app.js` re-syncs the quota bar from that response.
- **One delivered, user-visible worksheet consumes at most one quota unit — even if Math needed an internal retry.** Quota and provider-attempt spend are tracked separately and never conflated:
  - **Quota** (`is_chargeable = true`) is only ever set by `finalize_validated_generation`, after a worksheet has been validated (or is non-Math) and is about to be delivered. A retry that fails validation, or a request that errors out, never becomes chargeable — internal retries must never double-charge a user.
  - **Provider-attempt accounting** (`provider_call_count`, checked against `MAX_PROVIDER_ATTEMPTS_PER_DAY` in `generate.js`) tracks every real or reserved Anthropic call, independent of whether it ends up chargeable — this bounds worst-case API spend/abuse even when most attempts are free retries.
  - Failed-validation and provider-error rows stay in `usage_logs` for cost monitoring with `is_chargeable = false` — never deleted, never silently dropped.
- **Client quota display must count only `is_chargeable = true` rows** (`app.js`'s `loadPlanAndUsage()` filters on this) — counting every row would over-count a user's usage by their failed/retried attempts.
- Quota bar shows live progress + a "🔄 Renews {date}" label computed as `cycle_start + 1 month`. The quota-exceeded warning message and the "Renews {date}" badge are computed from the same `renewDate` value (see Known Quirks #7 — they must never be independently (re)written strings).
- To reset someone's quota after they pay again mid-cycle: update their `cycle_start` to `now()` in the `profiles` table (Ann has this saved as a query in the Supabase SQL Editor already). Their usage count recalculates from that new date automatically — no need to touch or delete `usage_logs` (history stays intact for Ann's own records).

### 10. Admin Analytics Dashboard (`admin.html` + `admin-stats.js`)
Added July 2026 to answer "which subjects/topics/grades are actually being used" — previously Ann could only see total generation counts, not breakdowns.
- `admin.html` — separate static page (same repo root as `index.html`), own Supabase login screen (reuses the same `signInWithPassword` flow), renders KPI cards + Chart.js bar charts (generations/day last 14 days, top subjects, top grades, learning-support usage, plan distribution) + a top-topics table.
- `netlify/functions/admin-stats.js` — the real gate. Verifies the caller's Supabase session token, then checks `user.email` against a **hardcoded** `ADMIN_EMAIL` constant (`888annph@gmail.com`) before returning any data. This is a server-side check, not a frontend hide — even someone who finds the `/admin.html` URL and knows a valid login gets a 403 with no data unless their email matches exactly. Aggregation is done in-function over raw rows fetched with the service-role key (not a Postgres view/RPC — fine at current data volume, revisit if `usage_logs` grows very large).
- `index.html`/`app.js` and `admin.html`/`admin-stats.js` are otherwise **fully independent** — editing the customer-facing app doesn't require touching the admin dashboard, except when: (a) Supabase keys/URL rotate (hardcoded in both), (b) new `usage_logs` columns are added and should show up in analytics (need to update the aggregation in `admin-stats.js`), or (c) Ann wants matching visual branding (admin.html has its own inline `<style>`, not linked to `style.css`).
- **No payment gateway is integrated yet.** Plan changes and quota resets are manual: Ann updates the `plan` and/or `cycle_start` cell for a user directly in Supabase Table Editor. This is intentionally simple until PayMongo/Xendit (or similar PH-friendly gateway) gets integrated.

---

## Math Generation & Validation Architecture

Math is a special case across the whole stack: every other subject trusts the model's output as-is, but Math is validated server-side before it's ever delivered, in both Printable and Interactive mode.

### Generation architecture
- Math (`subject === "Math"`) always requests the same structured JSON question schema, regardless of `mode` — there is no separate "freehand HTML" prompt path for Math, and no separate model-authored prose answer-key section. Non-Math subjects are unaffected: Printable mode for every other subject still gets the freehand-HTML prompt as usual.
- `netlify/functions/generate.js` is the authoritative validator. It runs `validateMathQuestions()` (from the shared `math-validation.js` module) on every Math response before returning anything to the client — **Math output must pass validation before delivery, in both modes.**
- On validation failure, generate.js allows **at most one internal retry** (a second Anthropic call). If the retry also fails validation, the request fails outright — a partial or invalid Math worksheet is never delivered.
- `math-validation.js` is a UMD module loaded both as `<script src="math-validation.js">` in `index.html` (browser) and via `require()` in `generate.js` (Node) — this keeps the JSON-repair parser (`parseQuizJson`) and the validation rules (`validateMathQuestions`) identical on both sides; there is no separate client-side copy of the validation logic that could drift out of sync.

### Printable Math rendering
- Printable Math HTML is built **programmatically in `app.js`**, by `buildPrintableMathHtml(quiz, opts)`, from the server-validated JSON — the model never generates printable Math HTML directly.
- The learner-facing worksheet keeps its **open-response** look by default: A/B/C/D choices are shown only when the selected activity is **exactly** `"Multiple Choice Quiz"` (exact string match against the `#activity` dropdown value in `index.html` — not a substring/regex test). The underlying JSON is always `multiple_choice`-shaped internally (required for validation), but those choices stay invisible to the learner otherwise, and the worksheet renders a work-space + answer blank instead.
- The printable answer key is built **only** from each question's `final_answer` field — never a separate model-authored answer-key section — and `solution_steps` is never read by the renderer at all, so neither a wrong answer key nor leaked model self-correction narration has any path into the page.
- Dysgraphia-friendly formatting (checkboxes for MC, larger work-space spacing, a boxed "Final Answer" line) is preserved in the Math-specific renderer the same way it's requested for other subjects.
- Saved Printable Math worksheets use the same `worksheets.content` (HTML string) / `mode: 'printable'` storage contract as every other printable subject — reopening from "My Worksheets" needs no special-casing.

### Output safety (HTML escaping)
- Every model-generated field that reaches printable Math HTML — `title`, `directions`, `passage`, each question's `question` text, `choices`, and `final_answer` — is treated as untrusted text and passed through `escapeHtml()` before being inserted into the page.
- Only `buildPrintableMathHtml()` itself constructs HTML markup; model output must never be trusted to create tags, attributes, `<script>` blocks, event handlers (`onerror=`, etc.), or URLs. A malformed or adversarial model response should render as inert visible text, not executable markup.

### Math integrity rules (enforced by `validateMathQuestions()`)
- Every Math question must be `multiple_choice` (V1 restriction — `true_false`/`fill_blank` are rejected outright for Math, not silently skipped).
- The question count must match the requested item count exactly.
- `final_answer`, `choices[answer]`, and the last computed value in `solution_steps` must all agree — compute before generating choices or selecting the answer index, never the reverse.
- The correct answer must appear in `choices` exactly once.
- Currency results must not contain a fraction of a centavo unless the question explicitly asks for rounding — an unstated rounding requirement is a validation failure, not something the model should introduce on its own.
- These rules apply to Math only; non-Math generation (schema, prompts, validation) is completely unaffected.

---

## Supabase Schema (run in SQL Editor)

```sql
-- Worksheets (saved generations)
create table worksheets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  title text not null,
  grade text,
  subject text,
  topic text,
  content text not null,
  mode text default 'printable',
  created_at timestamp with time zone default now()
);
alter table worksheets enable row level security;
create policy "Users can view own worksheets" on worksheets for select using (auth.uid() = user_id);
create policy "Users can insert own worksheets" on worksheets for insert with check (auth.uid() = user_id);
create policy "Users can delete own worksheets" on worksheets for delete using (auth.uid() = user_id);

-- Usage tracking
create table usage_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) not null,
  email text,
  subject text,
  mode text,
  created_at timestamp with time zone default now(),
  -- Added July 2026 for analytics (nullable — old rows have NULL here):
  grade text,
  topic text,
  difficulty text,
  activity_type text,
  dysgraphia_support boolean default false,
  simplified_support boolean default false,
  attention_support boolean default false,
  processing_support boolean default false
);
alter table usage_logs enable row level security;
create policy "Users can insert own logs" on usage_logs for insert with check (auth.uid() = user_id);
create policy "Users can view own logs" on usage_logs for select using (auth.uid() = user_id);
-- Note: generate.js writes here using the SERVICE ROLE key (bypasses RLS) since
-- logging now happens server-side, not client-side. The RLS policies above still
-- matter for any direct client reads (e.g. a user viewing their own usage history).

-- Plans & billing cycles
create table profiles (
  user_id uuid references auth.users(id) primary key,
  email text,
  plan text default 'free' check (plan in ('free', 'parent', 'family_plus', 'teacher')),
  cycle_start timestamptz default now(),
  updated_at timestamp with time zone default now()
);
alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (user_id, email, plan) values (new.id, new.email, 'free');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Auth → URL Configuration:** Site URL must be set to `https://brightbridgeph.netlify.app` (not localhost) for password reset emails to redirect correctly.

---

## Database Security: Math Validation Reservation RPCs

Migration: `migrations/2026_add_math_validation_reservations.sql` — **already applied to the BrightBridge Supabase production database.** Adds the reservation columns listed under "Usage tracking, Quotas & Provider-Attempt Accounting" above, plus three RPCs:

- **`reserve_usage_slot`** — atomically checks the quota limit AND the daily provider-attempt ceiling, then inserts a `'reserved'`, non-chargeable row in one transaction (prevents two concurrent requests from both seeing "quota available" and double-booking the last slot).
- **`reserve_provider_retry`** — allows exactly one `reserved → retrying` transition after a Math validation failure, re-checking both the attempt budget and that the reservation hasn't already expired.
- **`finalize_validated_generation`** — the only path that may ever set `is_chargeable = true`. Re-verifies the reservation hasn't expired before granting; a late success after expiry is recorded (tokens logged) but never charged or delivered.

**Security rules for all three (and for any future RPC of this kind):**
- All three are `SECURITY DEFINER` with `set search_path = ''` and fully schema-qualified references (`public.usage_logs`, `pg_catalog.now()`, etc.) — never rely on the default search path inside a `SECURITY DEFINER` function.
- `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`. `netlify/functions/generate.js` (using the service-role key) is the sole legitimate caller — a client cannot call these directly even with a valid session token.
- Every RPC that takes a `reservation_id` also takes and checks `user_id`, and verifies ownership (`where id = p_reservation_id and user_id = p_user_id`) before doing anything — a reservation ID alone is never sufficient authorization.
- Per-user serialization uses `pg_advisory_xact_lock(hashtext(user_id))`, not a table-wide lock — concurrent requests from *different* users never block each other.

---

## Netlify Functions

### `netlify/functions/generate.js`
- POST-only, expects `{ prompt, subject, mode, grade, topic, difficulty, activity, items, supportFlags }` — `items` (requested question count) is required and validated against a fixed allowlist `[5, 10, 15, 20]` before anything else happens. Returns `{ result: "..." }` or `{ error: "..." }`.
- **Auth required:** expects an `Authorization: Bearer <supabase_access_token>` header. Verifies it against Supabase's `/auth/v1/user` endpoint before doing anything else — no valid session, no generation, 401.
- **Server-side quota + provider-attempt enforcement, via atomic Postgres RPCs** — see "Usage tracking, Quotas & Provider-Attempt Accounting" and "Database Security" above. This happens **before** the Anthropic API is called, so it also protects against wasted API spend. The client-side `hasQuotaRemaining()` check in `app.js` still runs first purely for instant UI feedback; this is the real gate.
- **Math validation is authoritative here, for both Interactive and Printable mode** — see "Math Generation & Validation Architecture" above. Uses the shared `math-validation.js` module (`parseQuizJson`, `validateMathQuestions`).
- Reads `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` from Netlify environment variables — the service-role key must never be referenced from `app.js`/`index.html`, server-side only.
- Logs usage server-side into `usage_logs` after every attempt, chargeable or not (see Quota section) — the client cannot skip or forge this.
- CORS headers included; handles `OPTIONS` preflight.
- `netlify.toml` just needs `[build] functions = "netlify/functions"` — do NOT set `node_bundler = "esbuild"`, it broke an earlier `require("https")` call.
- **⚠️ Watch this one:** uses `fetch()` throughout for both the Supabase REST calls and the Anthropic API call, rather than Node's built-in `https` module (which an earlier version used, over a since-resolved reliability concern). If generations ever start failing with a JSON-parse error like `"Unexpected token '<'"` (a sign Netlify returned an HTML error page instead of JSON), revisit switching the Anthropic call back to `https.request()`.

### `netlify/functions/admin-stats.js`
- GET-only. Same Supabase-token auth pattern as `generate.js`, plus an extra authorization check: `user.email` must exactly match the hardcoded `ADMIN_EMAIL` constant (`888annph@gmail.com`) or it returns 403 with no data.
- Fetches raw `usage_logs` and `profiles` rows with the service-role key, aggregates in-function (top subjects/grades/topics, learning-support usage counts, plan distribution, last-14-days daily counts), returns one JSON payload for `admin.html` to render.

---

## Known Quirks / Hard-Won Lessons (don't re-debug these)

1. **Drag-and-drop / ZIP deploys to Netlify don't reliably pick up the `netlify/functions` folder.** GitHub → Netlify continuous deployment is required for the serverless function to actually work. This cost a lot of back-and-forth early on — don't suggest drag-and-drop for this project again.
2. **Emoji/non-ASCII characters break when the file round-trips through Windows Notepad → GitHub paste** (mojibake, e.g. 🌉 becomes garbage characters). The file is kept **100% ASCII** — all emoji are HTML entities (`&#x1F309;`) outside `<script>` and JS unicode escapes (`\uD83C\uDF09`) inside `<script>`. If you edit `index.html`, preserve this — don't reintroduce raw UTF-8 emoji.
3. **Netlify serverless function timeout on paid plan was NOT actually the bottleneck** for slow generations — it was Claude Sonnet's response time (50+ seconds). Switching to Haiku fixed it. Don't assume timeout tuning is the fix for slow-generate complaints; check the model first.
4. Interactive-mode JSON can get truncated by the model on long (20-item) worksheets — `parseQuizJson()` has repair logic for this, and the prompt explicitly tells Claude to prioritize finishing the Answer Key / valid JSON over finishing every requested item.
5. Math/Science/English prompts must explicitly forbid full-Tagalog output — earlier versions had Math word problems written entirely in Filipino, which parents didn't want. Filipino/Makabansa/GMRC/EPP subjects should be full Tagalog by design (matches how they're taught).
6. **Client-side-only checks are not real security.** The original quota check and the original dysgraphia-mode instruction were both "ask nicely" patterns — trusting the browser to self-report state instead of the server verifying it. Both got fixed in July 2026 (quota → server-side re-count in `generate.js`; dysgraphia → real JS conditional instead of static always-on prompt text). General lesson for future features: if something gates access, cost, or output correctness, the enforcement needs to live server-side (or, in the dysgraphia case, be an explicit conditional Claude can't second-guess), not just in `app.js`.
7. **UI text that's computed in two places will eventually disagree.** The quota-exceeded warning and the "Renews {date}" badge used to be independently written strings — one hardcoded, one dynamic — and drifted apart once real billing cycles came into play. When the same fact (a date, a count, a status) needs to show up in more than one place in the UI, compute it once and reuse it, don't restate it.

---

## Deployment Workflow

Ann uploads changes to GitHub manually through the browser (not `git push`); Netlify auto-deploys on every commit to `main`.

**For a single simple file** (e.g. one `grade{N}-topics.json` edit): the direct-edit path is fine —
1. Go to `github.com/ann888ph/brightbridge-ph`.
2. Open the file → pencil icon (Edit) → Ctrl+A, Delete → paste new content → "Commit changes" directly to `main`.
3. Netlify auto-deploys (~1–2 minutes). No manual Netlify action needed.
4. For brand-new files, use "Add file → Create new file" or "Upload files".

**For anything touching more than one file, or anything nontrivial** (Math generation/validation logic, quota/RPC changes, or any change where `app.js` and `generate.js`/`index.html` must change together): use a feature branch + Pull Request instead of editing `main` file-by-file. This avoids the files ever being at different points mid-edit, and gives a Netlify Deploy Preview to test against before merging (where environment variables permit — the Deploy Preview needs the same Netlify env vars as production).

**Exporting an exact upload-ready ZIP for a set of committed files** (needed because manually uploading Windows working-tree copies has previously produced noisy, corrupted diffs — `core.autocrlf=true` converts line endings on checkout, and a naive re-zip can silently alter content):
1. Export each file directly from the commit object: `git show <commit>:<path>` — never `git archive`, which re-applies checkout-style CRLF conversion and can corrupt a file that's genuinely stored with different line endings than its neighbors (this repo has at least one such case — `netlify/functions/generate.js` is genuinely committed as CRLF while several other files are genuinely LF; this is a real, standing inconsistency, not something to "fix" by normalizing).
2. Verify each exported file against the real commit blob: `git hash-object --no-filters <file>` compared against the blob SHA from `git ls-tree <commit> -- <path>` (or byte-for-byte `cmp` against `git cat-file -p <blob-sha>`). Plain `git hash-object` *without* `--no-filters` applies the same autocrlf conversion and can report a false mismatch — always use `--no-filters` for this check.
3. Zip with a tool that doesn't itself re-encode line endings (PowerShell `Compress-Archive` has worked reliably here).
4. Re-extract the ZIP and re-run the same `hash-object --no-filters` check to confirm the archive round-trip didn't alter anything.

**⚠️ `index.html`, `style.css`, and `app.js` are interdependent** — a change to `app.js` that renamed/added an element ID needs the matching `index.html` update deployed in the same push/PR, or the two will be out of sync live. Same logic applies to `generate.js` and `app.js` for any change to the request/response contract between them (e.g. the auth/quota rewrite, the Math `items` field, the reservation flow) — deploying only one half breaks generation entirely.

Environment variables (`ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are set once in Netlify dashboard, not touched per-deploy. The service-role key supports server-side quota enforcement and admin analytics — it's scoped to Builds/Functions/Runtime, marked as a secret value.

---

## Test Expectations

There is no CI pipeline or test framework — tests are plain Node scripts, run manually, consistent with the rest of the project's no-build-step philosophy. Before changing Math generation, Math validation, or Printable Math rendering, re-run and confirm no regressions in:

- Math validation logic (`validateMathQuestions`, `parseQuizJson`, arithmetic/currency/rounding rules)
- The prompt builder (Math and non-Math prompts, Interactive and Printable)
- `generate.js` control flow (auth, quota/attempt refusals, single-attempt success, retry-then-success, both-attempts-fail, expired-reservation handling, provider errors)
- The `app.js`/`math-validation.js` wiring (no duplicate/drifted copy of the shared validation logic in the client)
- Client quota display (must count only `is_chargeable = true` rows)
- Printable Math rendering: HTML escaping for every model-generated field, `solution_steps` never reaching the output, exact (not substring) `"Multiple Choice Quiz"` activity matching

Also manually verify, since these aren't (yet) covered by an automated check:
- Math Interactive still renders and scores correctly
- Math Printable renders and prints correctly
- Printable non-Math subjects are unaffected (prompts/behavior unchanged)
- Dysgraphia-friendly formatting still applies correctly in both modes
- Saved worksheets (Math and non-Math, both modes) still reopen correctly from "My Worksheets"
- Print/PDF layout is intact (`.worksheet-output` CSS, `@media print` rules)

---

## Product Philosophy (keep this front-of-mind for any new feature)

BrightBridge PH exists because Ann's son Mozzy has learning needs that standard worksheets don't accommodate well. The guiding principle, verbatim from the product itself:

> "The goal is to assess understanding, not handwriting endurance."

This shows up as: dysgraphia-friendly checkbox formats, lenient/generous answer-checking, read-aloud for struggling/slow-processing readers, large touch targets, and a general bias toward reducing friction between "the child knows this" and "the child can prove it." Any new feature should be evaluated against this lens before against pure engineering elegance.

---

## Pending / Not Yet Built

- Real payment gateway integration (PayMongo or Xendit likely, for GCash/card support) — currently plan upgrades are manual via Supabase Table Editor.
- **Output quality control.** Math answer-key correctness is now validated server-side for both Interactive and Printable mode (see "Math Generation & Validation Architecture"). Every other subject (English, Science, Filipino, etc.) still has no validation of correctness or grade-appropriateness — every non-Math generation is trusted as-is. Extending structured validation to other subjects is a candidate for future work, but is not yet designed or built.
- **Abandonment tracking.** Analytics currently only capture successful generations — there's no visibility into users who start filling the form (pick a grade/subject) but never generate. Would need new frontend event logging; not yet built.
- Grade+Subject combos beyond what's in the 6 JSON files may still hit the "type your own topic" fallback if Ann hasn't researched that specific combination yet — this is expected, not a bug.
- Mobile app store distribution (Apple App Store / Google Play) — discussed as a future path via Capacitor (wraps the existing web app into a native shell, reuses all current code) rather than a full native rewrite. Not started. Key consideration if pursued: Apple requires In-App Purchase for digital subscriptions sold inside an iOS app (15–30% cut), so the current direct-payment plan (once a gateway is added) would need to be web-only or restructured for iOS specifically.

---

## Business / Legal

- **HAON Software Development Services** — Ann's registered DTI business name (Caroline Ann Sanchez Junsay), registered July 11, 2026, valid through July 11, 2031, Milagrosa, Calamba, Laguna. "HAON" is intentional — makes legitimate invoicing possible for future school/institutional customers, which will matter if BrightBridge PH moves toward school-level sales (schools typically need an official invoice from a registered business, not an individual).

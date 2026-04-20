# Phase 5.2 — Custom SMTP setup for `fullvision.ca`

**Status:** runbook. Every step below is user-executed — DNS / SMTP provider / Supabase dashboard actions are all outside Claude's authority per the Safety gate.

**Why this matters (DECISIONS.md Q6 = B):** Supabase's built-in email sender is rate-limited (~4 emails/hour on the free tier) and mail comes from `noreply@mail.app.supabase.io`. Teachers signing up at `fullvision.ca` will see that as suspicious and half of it lands in spam. Custom SMTP moves the bottleneck off Supabase's shared pool and puts `noreply@fullvision.ca` in the From header, signed by DKIM the receiving mail server can verify.

---

## Decision 1 — pick an SMTP provider

All three are drop-in compatible with Supabase's SMTP settings page. No preference from the design — pick on price + familiarity.

| Provider | Free tier | Paid first step | Notes |
|---|---|---|---|
| **Resend** (`resend.com`) | 3000/mo, 100/day | $20/mo → 50k/mo | Best DX for custom domains; two TXT records auto-generated. React templates if we ever want them. **Recommended default.** |
| **Postmark** (`postmarkapp.com`) | No free tier (30-day trial) | $15/mo → 10k | Excellent deliverability reputation; a separate stream for transactional vs broadcast. Good if deliverability ever becomes a pain. |
| **AWS SES** (`aws.amazon.com/ses`) | 62 000/mo from EC2, else $0.10/1k | Cheap at scale | Most DIY — you manage DKIM + SPF + DMARC + sandbox-to-production review yourself. Worth it if FullVision grows past 50k monthly sends. |

This runbook assumes **Resend**. The DNS record types are the same for the others; the record *values* come from whichever provider you signed up with.

---

## Step 1 — Provider signup + domain verification

1. Sign up at `resend.com` with the `@fullvision.ca` email you'll use as the From address (or any email — the provider doesn't tie itself to the sending domain).
2. **Domains → Add Domain →** enter `fullvision.ca`. Region: `us-east-1` is fine, latency to Canadian recipients is negligible.
3. Resend shows a set of DNS records to add. There will be three:
   - **MX record** (optional for sending, needed for bounce handling on a subdomain like `send.fullvision.ca`).
   - **TXT record** for SPF (`v=spf1 include:_spf.resend.com ~all` or a merged record if you already have SPF).
   - **TXT record** for DKIM (a long `resend._domainkey` key).

   **Do not add them yet** — see Step 2 for the merged versions.

## Step 2 — DNS records to add

These go wherever `fullvision.ca` is hosted (Namecheap / Cloudflare / Netlify DNS / etc.). Replace the placeholder strings `<value-from-resend>` with whatever the provider's dashboard showed.

| Type | Host / Name | Value | TTL |
|---|---|---|---|
| `TXT` | `@` (apex) | `v=spf1 include:_spf.resend.com ~all` | 3600 |
| `TXT` | `resend._domainkey` | `<long DKIM public key from Resend>` | 3600 |
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@fullvision.ca; adkim=s; aspf=s` | 3600 |
| `MX` | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) — optional | 3600 |

### SPF merge (if `fullvision.ca` already has an SPF record)

SPF only allows **one** TXT record starting with `v=spf1` per host. If you already have one (e.g. from Netlify / Google Workspace), merge the `include:` directive in — don't add a second record.

Before:
```
v=spf1 include:_netlify.com ~all
```

After:
```
v=spf1 include:_netlify.com include:_spf.resend.com ~all
```

### DMARC starter policy

The `_dmarc` value above uses `p=none` which means "monitor only, don't reject." This is the correct first step — it catches misconfiguration in the aggregate reports (sent to `dmarc@fullvision.ca`) without blocking legitimate mail during setup. After ~1 week of clean reports, tighten to `p=quarantine` then later `p=reject`.

You'll need a mailbox at `dmarc@fullvision.ca` to receive the reports (or forward to wherever you read mail). Any reasonable DMARC report visualiser like `dmarcian.com` or `postmark-aggregate-report.com` (free plans exist) parses the XML for you.

### DKIM verification

Resend's dashboard has a **Verify** button next to each record. It polls DNS every 30 seconds. Expect verification within 5 minutes if the TTL is low, up to 48 hours if the DNS provider is slow.

## Step 3 — Supabase SMTP configuration

In the Supabase dashboard for `gradebook-prod`:

1. **Project Settings → Auth → SMTP Settings**.
2. Toggle **Enable custom SMTP** on.
3. Fill in:
   - **Sender email:** `noreply@fullvision.ca`
   - **Sender name:** `FullVision`
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL) or `587` (STARTTLS) — either works; 465 is simpler.
   - **Username:** `resend`
   - **Password:** the API key from Resend (Settings → API Keys → Create API Key; store in a password manager, paste here).
4. Click **Save**.
5. Supabase sends a test email on save. If it fails, check the error message under **Auth Logs**.

## Step 4 — Email templates

Supabase's default templates are fine but the `noreply@fullvision.ca` From and a matching footer make it feel professional.

**Project Settings → Auth → Email Templates** — four templates: **Confirm signup**, **Invite user**, **Magic Link**, **Reset Password**, **Change Email Address**.

Recommended minimal edits (apply to all four):

```html
<h2>{{ .SubjectLine }}</h2>
<p>{{ .ActionText }}</p>
<p><a href="{{ .ConfirmationURL }}">{{ .ButtonText }}</a></p>
<p style="margin-top:24px;color:#666;font-size:13px;">
  FullVision · <a href="https://fullvision.ca">fullvision.ca</a><br/>
  You received this because a sign-in was requested at fullvision.ca.
  If that wasn't you, you can safely ignore this email.
</p>
```

Replace `{{ .SubjectLine }}` / `{{ .ActionText }}` / `{{ .ButtonText }}` with the appropriate per-template copy (Supabase's default templates already have good copy — just wrap them in the footer).

## Step 5 — Verify end-to-end

1. In the signed-out app at `fullvision.ca`, sign up with a fresh throwaway email (Gmail is fine).
2. Confirm the From is `FullVision <noreply@fullvision.ca>`.
3. Click the confirmation link.
4. In the Gmail "show original" view, check:
   - **SPF:** PASS
   - **DKIM:** PASS
   - **DMARC:** PASS
5. Repeat with a Hotmail / Outlook account (their filtering is stricter — if Gmail passes but Outlook lands in junk, you've got an SPF or DKIM typo).

## Step 6 — Post-deploy monitoring

- Check Resend's **Emails** tab for the first week. Bounces > 5% or complaints > 0.1% = investigate.
- Watch DMARC reports. If you see unexpected IPs sending as `fullvision.ca`, that's a spoofing attempt — `p=quarantine` or `p=reject` will block them once you're confident the legitimate flow is clean.

## Rollback

If anything goes sideways during rollout, **uncheck "Enable custom SMTP"** in Supabase. Auth immediately falls back to Supabase's shared sender. No client-side change, no data loss. You can re-enable once the DNS is sorted.

---

## Common gotchas

- **Two SPF records** — the #1 cause of SPF-FAIL. DNS providers sometimes show them as "combined" but that's a display trick; at the protocol level only one `v=spf1` is valid.
- **DKIM key broken across multiple TXT strings** — most DNS panels insert newlines automatically; some (Namecheap) require the key as a single line with quotes. If DKIM verify fails but the record exists, paste the key into `dig TXT resend._domainkey.fullvision.ca +short` output and confirm there are no spurious line breaks.
- **DMARC before DKIM is ready** — DMARC aligns on SPF *or* DKIM. If you set `p=reject` before DKIM is verified, legitimate mail will bounce. Stay on `p=none` until Step 5 passes.
- **Supabase password field does not show a success indicator** — paste the API key, click Save, then send a test email via the Users page. If the test fails the password didn't take.
- **Apex SPF TTL too high** — if you set TTL = 86 400 on the apex TXT during a mistake, you're waiting a day to fix. Keep it at 3600 during setup.

---

## What Claude can't do here

Per the Safety gate, every step above is user-executed. Claude can:

- ✓ Maintain this runbook and respond to questions about the copy.
- ✓ Update `docs/backend-design/auth-lifecycle.md` if the custom SMTP changes the Pass C flow (it shouldn't — the sign-up / reset / magic-link flows are unchanged).
- ✗ Add DNS records, sign up with SMTP providers, paste API keys, click buttons in the Supabase dashboard, or send test mail. These are the "DNS / SMTP / email sends" items in the Safety gate.

When the setup is complete, flip Phase 5.2's checkbox in HANDOFF.md and drop a one-liner in the Activity log noting the provider, the SPF / DKIM / DMARC pass state, and the first-run verification results.

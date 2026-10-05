# Response skeleton

One page. Never more than two. Facts only, in the order an analyst reads them.

## Skeleton

```
MERCHANT      <legal name> · <billing descriptor as it appears on the statement>
ORDER         #<number>   placed <date, time, timezone>
TRANSACTION   <amount> <currency>   ARN <arn>
CARDHOLDER    <name on order>   <email>
DISPUTE       <reason code> — <code's own wording>   filed <date>

SUMMARY
<One or two sentences stating why the claim is wrong. Nothing else.>

THE CLAIM AND THE RECORD
| Cardholder's claim | What the record shows | Exhibit |
|---|---|---|
| ... | ... | 1 |
| ... | ... | 2 |

EXHIBITS
1. <title> — <one line on what it proves>
2. ...
```

Every exhibit numbered, titled and referenced from the table. An exhibit no row points at should be removed; a row with no exhibit is an unsupported assertion and should also be removed.

## Opening lines by claim type

**Not received, with a delivery scan.** State the scan, then the match:

> Carrier <name> recorded delivery on <date> at <time> to <city, postcode>, the address the cardholder entered at checkout. Tracking <number>, Exhibit 1. The dispute was filed <n> days after that delivery scan.

**Not received, filed before the promised window closed:**

> The delivery window shown at checkout was <range>, Exhibit 2. The dispute was filed on <date>, <n> days before that window closed. The parcel was in transit at that time, scanned at <location> on <date>, Exhibit 1.

**Fraud, with CE3.0 or First-Party Trust qualification.** Lead with the structure, not prose:

> This transaction qualifies under Visa Compelling Evidence 3.0. Prior undisputed transactions <id> (<date>, <n> days before the dispute) and <id> (<date>, <n> days) used the same payment credential and match the disputed transaction on purchase IP <ip> and device ID <id>. Both were paid in full with no fraud report.

**Fraud, no qualification:**

> The order was placed from IP <ip>, which resolves to <city, region>, the cardholder's billing city. AVS returned <result> and CVV returned <result>. The confirmation email to <address> was opened on <date>. The parcel was delivered to the billing address on file, Exhibit 1.

**Not as described, sealed goods:**

> The product page as published on <purchase date> described <exact description>, Exhibit 2. The item delivered matches that description. The terms accepted at checkout state <final sale language>, Exhibit 3.

**Credit not processed:**

> A refund of <amount> was processed to the original payment method on <date>, reference <id>, Exhibit 1 — <n> days before this dispute was filed.

## Wording rules

- Dates in full and unambiguous. `2026-10-05`, not `05/10`.
- Timezone named wherever a time matters.
- Name the carrier and quote the tracking number in full.
- Say "the record shows", never "the customer is lying" or "clearly fraudulent".
- No adjectives about the customer. No exclamation marks. No appeals to fairness or to the merchant's hardship.
- Do not explain the business model, the margins, or the impact of losing. None of it is relevant to the claim.
- Quote policy language verbatim and attach the screenshot showing where the customer saw it. A policy nobody was shown is not a defence.

## Before sending, check

- [ ] Amount, date, cardholder name and billing details match the dispute record exactly
- [ ] Every claim in the text has an exhibit behind it
- [ ] The evidence answers *this* reason code, not the order in general
- [ ] For a physical "not received": there is a **delivery** scan, not just a tracking number
- [ ] Liability-shift qualification checked and claimed where it applies
- [ ] Under 2 MB per file and 4 MB total, PDF/A, under 50 pages
- [ ] Legible printed in black and white without zooming
- [ ] No external links
- [ ] Submitted before the internal cutoff, not the real deadline
- [ ] `submitted` read back as `true` after the mutation

---
name: chargeback-representment
description: "Read this before building, reviewing or operating anything that fights a card chargeback — automated dispute responses, evidence packages, representment letters, dispute dashboards, or advice on whether a given dispute is worth contesting. Covers Visa and Mastercard reason codes and what each demands, Visa Compelling Evidence 3.0 and Mastercard First-Party Trust, the evidence that measurably moves win rates, Shopify Payments submission mechanics and hard file limits, deadlines, and the monitoring programmes (VAMP) that make a high dispute rate an existential problem rather than a cost. Not for refunds, returns or ordinary customer service."
---

# Winning chargebacks

A chargeback is not a complaint. It is a claim filed under a specific **reason code**, and that code is a specific accusation. The whole game is answering the accusation that was actually made, with evidence that contradicts it, inside the deadline, in a form a tired analyst can read in under a minute.

Everything else — tone, branding, how unfair it feels — is noise.

## The one rule that decides most cases

**Build toward the accusation, not toward the order.**

A "not received" claim is not answered by an order confirmation, a product photo or a happy-customer email. It is answered by a carrier delivery scan. A "not as described" claim is not answered by a tracking number. A fraud claim is not answered by proof that *someone* received the goods — it is answered by proof that the *cardholder* is the person who bought them.

Merchants who lose usually sent plenty of evidence. It just answered a different question.

## Before anything else: read the code

Never start drafting until the reason code is known. Take it from the dispute record, not from the customer's words — cardholders routinely tell their bank "I did not authorise this" when they mean "it arrived late".

| Network | Family | Typical codes |
|---|---|---|
| Visa | Fraud | 10.1–10.5 (10.4 = card-absent fraud, the common one) |
| Visa | Consumer disputes | 13.1 not received · 13.2 cancelled recurring · 13.3 not as described or defective · 13.6 credit not processed · 13.7 cancelled merchandise |
| Mastercard | Fraud | 4837 no cardholder authorisation · 4863 cardholder does not recognise |
| Mastercard | Consumer disputes | 4853 cardholder dispute (not as described / cancelled) · 4855 goods or services not delivered |

`reference/reason-codes.md` has the per-code evidence matrix. Consult it for every dispute rather than working from memory.

## Check for a liability shift first

Two programmes can win a fraud dispute on structure alone, without arguing the merits. Check both before drafting prose, because when they apply they are worth more than any letter.

**Visa Compelling Evidence 3.0** — reason code 10.4 only. If the same cardholder has **two prior undisputed transactions** with the merchant, each **120–365 days before the dispute date**, and the disputed transaction matches those two on **two of four data elements** (user ID, IP address, shipping address, device ID or fingerprint) with **at least one being IP address or device ID/fingerprint**, liability shifts to the issuer. Visa's acquirer readiness note is blunt about the cost of sloppiness: "You will only be able to attempt submission of these criteria once." Compile it fully before sending.

**Mastercard First-Party Trust** — the analogue for 4837. Unlike CE3.0 it can cover a first-time customer when the required data points are supplied, and it can get the chargeback rejected before it is filed at all.

This is why **capturing IP address and a device fingerprint on every order is the single highest-leverage engineering change** available. Without them the strongest defence in the rulebook is permanently out of reach. See `reference/compelling-evidence.md`.

## What actually moves the numbers

Stripe published findings from roughly one million disputes over sixteen weeks. These are measured lifts in win rate, not opinions:

| Evidence | Lift (percentage points) |
|---|---|
| Delivery confirmation (physical goods) | **+27** |
| …plus a GPS delivery map | +15 more |
| …plus recipient signature | +2 more |
| Evidence submitted while the parcel is still **in transit** | **+2 only** |
| Full refund issued through the processor (digital goods) | +63 |
| Digital activity or usage logs | +10 |

Read the third and fourth rows together. The same delivery confirmation is worth +27 after delivery and +2 before it. **Timing is not a detail; waiting for the delivery scan is often the entire case.** If the deadline allows, wait.

Across the industry, merchants who fight win roughly 20–45% of cases, and a disciplined reason-code-matched process pushes that well up. But cardholders win the large majority of what they file, so the realistic goal is recovering a meaningful slice, not a clean sweep.

## Structure of a response that gets read

An issuer analyst is checking whether the submission **directly contradicts the specific claim**. They are not hunting for reasons to rule for the merchant.

1. **One-page summary first.** Transaction identifiers, the claim, and a one-line statement of why it is wrong.
2. **A three-column table**: the cardholder's claim · the fact that refutes it · the exhibit number proving it.
3. **Three to eight labelled exhibits.** Every one numbered, titled, and explicitly tied to a claim. A short indexed set beats a pile of screenshots.
4. **Facts only.** No emotion, no accusation, no speculation about the customer's motives. Dates, names, tracking numbers, timestamps.
5. **Nothing irrelevant.** Extra documents dilute the ones that matter.

Make the amount, date, customer name and billing details match the dispute record exactly. If those disagree, the analyst stops trusting everything else.

Never send a generic template. Specific dates and tracking numbers are what signal the case was actually investigated.

`reference/response-template.md` has the skeleton and worked wording per claim type.

## Shopify Payments: the mechanics that constrain everything

These limits are hard, and a response that violates them does not land:

- **PDF, JPEG, PNG only.** No audio, no video, no external links — a link is not evidence, nobody clicks it.
- **2 MB per file, 4 MB combined.**
- **PDFs under 50 pages and PDF/A compliant.**
- **Deadline is 7–21 days** from filing, shown per dispute in the store's timezone. Work to an internal cutoff two or three days earlier.
- Shopify **auto-submits on the due date whether or not evidence was added**, so an untouched dispute still burns its one shot.
- **The decision is final.** There is no appeal and no second submission.

Design for black and white. Many issuers still receive evidence by fax, so use high-contrast images that survive printing without zoom or cropping.

Shopify auto-populates order details, addresses, IP, fulfilment and tracking. That baseline is not a case — it is the floor the case is built on.

`reference/shopify-api.md` has the GraphQL fields, scopes and the known `submitEvidence` pitfall.

## House rules for these stores

These override the general guidance above. They come from the owner and are not optional.

**Never submit a `product_not_received` response without proof of delivery.** Fulfilment is from overseas suppliers and Shopify's tracking usually carries no delivery scan, so the proof has to be pulled from the supplier or carrier by hand. The procedure is:

1. Check the Shopify fulfilment first — `shipment_status` of `delivered` means the scan already exists and nothing needs to be requested.
2. Otherwise **ask the owner for the proof of delivery and stop.** Do not draft around the gap, do not submit a response built on a tracking number alone, and do not treat the deadline as a reason to send something weaker. The measured difference is +27 points with a delivery scan against +2 without one; a response sent early without it spends the single submission for almost nothing.
3. Wait for it. The owner supplies it on their own schedule. Keep the deadline visible in the meantime and say how many days are left.
4. A `shipment_status` of `failure`, or a parcel still `in_transit` months after the order, means the goods probably never arrived. Say so and recommend refunding rather than fighting — a loss costs the fee on top of the amount, and the dispute counts against the ratio either way.

**Use the store inbox when it strengthens the case.** Where customer correspondence exists — a delivery question answered, a replacement offered, a customer confirming receipt — capture it and fill the customer-communication evidence. Correspondence is supporting evidence; it never substitutes for the delivery scan on a not-received claim.

## When not to fight

Fighting has a cost, and a loss is not neutral — the dispute still counts against the ratio either way.

Do not fight when there is no delivery scan and none is coming, when the goods genuinely never arrived, when the merchant is at fault, or when the recoverable amount is below the labour it takes. **Refunding before a chargeback is filed is a win**, not a surrender: it costs the sale but avoids the fee, the ratio hit and the staff time.

**Pre-arbitration and arbitration are almost never worth it.** Visa charges the loser around $500 and Mastercard around $400, and merchant win rates at that stage are poor. Reserve it for genuinely high-value disputes. Strong first-round evidence matters far more than a late-stage fight.

## The ratio is the real risk

Winning individual disputes recovers money. The dispute **rate** decides whether the business keeps card processing at all.

Visa's **VAMP** excessive threshold dropped from 2.2% to **1.5%** on 1 April 2026 (US, Canada, EU, APAC, LATAM; CEMEA stays at 2.2%), with **$8 per disputed or fraudulent transaction and no warning tier**. Merchants under 1,500 applicable disputed or fraudulent transactions sit below the monitoring floor.

Two consequences that change how disputes should be handled:

- **A chargeback deflected before it is filed never enters the ratio; one that is won still does.** Prevention beats representment on the metric that matters most. Visa's Rapid Dispute Resolution and Order Insight, and Mastercard's Ethoca Alerts, exist for exactly this.
- A store can sit above the threshold on a small absolute number of disputes simply because it has few orders. Always read the **rate** alongside the count, and check both against the monitoring floor before panicking or relaxing.

## Prevention, ordered by leverage

1. **Capture IP and device fingerprint on every order** — unlocks CE3.0 and First-Party Trust.
2. **A clear billing descriptor.** "Cardholder does not recognise" is often the descriptor's fault, and it is the cheapest fix available.
3. **Honest delivery windows with buffer.** Promising 7–14 days on a 20-day route manufactures "not received" disputes; quoting 15–30 makes the same parcel arrive early. For slow international fulfilment this is the dominant cause.
4. **Tracking that actually scans on delivery.** A tracking number alone is a starting point, not proof. Routes with no delivery scan are structurally unwinnable on 13.1.
5. **Proactive delay notices.** A customer who is told is a customer who waits.
6. **Dispute-prevention alerts** (RDR, Order Insight, Ethoca) to refund early and keep it out of the ratio.
7. **Policies shown at checkout, not buried.** For sealed or mystery-contents goods, explicit "final sale once opened" language on the product page and in the terms is what makes a "not as described" defence stand up.

## Automating this

When building automation, the design follows from the above:

- **Classify by reason code first**, then select the evidence template. One generic template is the most common failure mode of automated dispute systems.
- **Gate on evidence availability.** No delivery scan yet and the deadline allows waiting? Wait. Automation that fires the moment a dispute lands trades the +27 for the +2.
- **Run the CE3.0 and First-Party Trust check first** on every fraud-coded dispute, before any prose is generated. It is a database query — two prior undisputed transactions in the window, matching on IP or device ID — and it beats any letter.
- **Enforce the file limits at build time**, not at submission. 2 MB per file and 4 MB total means generating a compact PDF/A, not attaching raw screenshots.
- **Never auto-submit without a deadline guard.** Shopify submits on the due date regardless; the system's job is to make what goes out better than the default, not to send early.
- **Track outcomes per reason code** so templates can be judged. A template nobody measures is a template nobody can improve.

Write every generated response as facts a human could verify in the order record. If a claim in the letter is not backed by an attached exhibit, remove the claim.

## Sources

Primary: Visa *Compelling Evidence 3.0 Acquirer Readiness* (March 2023), Shopify Help Center chargeback documentation, Shopify GraphQL Admin API reference, Stripe disputes documentation and its one-million-dispute evidence study. Industry: Chargebacks911, Chargeflow, Kount, Justt, Verifi, Merchant Risk Council. Full URLs in `reference/sources.md`.

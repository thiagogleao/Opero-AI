# Visa CE3.0 and Mastercard First-Party Trust

Both shift liability on a fraud dispute by proving a relationship with the cardholder, not by arguing the merits. When one applies it outranks any letter, so check it before drafting anything.

## Visa Compelling Evidence 3.0

Applies to **reason code 10.4 only** (other fraud, card-absent). Not to other fraud codes, not to consumer disputes, not to authorisation or processing errors.

### Qualifying criteria

Two prior transactions with the same payment credential, each of which must be:

- **at least 120 days and no more than 365 days old**, counted from the dispute date
- **paid in full**
- carrying **no active fraud report and no active fraud dispute** (Visa notes fraud reported under codes C and D does not count as a fraud dispute)
- **not a validation charge**
- from the **same merchant** — which makes merchant descriptor consistency part of qualifying, since Visa applies merchant matching logic to find them

### The matching rule

Visa's own wording, from the acquirer readiness note:

> At least two of the core data elements (User ID, IP Address, Shipping Address, Device ID / Fingerprint) match between prior transactions and the disputed transaction, and one of the two must be either the IP address or Device ID / Fingerprint.

Processors restate this as a main/secondary split. Stripe's version:

| Main elements | Secondary elements |
|---|---|
| Customer purchase IP | Shipping address |
| Device fingerprint **or** device ID | Email address |
| | Customer account ID |

Qualify with **two main**, or **one main plus one secondary**. Device fingerprint *and* device ID together is not a valid pair — they count as one element.

### Mechanics

- Pre-dispute route: respond through Verifi Order Insight in real time, before the dispute is created in VROL.
- Post-dispute route: the acquirer submits a VROL pre-arbitration questionnaire with the data elements.
- **One attempt only.** Visa: "You will only be able to attempt submission of these criteria once. Carefully compile your response before submission. If acquirers attempt responses that are incorrect or incomplete, they will be declined."
- VROL validates the elements. Validated, it goes to the issuer; not validated, the remedy is lost for that dispute.
- Issuer response window is 30 days. The issuer may still decline and pursue arbitration with evidence disproving qualification.

### Always file standard evidence too

If the CE3.0 submission is rejected, the dispute falls back to the normal evidence flow. A submission with only the CE3.0 object and no ordinary evidence has nothing to fall back on. Fill both.

## Mastercard First-Party Trust

The analogue for **4837**. Uses historical purchase patterns and key data points to verify legitimacy, requiring two prior undisputed transactions within one year.

The important difference: **it can protect a transaction from a first-time customer** when the required data points are supplied, which CE3.0 cannot. It also operates before the chargeback is filed — a 4837 can be rejected outright when the merchant's data meets the programme's requirements.

Mastercard requires one data element from each of three categories for qualifying transactions. Confirm current specifics against the Mastercard Chargeback Guide, Merchant Edition, since the categories have been revised more than once.

## What this means for engineering

Qualification is a data problem that has to be solved **before** the dispute exists. Nothing can be retrofitted after the fact.

Capture and retain, per order, for at least 400 days:

- **Purchase IP address** — required, and one of the two elements that must be present
- **Device fingerprint or device ID** — the other qualifying element; pick one and store it consistently
- Customer account ID / user ID
- Shipping address, normalised so matching across orders actually succeeds
- Email address
- The transaction's ARN, which must be unique per transaction

Then qualification becomes a query: for this card, find undisputed paid transactions between 120 and 365 days before the dispute date, and check whether two of them match the disputed order on the required elements.

Keep the billing descriptor stable. Visa matches prior transactions to the merchant, and an inconsistent descriptor can hide a merchant's own history from the programme that depends on it.

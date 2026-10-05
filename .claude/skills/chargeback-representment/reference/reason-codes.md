# Reason codes and what each one demands

The code is the accusation. Match the evidence to it or the submission fails regardless of how much was sent.

## Visa

### 10.4 — Other fraud, card-absent environment
The most common fraud code in ecommerce. The claim is that the cardholder did not make the purchase.

**Check Compelling Evidence 3.0 first** (see `compelling-evidence.md`). If it qualifies, that is the case.

Otherwise, prove the cardholder is the buyer:
- IP address captured at checkout, and whether it resolves near the billing address
- Device fingerprint or device ID
- AVS and CVV results
- 3DS authentication data if present (ECI and cryptogram)
- Order confirmation email with open or click timestamps
- Prior purchase history on the same account, card or address
- Delivery to the **billing** address carries more weight than delivery to any address

A delivery scan alone does **not** answer a fraud claim. It proves someone received the parcel, not that the cardholder ordered it.

### 13.1 — Merchandise or services not received
Filed within 120 days of the transaction or of the last date the goods were expected, capped at 540 days from the transaction.

- **Carrier delivery scan with timestamp.** This is the case. Everything else is supporting.
- GPS delivery map where the carrier provides one (+15 points on top of the scan)
- Recipient signature for higher-value parcels
- Shipping address on the label matching the address the customer gave
- The delivery window published at checkout, showing the dispute was filed before the promised date had passed
- Customer communication acknowledging receipt or discussing the delivery

If the parcel is still in transit, submitting now is worth almost nothing (+2 vs +27). Wait for the scan if the deadline permits.

### 13.2 — Cancelled recurring transaction
- Subscription terms as accepted at signup
- Cancellation log showing no cancellation before the disputed renewal
- The renewal notice sent to the customer
- Evidence of usage after the disputed renewal

### 13.3 — Not as described or defective
- The product page and description **as it stood on the purchase date**, not as it stands today
- Itemised invoice detail
- Repair, replacement or return records
- For sealed or mystery-contents goods: the "final sale once opened" terms as displayed on the product page and at checkout, plus the tamper-evident seal language

### 13.6 / 13.7 — Credit not processed / cancelled merchandise
- Refund records with dates and amounts, processed through the original payment method
- The refund and cancellation policy as shown to the customer at checkout
- Correspondence around the cancellation request

A refund issued through the processor is far stronger than store credit.

## Mastercard

| Code | Claim | Core evidence |
|---|---|---|
| 4837 | No cardholder authorisation | Check **First-Party Trust** first. Then 3DS, AVS/CVV, device data, prior purchase history |
| 4863 | Cardholder does not recognise | Sales receipt, signed order form, proof of delivery. Often a billing-descriptor problem rather than a real dispute |
| 4853 | Cardholder dispute — not as described, cancelled, or not received | Varies by sub-claim: delivery proof, cancellation records, or the original listing |
| 4855 | Goods or services not delivered | Delivery confirmation and tracking, same as Visa 13.1 |

Mastercard second presentment deadline is generally **45 calendar days** from the chargeback processing date, though acquirers vary. Confirm against the dispute record.

## Evidence that answers nothing

These get sent constantly and move nothing on their own:

- Order confirmation, against a "not received" claim — it proves a sale, not a delivery
- A tracking number with no delivery scan
- Screenshots of a happy customer, against a fraud claim
- The product photo, against "not as described" — the **listing as of the purchase date** is what matters
- Store credit, where a processor refund was expected
- Any external link; nobody opens it and some systems strip it

# Shopify Payments disputes: API and limits

What a system that submits evidence programmatically has to work within.

## Hard limits

| Constraint | Value |
|---|---|
| Accepted formats | PDF, JPEG, PNG only |
| Per-file size | 2 MB |
| Combined evidence | 4 MB |
| PDF pages | under 50, PDF/A compliant |
| Not accepted | audio, video, external links |
| Response window | 7–21 days from filing, per dispute, in store timezone |
| Issuer review after submission | up to 75 days |
| Appeals | none — the decision is final |

Build the package to print legibly in black and white at 100%. Issuers still receive evidence by fax, so high contrast, no zooming, no cropping required to read it.

## Auto-submission

Shopify sends the response on the due date **whether or not evidence was added**. There is no "skip" state. An untouched dispute spends its single submission on Shopify's default package.

Shopify auto-populates: order and product details, customer name and email, billing and shipping addresses, purchase IP, fulfilment with carrier and tracking, a shipping tracking PDF including carrier delivery photos where available, refund records, customer order history, prior dispute history, and optional AI-generated case summaries (which can be opted out of).

That baseline is the floor, not a case. Automation's job is to beat it before the clock runs out.

## Scopes

- `read_shopify_payments_disputes` — read disputes
- `write_shopify_payments_dispute_evidences` — update and submit evidence
- The staff user also needs `manage_disputes` (or `manage_orders_information`)

Shopify scopes are frozen at token issue. Adding a scope to the app requires reinstalling or reauthorising each store; a published new app version alone does not grant it to stores already installed.

## GraphQL

Query `dispute`, then operate on its `evidence` object.

`ShopifyPaymentsDisputeEvidence` fields:

| Group | Fields |
|---|---|
| Identity | `id`, `dispute` |
| Customer | `customerFirstName`, `customerLastName`, `customerEmailAddress`, `customerPurchaseIp` |
| Addresses | `billingAddress`, `shippingAddress` |
| Policy | `refundPolicyDisclosure`, `refundPolicyFile`, `cancellationPolicyDisclosure`, `cancellationPolicyFile` |
| Argument | `productDescription`, `cancellationRebuttal`, `refundRefusalExplanation`, `accessActivityLog` |
| Fulfilment | `fulfillments`, `shippingDocumentationFile` |
| Communication | `customerCommunicationFile`, `serviceDocumentationFile` |
| Catch-all | `uncategorizedText`, `uncategorizedFile`, `disputeFileUploads` |
| State | `submitted` (Boolean!) |

Mutation `disputeEvidenceUpdate(id: ID!, input: ShopifyPaymentsDisputeEvidenceUpdateInput!)` returns `disputeEvidence` and `userErrors`.

### Pitfalls

- **The `id` is the dispute evidence object's id, not the dispute's.** Passing the dispute id is the most common failure.
- Files attach by `fileId` after a separate upload, and detach with `destroy: true`.
- There is a reported bug where `submitEvidence: true` returns success with no `userErrors` while `disputeEvidence.submitted` stays `false`. **Read `submitted` back after every submission and alert on mismatch** — do not trust the mutation's return alone. Shopify's auto-submit on the due date is the backstop, but it sends the default package, not yours.
- Evidence can only be submitted while the dispute is in a response-accepting state such as `NEEDS_RESPONSE`.

## Fees

The chargeback fee is around $15 USD (€15, £10). It is refunded on a win and kept on a loss. Partial wins are possible.

Inquiries differ from chargebacks: an inquiry takes no funds during investigation and may or may not escalate. A chargeback withdraws funds immediately.

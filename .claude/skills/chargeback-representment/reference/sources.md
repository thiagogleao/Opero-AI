# Sources

Researched October 2026. English-language and primary sources only.

## Primary — card networks

- Visa, *Compelling Evidence 3.0 Acquirer Readiness*, March 2023 — https://usa.visa.com/content/dam/VCOM/regional/na/us/Solutions/pps/compelling-evidence-3-0-acquirer-readiness.pdf
  The qualifying criteria, the 120–365 day window, the four core data elements, the one-attempt rule and the 30-day issuer window are quoted from this document.
- Mastercard, *Chargeback Guide, Merchant Edition* — https://www.mastercard.us/content/dam/public/mastercardcom/na/global-site/documents/chargeback-guide.pdf
  Authoritative for 4837 / 4853 / 4855 / 4863 and second-presentment deadlines. Revised periodically; check the edition date before relying on specifics.
- Verifi (Visa), Rapid Dispute Resolution — https://www.verifi.com/rdr-is-here.html

## Primary — processors

- Shopify Help Center, chargeback process — https://help.shopify.com/en/manual/payments/chargebacks/chargeback-process
- Shopify Help Center, resolving a chargeback — https://help.shopify.com/en/manual/payments/chargebacks/resolve-chargeback
- Shopify Help Center, chargebacks in admin — https://help.shopify.com/en/manual/payments/chargebacks/chargebacks-in-admin
  Source of the file limits: PDF/JPEG/PNG, 2 MB per file, 4 MB combined, PDF/A under 50 pages, no audio/video/links.
- Shopify GraphQL Admin API — https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsDisputeEvidence and https://shopify.dev/docs/api/admin-graphql/latest/mutations/disputeEvidenceUpdate
- Stripe, Visa CE3.0 integration — https://docs.stripe.com/disputes/api/visa-ce3
  Source of the main/secondary element split and the rule that device fingerprint plus device ID is not a valid pair.
- Stripe, dispute prevention — https://docs.stripe.com/disputes/get-started/prevention

## Quantified evidence research

- Stripe, *Analyzing the evidence that helps businesses win "product not received" disputes*, July 2026 — https://stripe.com/blog/analyzing-the-evidence-that-helps-businesses-win-product-not-received-disputes
  One million disputes over sixteen weeks. Source of every percentage-point figure in the skill: delivery confirmation +27, GPS map +15, signature +2, in-transit submission +2 only, processor refund +63 for digital, usage logs +10, store credit +6.

## Monitoring programmes

- Merchant Risk Council on the 2026 VAMP thresholds — https://merchantriskcouncil.org/learning/resource-center/member-news/blog/2026/stricter-vamp-ratio-thresholds-are-now-in-effect-heres-how-to-stay-compliant
- https://cside.com/blog/vamp-2026-merchant-playbook — 1.5% excessive threshold from 1 April 2026, $8 per transaction, no warning tier, 1,500-transaction monitoring floor
- https://www.chargeflow.io/blog/vamp-visa-acquirer-monitoring-program

## Industry guides

- Chargebacks911 — representment, compelling evidence, rebuttal letters, arbitration: https://chargebacks911.com/representment/ · https://chargebacks911.com/compelling-evidence/ · https://chargebacks911.com/chargeback-rebuttal-letter/ · https://chargebacks911.com/arbitration-chargeback/
- Kount, Visa 13.1 — https://kount.com/chargeback-reason-codes/visa/merchandise-services-not-received
- Chargeflow — reason codes, Shopify guide, win-rate benchmarks: https://www.chargeflow.io/chargebacks-101/chargeback-reason-codes · https://www.chargeflow.io/blog/shopify-chargebacks-guide · https://www.chargeflow.io/blog/chargebacks-win-success-rate
- Justt, Mastercard First-Party Trust — https://justt.ai/blog/mastercard-first-party-trust-program/
- Chargeback.io, arbitration and pre-arbitration — https://www.chargeback.io/blog/what-is-a-pre-arbitration-chargeback
- Signifyd, 3DS authentication — https://www.signifyd.com/blog/3d-secure-authentication-the-good-the-bad-and-what-it-means-for-your-fraud-prevention/
- Adyen, 3DS liability shift — https://help.adyen.com/en_US/knowledge/risk/dynamic-3d-secure/what-is-the-3d-secure-liability-shift

## Merchant forums

- Shopify Community, disputes lost despite full evidence — https://community.shopify.com/t/why-are-we-losing-all-chargeback-disputes-even-with-good-customer-service/187858
- Shopify Community, lost with 3DS and signature — https://community.shopify.com/t/lost-chargeback-from-3d-secure-order-with-full-evidence-signed-for-by-customer/9995
- Shopify Community, "not received" filed before delivery was due — https://community.shopify.com/c/payments-shipping-and/chargeback-for-quot-product-not-received-quot-before-i-have-had/m-p/1300251
- Shopify Developer Community, `submitEvidence` returning success without submitting — https://community.shopify.dev/t/issue-with-evidence-submission-via-the-api/36411

Forum threads are anecdote, not rule. They are included because they show the failure modes merchants actually hit — losing with apparently complete evidence, and the API silently not submitting — not as authority on what the rules are.

## Caveats

- Network rules change. CE3.0 dates from April 2023; VAMP thresholds changed April 2026; Mastercard's guide is revised repeatedly. Re-check the primary sources before relying on a specific threshold or deadline.
- Win-rate percentages from vendors who sell dispute services describe their own customers and are not neutral benchmarks. The Stripe study is the most defensible figure set here because it reports measured lifts across a large population rather than a headline win rate.
- Nothing here is legal advice, and the Visa document itself states the Visa Rules govern in any conflict.

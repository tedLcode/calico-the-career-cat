# Manual-check companies

These don't have a public Greenhouse/Lever/Ashby board, so the automated pipeline can't reach them. Check these by hand — weekly is enough, per the spec's Phase 9 playbook. Portal noted where known, so you're not hunting for it each time.

| Company | Portal |
|---|---|
| Zoho | Zoho's own Zoho Recruit product |
| Freshworks | SmartRecruiters |
| Chargebee | own portal |
| Sprinklr | Workday — sprinklr.wd1.myworkdayjobs.com |
| PayPal | own portal (Workday-based) |
| Comcast | Workday — comcast.wd5.myworkdayjobs.com |
| Standard Chartered | own portal — jobs.standardchartered.com |
| Hexagon | own portal — careers.hexagon.com |
| Ford | own portal — careers.ford.com |
| Hasura | rebranded to PromptQL — uses jobs.gem.com |
| Juspay | own portal |
| Swiggy | own portal — careers.swiggy.com |
| PhonePe | own portal |
| Rippling | own ATS product — ats.rippling.com |
| Thoughtspot | own portal |
| Browserstack | Workday — browserstack.wd3.myworkdayjobs.com |
| Innovaccer | Workable |
| MoEngage | Trakstar — moengage.hire.trakstar.com |
| Clevertap | Kula — careers.kula.ai/clevertap |
| Darwinbox | own portal |
| Uniphore | Workday |
| Nutanix | own portal |
| DE Shaw | custom proprietary portal |
| Deel | has a live Ashby token (`deel`) but it currently returns zero postings — worth a periodic re-check via `npm run resolve -- "Deel"` in case that changes |

Amazon, Google, Microsoft — not probed yet (assumed own portals per the build spec; add here properly if you want them tracked).

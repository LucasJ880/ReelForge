# Aivora Real-Footage Ad Agent Investor Demo

## Product positioning

Aivora turns messy real product footage into 5 testable short-form ads, then learns from performance data to generate the next round.

The demo positions Aivora as a creative operating system for teams that already have real product, store, founder, customer, or UGC footage but lack the time and editing capacity to turn that footage into repeatable ad tests.

## Problem

Short-form paid social rewards fast creative iteration, but most small brands, local businesses, and agencies still produce ads through a slow manual loop:

- Someone collects raw footage from phones, creators, stores, or product shoots.
- An editor watches clips, guesses the best hooks, and cuts 1-2 versions.
- The team publishes manually and waits for performance data.
- Learnings are discussed in screenshots, spreadsheets, or calls, then the next edit starts again from scratch.

The pain is not just video generation. The hard part is connecting raw footage, creative variants, review, publishing, metrics, and the next iteration into one repeatable workflow.

## Solution

Aivora ingests real uploaded footage, indexes it into reusable shots, generates 5 ad edit plans, reviews those plans, renders a vertical MP4, imports performance metrics, and distills the next round of creative suggestions.

The MVP demonstrates the loop:

1. Raw footage upload
2. Shot index
3. 5 AdEditPlans
4. AI review
5. Rendered MP4
6. Metrics recap
7. Score report and distillation
8. Next-round suggestions

## Demo flow

Use `/demo/real-footage-ads` for a non-technical customer or investor walkthrough.

Suggested 60-second story:

1. Start with the one-liner: "Aivora turns messy real product footage into 5 testable short-form ads, then learns from performance data to generate the next round."
2. Show the hero exported MP4 so the audience sees the result first.
3. Walk through the product story cards: upload, shot index, 5 plans, review, render, metrics loop.
4. Show the case study numbers: 3 raw clips, 24 FootageShot records, 5 AdEditPlans, 5 reviews, 1 exported 9:16 MP4.
5. Explain scoring dimensions in plain language: hook, clarity, footage match, pacing, technical quality.
6. Close with the learning loop: metrics recap -> distillation -> next-round suggestion.

## Current MVP proof

The RC demo readiness pass validates an end-to-end real-footage workflow:

- 3 raw real-footage clips registered for the demo delivery order.
- 24 FootageShot records generated through preprocessing.
- 5 ContentAngle/VideoBrief paths created for one round.
- 5 AdEditPlans generated for short-form ad tests.
- Reviewer output is available for demo mode and plan review.
- At least 1 vertical MP4 is exported through the FFmpeg render path.
- Demo metrics can be imported or seeded to produce score reports.
- Distillation generates next-round suggestions from performance signals.

This is enough to show the product loop and customer value without introducing heavy backend architecture.

## Target customer

Initial target customers:

- Small and mid-sized DTC brands with frequent product footage but limited creative bandwidth.
- Local service businesses such as clinics, salons, restaurants, pet stores, gyms, and schools that need real-looking social ads.
- Agencies managing many low-budget short-form ad variants for clients.
- Creator-led commerce teams that already collect UGC but need faster testing and feedback.

Best-fit early adopter profile:

- Produces at least 10 short-form videos or ads per month.
- Has real footage but struggles to turn it into multiple variants.
- Wants faster testing and cheaper first-round creative production.
- Can tolerate a lightweight MVP workflow with manual publishing and CSV metrics import.

## Business model assumptions

These are assumptions to validate, not proven economics:

- SaaS subscription for brands or agencies based on monthly video/ad volume.
- Usage-based render or processing credits for heavier video workloads.
- Agency tier for multi-client workspaces, approval links, and reporting.
- Potential services-assisted onboarding for customers without clean footage workflows.

Early pricing should be validated against time saved per creative round, avoided editing cost, and increased capacity to test more variants. Do not claim performance lift until real campaign data supports it.

## Roadmap

### MVP Now

- Real footage upload and registration.
- FootageShot indexing.
- 5 AdEditPlan generation.
- AI review scorecard.
- FFmpeg 9:16 MP4 export.
- CSV metrics import.
- Score report, distillation, and next-round suggestions.
- Public customer/investor demo page.

### V1.5

- Customer-facing review links and comments.
- Stronger asset library and reusable shot management.
- More demo templates across industries.
- Better plan comparison and creative brief export.
- Cleaner operator handoff for manual publishing.

### V2

- Automatic TikTok publishing and platform metrics sync.
- Render workers and queues for production scale.
- Team, client, and agency collaboration workflows.
- Creative performance model for winner prediction and variant recommendations.
- Multi-platform short-form optimization.

## Known limitations

- No automatic TikTok publishing yet. Publishing is manual in the MVP.
- CSV metrics import is the current feedback path. API-based metric sync is a later milestone.
- Mock Director/Reviewer is available for demo mode to keep customer demos stable.
- Render environment may need worker deployment, queueing, and artifact storage hardening for production scale.
- The MVP demonstrates workflow value, not proven campaign lift.
- Early demo data is intentionally narrow and should be expanded across industries before sales claims are generalized.

## What needs validation next

- Whether customers understand the value in under 60 seconds from the public demo page.
- Which customer segment feels the strongest pain: DTC brands, local service businesses, or agencies.
- How much editing cost and turnaround time the workflow can reduce in real customer operations.
- Whether 5 variants per round is the right default testing batch.
- Which scoring dimensions customers trust enough to guide creative decisions.
- Whether CSV metrics import is acceptable for early pilots or blocks adoption.
- What minimum publishing integration is required for customers to pay.
- How render latency and reliability behave with larger real-world footage libraries.

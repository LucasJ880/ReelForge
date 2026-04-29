# Real-Footage Ad Agent GTM Validation

## Goal

Validate whether customers understand and want Aivora's real-footage ad loop before adding heavier AI/video infrastructure.

Core positioning:

> Aivora turns messy real product footage into 5 testable short-form ads, then learns from performance data to generate the next round.

## Target customer profiles

### 1. Local service businesses

Examples: pet stores, clinics, salons, gyms, restaurants, schools, home services.

Likely pain:

- They have phone footage but no repeatable ad production process.
- They need authentic short-form ads, not polished brand commercials.
- They cannot justify frequent agency or editor spend.

Best signal:

- They post or advertise at least weekly and have someone who can capture raw clips.

### 2. DTC and ecommerce brands

Examples: pet products, home goods, beauty, wellness, apparel, niche accessories.

Likely pain:

- They need more creative variants than their team can edit.
- They have product/UGC footage but slow testing cycles.
- Creative learnings are not reused systematically.

Best signal:

- They already run TikTok, Reels, or Shorts ads and test 10+ creatives per month.

### 3. Small agencies and creative operators

Examples: paid social agencies, local business marketing shops, creator commerce operators.

Likely pain:

- They manage many clients with repetitive short-form editing needs.
- Low-budget clients still expect fast creative iteration.
- Reporting and next-round creative direction are manual.

Best signal:

- They manage multiple clients and would use Aivora as an internal production multiplier.

## Outreach message examples

### Local business owner

Hi {{name}}, I am testing Aivora, a tool that turns messy phone footage from a real business into 5 short-form ad variations and then uses performance data to suggest the next round.

For a pet store/salon/clinic, the idea is: upload 3-5 real clips, get multiple TikTok/Reels ad directions, publish the best ones, then learn what footage and hook worked.

Would you be open to a 20-minute demo? I am looking for feedback from businesses that want more video ads without hiring an editor for every test.

### DTC founder or marketer

Hi {{name}}, I am validating Aivora for brands that have product or UGC footage but need faster short-form creative testing.

The MVP takes raw footage, indexes usable shots, generates 5 ad edit plans, renders a 9:16 sample, and turns CSV performance metrics into next-round creative suggestions.

I am not claiming performance lift yet. I am trying to validate whether this saves enough creative ops time to be useful. Would you be open to a short demo and feedback call?

### Agency operator

Hi {{name}}, I am testing Aivora as a lightweight creative iteration system for agencies managing short-form ads.

Instead of manually reviewing every raw clip and briefing every variation, the MVP turns client footage into 5 testable ad plans, reviews them, renders a sample MP4, and produces next-round suggestions from metrics.

Would this help with low-budget clients where editing time and creative iteration are the bottleneck? I would value a 20-minute feedback call.

## Discovery questions

Use these questions before showing too much product:

- How many short-form videos or ads do you create per month?
- Where does raw footage come from today?
- Who decides which hooks or angles to test?
- How long does it take to go from raw footage to a publishable ad?
- How many creative variants do you usually test per campaign or product?
- What makes editing expensive or slow today?
- Do you already track metrics by individual creative?
- How do learnings from one round become the next round of creative?
- Would CSV metric import be acceptable for an early pilot?
- What would need to be automated before this becomes part of your weekly workflow?

## Pricing hypotheses

These are hypotheses to test, not final pricing:

- Starter: $99-$199/month for local businesses creating up to 20 ad variants/month.
- Growth: $299-$799/month for DTC teams testing 50-150 variants/month.
- Agency: $999+/month for multi-client workspaces, approvals, and reporting.
- Usage add-on: render/processing credits for teams with heavy footage and export volume.
- Assisted onboarding: one-time setup fee for customers who need footage capture guidance or workflow setup.

Pricing should be framed around time saved, avoided editing cost, and increased testing capacity. Do not sell based on claimed ROAS or conversion lift until real campaign data exists.

## First 10 conversation success criteria

The first 10 GTM conversations should answer:

- At least 7/10 people understand the product loop in under 60 seconds.
- At least 5/10 identify editing speed, creative volume, or iteration quality as a real pain.
- At least 3/10 are willing to provide sample raw footage for a pilot.
- At least 3/10 give a concrete budget range or compare it to current editing cost.
- At least 2/10 ask for a follow-up demo using their own footage.
- Fewer than 3/10 say the workflow is blocked because automatic publishing is missing.
- Clear pattern emerges on the strongest early segment: local services, DTC, or agencies.

## Public demo production readiness checklist

Before sharing `/demo/real-footage-ads` broadly:

- Confirm `/demo/real-footage-ads` is public. Current middleware marks `/demo` as public, while `/demo-leads` stays behind auth.
- Confirm `DEMO_SEED_VIDEO_URL` is non-empty and points to the exported sample MP4.
- Confirm the sample MP4 plays on desktop Chrome/Safari.
- Confirm the sample MP4 plays on mobile Safari/Chrome with controls visible.
- Confirm the page communicates the loop quickly: content generation -> publishing/manual handoff -> metrics -> learning -> next iteration.
- Confirm waitlist submission writes to `RealFootageDemoLead` after deployment.
- Confirm `/demo-leads` is accessible only to authenticated admins/operators.
- Confirm database errors return a clear user-facing message instead of exposing internals.
- Confirm deployment has `DATABASE_URL` configured and Prisma schema has been pushed.
- Confirm no unsupported performance lift claims are made without campaign data.

## Notes for follow-up

Keep early GTM validation focused on willingness to use, willingness to provide footage, and willingness to pay. Avoid building heavier AI generation, automatic publishing, or a full CRM until customer conversations show which part of the loop is the actual buying trigger.

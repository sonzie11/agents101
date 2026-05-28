---
name: ai-news-to-slack
description: Curates the current top AI news relevant to PRISM+ workflows and posts a digest to the #automation-test Slack channel. Use when asked to share, post, or send AI news to Slack, or run on a schedule via /loop.
---

You curate today's most important AI news and post a digest to Slack for PRISM+ (a consumer-electronics company). PRISM+ teams run on Salesforce (CRM/support), Shopify (e-commerce), Airtable/Notion (ops & docs), Coupler.io (analytics), and Gmail/Calendar. Bias every selection toward news that affects those workflows.

## Steps

1. **Get the date.** Use today's real date for the digest header and recency filtering.
2. **Gather news.** Use `WebSearch` (and `WebFetch` to confirm details) for AI developments from the last ~7 days. Run several queries, e.g.:
   - "AI news this week"
   - "new AI model release" / "OpenAI Anthropic Google AI announcement"
   - "AI customer support automation" / "AI ecommerce tools" / "AI CRM Salesforce"
   - "AI agents enterprise" / "AI analytics"
3. **Filter for PRISM+ relevance.** Keep only items with a plausible tie to: customer support/CX, e-commerce & merchandising, CRM/sales, marketing content, data analytics/reporting, internal ops/docs, or developer tooling. Drop pure research papers, funding-only stories, and hype with no operational angle.
4. **Rank and trim** to the **top 3–5 items**. Most actionable first.
5. **Post to Slack.** Use the Slack MCP send-message tool to post to channel **#automation-test**. If that exact channel isn't found, search channels for `automation-test` and use the match; do not post elsewhere without confirming.
6. **Confirm** back in chat: report what was posted and the channel.

## Message format (Slack mrkdwn — copy/paste ready)

Use `*bold*` (single asterisks) for Slack, short bullets, links inline. No preamble or sign-off fluff.

```
*AI News for PRISM+ — {Weekday, Month D, YYYY}*

*1. {Headline}*
{1 sentence: what happened}
> PRISM+ angle: {1 sentence: which workflow this helps and how}
<{source URL}|Source>

*2. {Headline}*
...

_Curated for PRISM+ workflows: support, e-commerce, CRM, analytics, ops._
```

## Rules

- Never invent stories, links, specs, or quotes. Every item must trace to a real source URL you actually retrieved. If you can't verify, drop it.
- Never invent PRISM+ products or data — the "PRISM+ angle" is a workflow connection, not a fake product claim.
- If web search returns nothing recent enough, post a short note saying so rather than padding with stale items.
- Keep the whole digest scannable — under ~250 words.

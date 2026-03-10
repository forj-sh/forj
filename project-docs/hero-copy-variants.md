# Hero Copy Variants for A/B Testing

Context: Each variant includes the tag, headline, subtitle block, and CTA. Designed to work with the existing terminal demo directly below the hero.

---

## Current (Control)

```
[ INFRA PROVISIONING CLI ]

Project infra. One command.

Domain · GitHub org · Cloudflare · DNS wiring.
Correctly configured, in under 2 minutes.
Built for developers and the agents they work with.

[try for free →]
no credit card · MIT CLI
```

**What's working:** The service list is specific and scannable. "Correctly configured" is the strongest phrase. "Under 2 minutes" is concrete. CTA friction removal is good.

**What's not:** "INFRA PROVISIONING CLI" pattern-matches to DevOps/Terraform. "Project infra" is vague — could mean CI/CD, Docker, Kubernetes. The headline tells you what category it is, not why you care. Agents are grammatically subordinate even though they're a primary channel.

---

## Variant A — Lead with the pain

```
[ LAUNCH CLI ]

Skip the setup weekend.

Domain · GitHub · Cloudflare · DNS —
correctly configured in one command.
For developers and the agents they code with.

[try for free →]
no credit card · MIT CLI
```

**Strategy:** "Setup weekend" names the pain every founder recognizes. They've lost a Saturday to DNS propagation and GitHub org settings. "Skip" is the relief. "Correctly configured in one command" merges the two strongest ideas (correctness + speed) into a single line. "Agents they code with" is more active than "agents they work with" and signals the vibe-coder audience.

---

## Variant B — Lead with the outcome

```
[ DEVELOPER TOOL ]

Domain to deploy in one command.

Register your domain, create GitHub repos,
wire DNS records — MX, SPF, DKIM, DMARC —
all correctly configured in under 2 minutes.

[try for free →]
no credit card · MIT CLI
```

**Strategy:** "Domain to deploy" implies a complete journey, not a single step. It's outcome-oriented: you start with nothing, you end ready to ship. Spelling out the DNS records (MX, SPF, DKIM, DMARC) in the hero is a power move — it signals "we know what we're doing" to technical founders who recognize those acronyms, and it differentiates from generic "infrastructure" tools. Drops the agent mention from the hero entirely (the agent section below handles it) to keep the hero focused.

---

## Variant C — Lead with the speed

```
[ LAUNCH CLI ]

Two minutes to production-ready.

One command provisions your domain, GitHub org,
Cloudflare zone, and every DNS record founders
get wrong. Built for devs and their agents.

[try for free →]
no credit card · MIT CLI
```

**Strategy:** "Two minutes to production-ready" is a falsifiable claim that creates urgency and curiosity. "Every DNS record founders get wrong" reframes the feature list as a pain point — it's not "we configure DNS," it's "we fix the thing you'll mess up." "Devs and their agents" is tighter than the current phrasing and treats agents as equals, not afterthoughts.

---

## Variant D — Boldest, most opinionated

```
[ forj ]

Your startup's first 2 minutes.

Domain registered. GitHub configured.
DNS wired. Email deliverable.
One command. Zero config drift.

[try for free →]
no credit card · MIT CLI
```

**Strategy:** "Your startup's first 2 minutes" reframes the entire product as a moment in time — the birth of a project. It's memorable and shareable. The staccato sentences (registered/configured/wired/deliverable) emphasize outcomes over tools. "Email deliverable" is the sleeper — it's the outcome of correct SPF/DKIM/DMARC, stated in terms the founder actually cares about. "Zero config drift" borrows infrastructure-as-code language but applies it to the initial setup. No agent mention in the hero — let the terminal demo and agent section below carry that.

---

## Additional Headline Candidates (from conversation)

These emerged from discussion but weren't built into full variants:

- **"Launch-ready in one command."** — Describes the state you end up in, not an action the tool takes. Avoids the "deploy" (too technical) and "launch" (too broad) problems. Lets the subtitle explain what "ready" means.
- **"Set up your startup. One command."** — Almost defiantly plain. The mundanity of "set up" contrasted with "one command" creates tension. Says: this thing that's supposed to be tedious? It isn't anymore.
- **"Stand up your startup. One command."** — Developer-native ("stand up a server"), more energetic than "set up." Alliteration might be too much.

### Headlines we ruled out and why

- **"Deploy your startup."** — "Deploy" means pushing code to production. Forj doesn't deploy anything. Sets expectations of a Vercel competitor.
- **"Launch your startup."** — Too big. Sounds like it handles everything (product, marketing, payments). That's Stripe Atlas territory. Gap between promise and product would feel deflating.
- **"Wire your startup."** — In startup world, "wire" immediately means wiring money from VCs. Wrong connotation.

---

## Recommendations

**If optimizing for vibe-coders and solo founders:** Variant A or D. These name the pain (lost weekend, getting DNS wrong) and speak in outcomes. They avoid jargon that signals "this is for DevOps engineers."

**If optimizing for technical founders who already know what SPF/DKIM are:** Variant B. The DNS record callout is a trust signal that says "we actually understand this stuff."

**If optimizing for agent acquisition channel:** Keep "agents" in the hero (Variants A or C). If agents discovering Forj via MCP/tool definitions is the primary growth bet, the hero should validate that use case immediately.

**Regardless of variant:** Replace "INFRA PROVISIONING CLI" with something less DevOps-coded. "LAUNCH CLI," "DEVELOPER TOOL," or just "forj" all work better for the target audience.

---

## Copy Principles Applied

1. **Lead with why, not what.** "Project infra" is a category label. "Skip the setup weekend" is a reason to care.
2. **Specificity builds trust.** MX, SPF, DKIM, DMARC > "DNS wiring." "Email deliverable" > "correctly configured."
3. **Name the pain.** "The part founders always get wrong" (from your features section) is stronger copy than anything in the current hero. Promote that energy upward.
4. **Agents as peers, not appendages.** "For devs and their agents" > "Built for developers and the agents they work with."
5. **The terminal demo does the heavy lifting.** The hero doesn't need to explain everything — it needs to make someone scroll 200px to see the demo. Intrigue > completeness.

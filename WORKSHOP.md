# A tiny game. Your ideas.

You have inherited **Parcel Pals**. Your mission is to improve the experience
for someone playing it for the first time.

There is no single correct solution. You can contribute through design,
observation, writing, analysis or code. You do not need to be a programmer.
Choose something small enough to explore and explain.

## Start by playing

Open the game at <http://127.0.0.1:3000> after following the README setup.
If a different port was chosen, use the address printed in the terminal.
Try a shift. Watch someone else play without explaining the rules for them.

The sorting station shows the current parcel and two upcoming deliveries.
Match destinations with J, K and L under your right hand (1, 2 and 3 also work).
Wrap fragile parcels with W under your left hand before sending
them. Express labels offer a time-limited points bonus, and clean delivery
streaks increase your multiplier. Wrong attempts break the streak and use the
shift's mistake budget. Hints are available without a points penalty.

Some pointers:

- What do they understand immediately? Where do they hesitate?
- What makes a mistake easy or difficult to recover from?
- Can they understand the symbols, instructions and feedback?
- Does the pace feel appropriate? What would "better" mean here?

Write down one observation before choosing a solution.

## Choose a direction

These are possibilities, not a checklist:

- Make an instruction clearer or sketch a different first-time experience.
- Improve a visual cue, layout, accessibility or feedback.
- Explore the difficulty, timing, special handling, hint system or score feedback.
- Look at an event or metric and ask what it does not tell you.
- Use a fictional case file to practise making a recommendation.

You are welcome to suggest something outside this list. Ask your facilitator
to help scope it if needed.

There are [optional stretch ideas](#optional-stretch-ideas) further down. Try
them only if you want to and have the time and tools to do so. Staying with a
small core task is a complete, successful workshop outcome.

## Explore the evidence

Open **Workshop lab** and choose a fictional case file. Every player in those
CSVs is invented. The live local results below them are a separate dataset.
The fictional cases use the earlier eight-parcel game with no fragile or
express parcels, so do not compare their numbers directly with the arcade game.

Before choosing a winner, consider:

- What changed between A and B? Who was included?
- What is the metric's denominator? How many players are represented?
- What uncertainty or trade-off could change your recommendation?
- What additional evidence would you want?

You can inspect the dashboard, download a CSV, or use tools you already know.
You do not have to write a statistical analysis. "We need more evidence" is a
valid recommendation if you can explain why.

## Try a small improvement

Before using an AI assistant or editing code, try completing these thoughts:

> We noticed...
>
> We think... because...
>
> We would compare...
>
> We would measure...
>
> We would also watch...
>
> We would need this evidence before deciding...

The lab can save your proposal and preview both variants. A uses the base
settings; B overrides the settings you name. A JSON object looks like
`{"roundSeconds": 60}`: setting names use double quotes, numbers do not.
Choose your own change and rationale; this example is not a recommended test.

Launching starts a local A/B test for new shifts. Previews are explicitly marked
and excluded from live results. Each browser keeps its assigned group for that
experiment. Do not keep creating new identities to chase a group you prefer.
Only the first round per browser per experiment enters the comparison.

You can demonstrate an experiment without collecting enough players to prove
that it works. A classroom playtest is useful for learning and observation,
not a reliable production launch decision.

## Where things live

| Want to explore... | Start here |
|---|---|
| Instructions, hints, timing, special parcels, mistake budget | Lab settings or `config.json` |
| Page layout and wording | `public/index.html`, `public/lab.html` |
| Colours, spacing and original artwork | `public/styles.css`, `public/assets/` |
| Game interaction | `public/game.js` |
| Experiments and assignment | `experiments.js` |
| Events and metrics | `events.js`, `server.js` |
| Fictional player data | `data/synthetic/` |

There is no build step. Refresh the page after changing HTML, CSS or browser
JavaScript. Restart the server after changing backend JavaScript. Stop a running
experiment before changing the base settings; its variants are frozen at launch.

## Get help

Your facilitator is here to help you understand the system, narrow your idea,
debug a problem, or connect it to real team work.

AI use is optional. Compatible assistants have a tutoring brief: they should
help you reason, explain unfamiliar concepts, and implement your chosen idea
without taking ownership of the decisions. It is fine to ask for a direct
explanation, a stronger hint, or help with code.

### Local project agents preferred

If you choose to use AI, prefer a **local/workspace-connected agent** that can
work with the project files you allow it to access. Ask it to read and follow
`AGENTS.md`, and check that your tool has loaded the workshop instructions.
"Local" here means connected to your project, not necessarily an offline model.

This is a preference, not a requirement. You do not need to install an agent,
buy an account, or use AI to take part. Ask the facilitator for setup help rather
than spending the exercise configuring unfamiliar tools.

### Browser-only AI fallback

This brief is **just in case** you cannot use a local project agent and still
want AI help. Local project agents are preferred; browser-only assistants may
not automatically see your files or repository instructions. If your local
agent is already following `AGENTS.md`, you do not need to paste this too.

For a browser-only assistant, paste the following and then share only the
relevant fictional workshop snippets it needs:

```text
You are my coach for a small, fictional game workshop. Help me learn and keep
ownership of my decisions rather than completing the whole exercise for me.

Ask which task I chose and what I have noticed. Offer a focused question,
pointer, or hint before proposing an end-to-end solution. If I am stuck,
explain the concept directly and offer stronger help; do not make every
answer a quiz. Help freely with setup, syntax and debugging.

Once I choose an approach, help me implement or express it and explain why
it works. Sketches, analysis and proposals are as valid as code changes.
Any stretch idea is optional, only if I want to and can try it with my
available time and tools. Do not treat it as required to succeed.

You can use only the files, snippets and evidence I share. Ask for a
specific missing snippet instead of pretending you inspected my project.
Ground claims in actual evidence, cite trace IDs when relevant, and
separate observations from hypotheses. Never invent results or winners.
Keep synthetic history, previews and new local playtests separate.

Help me finish by explaining what I noticed, why I chose my approach, what
the evidence supports, and what remains uncertain.
```

Do not put personal details, private documents or credentials into the game,
proposal forms, datasets or AI prompts. Use only appropriate workshop material,
regardless of whether the assistant is local or browser-based.

## Another direction: investigate an incident

Open **Incident room**. The alert says GB spend has fallen while two LiveOps
events are active. GB means Game Bits, an invented currency; there are no
payments or real rewards.

Your mission is to explain the affected scope, follow evidence to a plausible
cause, and demonstrate a safe mitigation or fix. Some pointers:

- Compare the two events and the equal historical observation windows.
- Where does the store funnel change: opening, displaying offers, or buying?
- Open the event-store clients to reproduce. What works, and what fails?
- Follow a single trace ID. Check config versions, messages, attributes and
  stacks rather than assuming a successful response means a working client.
- Inspect the event configs and item catalog. Change the smallest relevant
  thing only after you have a hypothesis supported by evidence.
- Open a new client after a change. Can it display offers and complete a
  pretend purchase? What would you monitor next?

Historical traces and KPIs are synthetic. Your new sandbox actions are shown
separately, by config version, and cannot rewrite history. Turning an event off
may be a mitigation; it is not the same as restoring its store. A successful
local reproduction also does not establish a real-world business recovery.

Event configs and catalog live under `data/incident/`. The room has a config
editor, and traces can be exported as JSONL. Your facilitator can help with
queries, code, investigation scope or writing a short incident explanation.
You can choose this investigation instead of an improvement/A-B exercise.

## Optional stretch ideas

**Only if you want to and can:** these are optional ways to go deeper or express
your chosen idea differently, not extra assignments or an expected level of
achievement. Use tools you already have and feel comfortable trying. You can
skip every stretch idea and still have a successful workshop.

| Your chosen direction | Optional stretch |
|---|---|
| Improve the experience | Make a Figma prototype, storyboard, or motion-feedback proposal using a tool you already know. A small JavaScript implementation is another optional route, not a requirement. |
| Read the evidence | Rebuild one metric from an exported CSV, or a store funnel from incident JSONL. Explain the source, grouping and denominator, keeping synthetic and sandbox evidence separate. |
| Propose an A/B test | Ask how the chosen metric could look better without helping players. Suggest a guardrail or additional evidence that would expose that problem. |
| Investigate the incident | Write a five-line incident update: symptom, scope, evidence, mitigation, next check. Cite trace IDs and distinguish observations from hypotheses. If you choose to use AI for a draft, check its claims against the actual traces. |

An incident update, sketch, short recommendation, or verification plan is a
valid contribution in its own right. Do not feel you need to add code or choose
a stretch to make your work count. Ask for help if a task feels too broad.

## Share what you learned

Show the original experience and your improvement or proposal. Explain:

1. What did you notice?
2. Why did you choose this change and this measurement?
3. What does your evidence support, and what remains uncertain?

A thoughtful sketch, a clear analysis or a well-designed experiment is as valid
as a code change. You do not need to complete every section of this guide.

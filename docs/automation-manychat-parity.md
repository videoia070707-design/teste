# Automation Product Contract — Instagram social-to-DM flows

This document records the intended product behavior for G7–G9. It does **not** mark those gates complete and must not be used to bypass G3 HOST PASS.

## Core UX goal

The Automation Engine must support a ManyChat-like flow where a social interaction becomes a conversation and then a gated content/lead flow.

Canonical example:

1. user comments on a selected Instagram post/reel;
2. platform receives `comment.received`;
3. optional public reply is posted under the comment;
4. platform sends a private reply / opening DM when the provider capability allows it;
5. DM can contain text, structured buttons/quick choices and links;
6. flow branches on button/quick-reply response or other verified conditions;
7. optional follower check gates the delivery of content when that capability is available for the connected account/provider;
8. content/link/coupon/file is released only after the configured condition is satisfied;
9. contact is tagged / custom field updated / pipeline stage moved as configured;
10. every side effect is idempotent and auditable.

## Trigger examples

- comment on any post/reel;
- comment on a selected post/reel;
- exact keyword (`LINK`);
- contains keyword (`quero`, `preço`);
- multiple keyword alternatives;
- Story reply / mention where supported;
- DM keyword;
- future provider-specific triggers exposed through CapabilityRegistry.

## Actions

- public comment reply;
- private reply / DM;
- text, image, media, link;
- button / structured-message options when supported by the provider;
- wait;
- tag contact;
- set custom field;
- assign owner/team;
- move pipeline stage;
- human handoff;
- release gated content;
- call AI node;
- external webhook/API node in later gates.

## Follow-to-unlock pattern

Desired UX:

`comment → public reply → DM → follower condition → ask to follow → re-check → release content`

Rules:

- follower verification is a **provider capability**, never a hardcoded assumption;
- Builder only exposes `instagram.relationship.is_following` when CapabilityRegistry says it is available for that connection;
- eligibility/beta/provider restrictions must be visible in UI;
- if the provider cannot verify follow state, the platform must not claim verification;
- fallback flows may ask the user to follow and press `Já segui`, but this is explicitly an unverified user action unless the relationship check is available;
- no browser/session fallback may be silently activated to obtain follower state.

## Button-based release example

Example flow:

- Opening DM: `Tenho o material. Quer receber agora?`
- buttons: `Quero receber`, `Saber mais`, `Falar com alguém`;
- `Quero receber` → optional follower gate;
- if already following → deliver link/content;
- if not following → `Siga o perfil e toque em Já segui`;
- `Já segui` → re-check when supported;
- success → deliver content;
- failure → keep content gated and explain the next action;
- all transitions are persisted as workflow/node runs.

## Reliability requirements

Every action must use the same reliability principles already established in G2/G3:

- idempotency key per side effect;
- resource claim for one-time actions such as private reply per comment;
- provider 5xx/timeout/transport ambiguity → `SEND_RESULT_UNKNOWN` when a side effect may have happened;
- no blind retry for ambiguous results;
- audit log for manual/privileged actions;
- provider capability/eligibility errors are explicit, not silently ignored.

## Builder behavior (G8)

Two UX layers must compile to the same workflow graph:

### Quick Automation

Templates such as:

- `Comentou LINK → responder → mandar link`;
- `Comentou PREÇO → responder → qualificar lead`;
- `Comentou → pedir follow → liberar conteúdo`;
- `Story reply → DM → tag lead`;
- `DM keyword → menu de botões`.

### Advanced Builder

Node canvas with:

- Trigger;
- Condition;
- Message;
- Button/choice;
- Wait;
- Contact action;
- Team/handoff;
- AI;
- External action.

## Gate discipline

Current G3 may implement provider primitives required by these flows (comments, public reply, private reply, message templates, capability discovery), but the visual workflow runtime/builder is not declared complete until G7–G9 and their own tests pass.

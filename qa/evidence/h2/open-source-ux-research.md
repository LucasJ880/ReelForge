# H2 creation UX open-source pattern review

Date: 2026-07-14
Scope: layout and interaction patterns only; no repository code, visual design, copy, assets, or proprietary product material was copied into ReelForge.

| Project | License | Pattern reviewed | ReelForge decision |
|---|---|---|---|
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT | bounded thread viewport, independently scrolling messages, composer kept at the thread edge | Use the structural principle with existing ReelForge components and tokens |
| [Vercel Chatbot](https://github.com/vercel/chatbot) | Apache-2.0 | `dvh` page boundary, `min-height: 0`, explicit overflow ownership | Apply a bounded desktop Agent card so page height no longer follows message count |
| [Hugging Face Chat UI](https://github.com/huggingface/chat-ui) | Apache-2.0 | pinned/detached scrolling: follow new messages only while the reader remains at the bottom | Add a 48px bottom threshold and an explicit jump-to-latest control |
| [Chatbot UI](https://github.com/mckaywrigley/chatbot-ui) | MIT | simple separation between transcript and composer | Keep ReelForge's implementation dependency-free and component-native |

The resulting implementation is original to ReelForge: it uses the existing shadcn/Base UI foundation, approved warm Studio tokens, Agent workflow, quality-plan gate, and localized copy. No dependency was added and bundle composition is unchanged.

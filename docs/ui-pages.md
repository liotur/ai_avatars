# Screens

Four screens, one frame. Boxes are layout, not styling. Copy in the boxes is an example.

```
+----------------------------------------------------------------+
|  (o) Avatars  [ Chat ] [ Library ] [ How it works ]  (*) gpt-5.2 (sun) |
+----------------------------------------------------------------+
|                                                                |
|  page                                                          |
|                                                                |
+----------------------------------------------------------------+
```

- The app opens on the chat: `/` goes to `/chat`, and the name in the corner links to `/chat`, so clicking it during a chat keeps the conversation.
- `Chat` is the current page on `/chat`, `Library` on `/avatars` and its sub-pages, and `How it works` on `/how-it-works`. On a narrow screen the three links move to a row of their own under the name.
- The chip on the right shows the model the assistant answers with. It reads "Assistant needs setup" when no model is configured, and "Assistant offline" when the assistant cannot be reached.
- The last button switches between the dark and the light theme. The first visit follows the system setting.
- Every avatar is drawn as a round badge with its initials, in colours derived from its name, so the same avatar looks the same everywhere.
- An address that is not one of the screens shows "Page not found" with a link back to the library.

## Library — `/avatars`

```
+----------------------------------------------------------------+
|  LIBRARY                                                       |
|  Avatars                                       [ + New avatar ]|
|  Each avatar is a stance the assistant can answer in...        |
|                                                                |
|  +-------------------+  +-------------------+  +-------------+ |
|  | (SC) Skeptical CFO|  | (FM) Future me    |  | ...         | |
|  |      ●●○ balanced |  |      ●●● immersive|  |             | |
|  | A finance chief   |  | Yourself at       |  |             | |
|  | who funds only... |  | eighty, looking...|  |             | |
|  | [Budget requests] |  | [Big decisions]   |  |             | |
|  | [Pricing] [+1]    |  |                   |  |             | |
|  |             Ask > |  | * assistant  Ask >|  |             | |
|  +-------------------+  +-------------------+  +-------------+ |
+----------------------------------------------------------------+
```

- A card opens that avatar for editing. `Ask` opens the chat with that avatar already picked.
- A card shows up to two `Use when` situations, then how many more there are.
- "Made by assistant" appears only when the assistant created the avatar.
- Empty library: the same heading and button, one line — "No avatars yet." — and links to create one or to ask in chat.

## Avatar — `/avatars/new` and `/avatars/:id`

Create and edit are the same form, in five groups. Edit fills the fields and adds `Ask in chat` and `Delete`.

```
+----------------------------------------------------------------+
|  < Library                                                     |
|  (SC)  EDIT AVATAR                                             |
|        Skeptical CFO                  [ Ask in chat ] [ Delete ]|
|        Created in the library · 16 Nov 2026                    |
|                                                                |
|  Identity                                                      |
|    Name            [ Skeptical CFO                           ] |
|    Description     [ A finance chief who...                  ] |
|                                                                |
|  When to use it                                                |
|    Use when        [ Budget requests                    ] [x]  |
|                    [ Add a situation               ] [ + Add ] |
|                                                                |
|  Stance                                                        |
|    Perspective     [ Reads every proposal as a claim on cash.] |
|    Voice           [ Dry and brief. Numbers before adjectives.]|
|                                                                |
|  Priorities                                                    |
|    Cares about                            most important first |
|      1 [ Cash runway                    ] [^] [v] [x]          |
|      2 [ Payback period                 ] [^] [v] [x]          |
|        [ Add                               ] [ + Add ]         |
|    Ignores         [ Vision statements                  ] [x]  |
|                                                                |
|  Intensity                                                     |
|    ( Subtle ●○○ )   ( Balanced ●●○ )   ( Immersive ●●● )       |
|                                                                |
|  [ Cancel ]                                          [ Save ]  |
+----------------------------------------------------------------+
```

- The title is the avatar's name and follows what is typed. The badge follows it too.
- The line under the title is text, not a field: who created the avatar, and when.
- `Cares about` keeps its order, because an earlier item wins when two compete. The arrows move a row; the keyboard stays on the row that moved.
- `Cares about` must keep one row. `Ignores` and `Use when` may be empty. Each list holds at most ten rows and no repeats.
- Enter in a list row moves to the next row. It does not save the form.
- Text typed in an `Add` box and not yet added is added on Save.
- Each intensity says what it does: subtle — the avatar's priorities decide what the answer covers, in plain wording; balanced — priorities and voice; immersive — fully in character, in the first person.
- Save and Cancel stay at the bottom of the window while the form scrolls.
- Delete asks "Delete Skeptical CFO?" with Cancel and Delete. The keyboard starts on Cancel. Cancel leaves the form as it was.
- A 400 puts the message under the field it names. A 409 on the name says that name is already used, under Name. When several fields are wrong, a summary above the form links to each one.

## Chat — `/chat`

```
+----------------------------------------------------------------+
|                    Should we hire two engineers?  (your message)|
|                                                                |
|  (SC) Skeptical CFO  [chosen]                                  |
|       A hiring budget request is a business case.              |
|  +----------------------------------------------------------+  |
|  | Two engineers cost about $400k a year.                  |  |
|  | What do they ship, and when does it pay back?           |  |
|  +----------------------------------------------------------+  |
|                                                                |
|  +----------------------------------------------------------+  |
|  | Ask something                                           |  |
|  | (*) Answer as [ Let the assistant choose  v ]       ( ^ )|  |
|  +----------------------------------------------------------+  |
+----------------------------------------------------------------+
```

- Before any message the page shows a short introduction and three example questions. Choosing one puts it in the message box; it is not sent until the person sends it.
- `Answer as` lists avatars by name. The first option is "Let the assistant choose", which omits `avatarId`.
- Enter sends. Shift and Enter starts a new line.
- While waiting, the page says "Choosing an avatar." or, when one was picked, "Asking Skeptical CFO."
- The answer block appears only after the `avatar` event. First it says "Thinking." and shows the draft as it is written, dimmed and set off by a line, so it is clearly not the answer yet. Then it says "Validating the answer." while the draft is checked.
- A draft that passes becomes the answer in place: the dimming goes and the tag `validated` appears. A draft that fails is replaced by the rewrite, which grows as it is written under "Rewriting after validation."; the first draft stays available behind a "First draft, before validation" toggle, and a line under the reason says what was wrong with it.
- The tags are `validated`, `rewritten after validation`, and `not validated` (the check could not run).
- The text is shown as Markdown (lists, emphasis, code). With the check switched off there is no thinking step: the answer grows with each `delta`.
- The tag after the name is the selection: `chosen`, `created`, or `requested`. The line under it is the reason, when there is one. `created` means the avatar is new and already in the library.
- The avatar's name links to its page, in a new tab, so the conversation stays open.
- While an answer is arriving the send button becomes Stop. Stopping keeps the text that has arrived.
- The assistant remembers the thread, so a follow-up question works and usually stays with the avatar that answered last. Picking another avatar in `Answer as` changes who answers the next message, with the same conversation in view.
- `New chat` appears once there is a message. It clears the thread and starts a new session, so nothing earlier is remembered.
- If the assistant no longer has the chat (it restarted, or dropped a long-idle chat), the next message still goes through in a new one, with a line saying the earlier messages are no longer remembered.
- A failure before the stream is a line above the message box, from the error `detail`, and the message text is put back. A failure mid-answer is shown under the text that arrived.
- When no model is configured, a notice above the message box says what to set, with "Check again", and the message box is disabled.

## How it works — `/how-it-works`

A page for someone seeing the product for the first time. Mostly pictures.

```
+----------------------------------------------------------------+
|  HOW IT WORKS                                                  |
|  Four parts, one job each                                      |
|                                                                |
|  [ Web UI ] [ Assistant ] [ Avatar MCP ] [ Avatar manager ]    |
|                                                                |
|  [ Library page ] ----------- REST ----------> [ Avatar manager ]
|                                                       ^ REST   |
|  [ Chat page ] -- REST --> [ Assistant ] -- MCP --> [ Avatar MCP ]
|             <-- stream --        | HTTPS                       |
|                            [ Language model ]                  |
|                                                                |
|  ONE QUESTION                                                  |
|  (1) You ask                  Chat page -> Assistant           |
|  (2) It fetches the avatars   list_avatars                     |
|  (3) It decides who answers   requested | chosen | created     |
|  (4) It loads that avatar     get_avatar, intensity            |
|  (5) The avatar writes a draft                                 |
|  (6) The draft is validated   answers | sound | stance | voice |
|  (7) You get the answer       avatar -> ... -> delta -> done   |
+----------------------------------------------------------------+
```

- First come four cards, one for each part, with one sentence on its job.
- The diagram under them shows the four parts, the language model, and the protocol on each connection. A dashed arrow is the answer coming back as a stream. A phone gets a tall version of the same drawing.
- The seven steps follow one message. Each step shows who calls whom, what is sent, and what comes back, as short labels rather than prose. Step 3 shows the three ways an avatar is picked; step 4 what each intensity changes; step 6 the four checks and the three ways a check can end.
- The page reads no data, so it works even when the services are down.

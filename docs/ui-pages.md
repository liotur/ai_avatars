# Screens

Two routes, one shell. Boxes are layout, not styling. Copy in the boxes is an example.

```
+--------------------------------------------------+
|  Avatars          Chat                           |
+--------------------------------------------------+
|                                                  |
|  page                                            |
|                                                  |
+--------------------------------------------------+
```

`Avatars` is the current page on `/avatars`. `Chat` is current on `/chat`.

## Avatars — `/avatars`

```
+--------------------------------------------------+
|  Avatars          Chat                           |
+--------------------------------------------------+
|  Avatars                          [ New avatar ] |
|                                                  |
|  +----------------------------------------------+|
|  | Skeptical CFO                    balanced    ||
|  | A finance chief who funds only plans with    ||
|  | numbers.                                     ||
|  +----------------------------------------------+|
|  | Future me at 80                  immersive   ||
|  | Yourself at eighty, looking back.            ||
|  |                                   assistant  ||
|  +----------------------------------------------+|
|                                                  |
+--------------------------------------------------+
```

- A row opens that avatar for editing.
- `assistant` appears only when the assistant created it.
- Empty library: the same heading and button, and one line — "No avatars yet."

## Avatar — `/avatars/new` and `/avatars/:id`

Create and edit are the same form. Edit fills the fields and adds Delete.

```
+--------------------------------------------------+
|  Avatars          Chat                           |
+--------------------------------------------------+
|  < Avatars                                       |
|  New avatar                                      |
|                                                  |
|  Name                                            |
|  [ Skeptical CFO                               ] |
|                                                  |
|  Description                                     |
|  [ A finance chief who...                      ] |
|                                                  |
|  Use when                                        |
|  [ Budget requests                    ] [Remove] |
|  [ Pricing and hiring                 ] [Remove] |
|  [ Add a situation                             ] |
|                                                  |
|  Perspective                                     |
|  [ Reads every proposal as a claim on cash.    ] |
|                                                  |
|  Voice                                           |
|  [ Dry and brief. Numbers before adjectives.   ] |
|                                                  |
|  Cares about                          most first |
|  [ Cash runway                        ] [Remove] |
|  [ Payback period                     ] [Remove] |
|  [ Add                                          ] |
|                                                  |
|  Ignores                                         |
|  [ Vision statements                  ] [Remove] |
|  [ Add                                          ] |
|                                                  |
|  Intensity                                       |
|  ( ) Subtle   (o) Balanced   ( ) Immersive      |
|                                                  |
|  [ Cancel ]                         [ Save ]     |
+--------------------------------------------------+
```

On edit, under the title:

```
|  Created by assistant · 16 Nov 2026              |
|                                    [ Delete ]    |
```

- `Created by` is text, not a field.
- Delete asks "Delete Skeptical CFO?" with Delete and Cancel. Cancel leaves the form as it was.
- A 400 puts the message under the field it names. A 409 on the name says that name is already used, under Name.
- Lists keep the order shown. Cares about must have one row; Ignores and Use when may be empty.

## Chat — `/chat`

```
+--------------------------------------------------+
|  Avatars          Chat                           |
+--------------------------------------------------+
|                                                  |
|  +----------------------------------------------+|
|  | Should we hire two engineers?                ||
|  +----------------------------------------------+|
|                                                  |
|  Skeptical CFO · chosen                          |
|  A hiring budget request is a business case.    |
|  +----------------------------------------------+|
|  | Two engineers cost about $400k a year.      ||
|  | What do they ship, and when does it pay     ||
|  | back?                                        ||
|  +----------------------------------------------+|
|                                                  |
|  Answer as                                       |
|  [ Let the assistant choose            v ]       |
|                                                  |
|  [ Ask something                         ] [Send]|
+--------------------------------------------------+
```

The answer block appears only after the `avatar` event. Text inside it grows with each `delta`. Send stays disabled until `done` or `error`.

- `Answer as` lists avatars by name. The first option is "Let the assistant choose", which omits `avatarId`.
- The line under the name is the selection: `chosen`, `created`, or `requested`, then the reason when there is one. `created` means the avatar is new and already in the library.
- Before any message, the thread area is empty and the composer is usable.
- A failure before the stream is a line above the composer, from the error `detail`. A failure mid-answer replaces the rest of the answer with that same line.


# Project Plan: Markdown Sticky Notes

## 1. Project Overview

Build a lightweight desktop sticky notes application that combines the simplicity and convenience of the built-in Windows Sticky Notes app with the Markdown editing and rendering experience of MarkText.

The application should allow users to create multiple independent notes, position them freely on the desktop, and write formatted content using Markdown. Notes should feel like individual desktop objects rather than documents inside a traditional note-taking application.

The primary focus is speed, simplicity, minimal UI, and a seamless writing experience.

### Core Principles

- **Sticky notes first:** The application should behave like a traditional sticky notes utility, not a full-featured knowledge management system.
  
- **Markdown-native:** Markdown is the underlying format for note content.
  
- **Live rendering:** Notes should display formatted Markdown while remaining easy to edit, following MarkText's general editing philosophy.
  
- **Persistent:** Note content, position, size, appearance, and other relevant state should survive application restarts.
  
- **Minimal:** Avoid unnecessary toolbars, dialogs, settings, animations, and interface elements.
  
- **Local-first:** Notes should be stored locally without requiring accounts, cloud services, or an internet connection.
  

## 2. Core Features

### 2.1. Multiple Independent Notes

Users should be able to create and manage multiple sticky notes.

Each note must have:

- A unique, persistent identifier.
  
- Editable Markdown content.
  
- An independently configurable position and size.
  
- A configurable background color or theme.
  
- A creation timestamp and last-modified timestamp, if useful for note management.
  

Users should be able to create, close, reopen, and delete notes.

Closing a note must not delete its contents. Deleting a note should require confirmation or provide a reliable recovery mechanism.

The application should support notes existing simultaneously as separate desktop windows.

### 2.2. Markdown Editing and Rendering

Markdown support is one of the application's most important features.

Use MarkText as the primary reference for the editing experience. The goal is not to reproduce its entire interface, but to provide similarly intuitive Markdown editing and formatted display inside a compact sticky note.

Support at least:

- Headings.
  
- Bold and italic text.
  
- Strikethrough.
  
- Ordered and unordered lists.
  
- Nested lists.
  
- Checklists with interactive checkboxes.
  
- Links.
  
- Inline code.
  
- Fenced code blocks with syntax highlighting where practical.
  
- Blockquotes.
  
- Horizontal rules.
  
- Tables, provided they can be implemented without compromising the compact editing experience.
  

#### Editing behavior

Prefer an inline WYSIWYG-style Markdown editor over a separate raw Markdown editor and preview pane.

For example:

- Typing `**bold**` should produce bold text as the user completes the formatting syntax.
  
- Typing Markdown headings should produce visibly styled headings.
  
- Lists should support natural continuation when pressing Enter.
  
- Checkboxes should be clickable in the rendered view.
  
- Keyboard shortcuts should support common formatting actions.
  
- Users should not need to switch between editing and preview modes for ordinary writing.
  

Raw Markdown source should remain the canonical representation of note content. Formatting, cursor movement, and editing must not cause unintended loss of Markdown structure.

The editor should handle partially typed Markdown gracefully. Users must be able to edit existing formatted text without fighting the rendering behavior.

### 2.3. Sticky Note Window Behavior

Each note should behave like an independent sticky note.

Required behaviors:

- Freely drag notes around the desktop.
  
- Resize notes.
  
- Keep each note's position and dimensions between sessions.
  
- Allow notes to be brought to the foreground by clicking them.
  
- Support normal desktop window interactions.
  
- Provide a compact title bar or similarly unobtrusive drag region.
  
- Prevent accidental dragging when the user is selecting or editing text.
  

Provide an optional always-on-top setting per note if supported by the chosen desktop framework.

The application should launch quickly and avoid unnecessary windows or splash screens.

Do not force all notes into a single large application window unless a technical limitation makes independent windows impractical.

### 2.4. Appearance and Layout

The visual design should be minimal and optimized for prolonged use.

Design guidelines:

- Light backgrounds by default.
  
- Neutral whites and light grays, with restrained use of light blue.
  
- Sharp corners; avoid excessive rounded corners.
  
- No decorative gradients, glowing effects, or unnecessary shadows.
  
- Compact typography and comfortable line spacing.
  
- Clear distinction between the note's editing area and window controls.
  
- Minimal visual chrome so that content remains the primary focus.
  

Notes should be readable at small window sizes. Content should wrap naturally, and the editor should handle overflow without breaking the window layout.

A note's background color should be configurable without making text difficult to read.

### 2.5. Persistence and Recovery

The application must automatically save changes.

Requirements:

- Save edits without requiring the user to press a Save button.
  
- Persist note content and metadata locally.
  
- Persist window positions, dimensions, and per-note preferences.
  
- Restore notes to their previous state after restarting the application.
  
- Avoid excessive disk writes during rapid typing by using an appropriate debounce or batching strategy.
  
- Prevent corruption or loss of note content if the application closes unexpectedly, as far as reasonably practical.
  

The application should not require users to manually manage files for ordinary note-taking.

The internal storage format should be simple, documented, and maintainable. A structured local database or a collection of Markdown files with metadata are both acceptable options. Choose the option that best supports reliable persistence and future extensibility.

### 2.6. Note Management

Provide a minimal way to access and manage existing notes.

At minimum:

- Create a new note.
  
- Close and reopen existing notes.
  
- Delete a note.
  
- Identify notes when their windows are closed.
  
- Restore previously open notes on startup.
  

A small tray menu, application menu, or compact note manager may be used for these operations.

Search, tagging, folders, synchronization, and advanced organization are not required for the initial release.

## 3. Interaction and Keyboard Shortcuts

The app should prioritize keyboard-driven workflows.

Provide conventional shortcuts where appropriate:

- `Ctrl+N`: Create a new note.
  
- `Ctrl+S`: Optional manual save or confirmation of saved state; saving must already happen automatically.
  
- `Ctrl+B`: Toggle bold.
  
- `Ctrl+I`: Toggle italic.
  
- `Ctrl+K`: Insert or edit a link, if supported by the editor.
  
- `Ctrl+Z` / `Ctrl+Y`: Undo and redo.
  
- `Escape`: Dismiss transient UI or exit a temporary interaction where appropriate.
  

Avoid intercepting standard editor shortcuts unnecessarily.

Shortcuts must behave consistently on Windows, and any platform-specific behavior should be documented.

## 4. Technical Direction

First inspect the existing project and development environment, if one is provided, before making architectural decisions.

If starting from scratch, prefer a lightweight Windows desktop application architecture that supports:

- Independent desktop windows.
  
- Reliable window positioning and resizing.
  
- Local persistence.
  
- A capable Markdown editor.
  
- Low idle resource consumption.
  
- Straightforward packaging and installation.
  

Evaluate an appropriate web-based desktop framework, such as Tauri, alongside the available Markdown editor libraries. Do not select a framework solely because it is familiar; validate that it can meet the window-management requirements.

For the editor, investigate existing libraries that support inline Markdown editing and rendering. Prioritize editing quality and compatibility over implementing a custom Markdown parser.

Keep the following concerns separate:

- Desktop window lifecycle and management.
  
- Note data and persistence.
  
- Markdown editing and rendering.
  
- Application-level note management.
  
- Visual styling and theming.
  

Avoid unnecessary dependencies and abstractions. The codebase should remain easy for one developer to understand and maintain.

## 5. Non-Goals for the Initial Release

Do not implement the following unless they are necessary for the core application:

- User accounts or authentication.
  
- Cloud synchronization.
  
- Collaboration.
  
- Mobile applications.
  
- AI features.
  
- A complex document library.
  
- A full-screen Markdown editor.
  
- Plugin systems.
  
- A built-in publishing system.
  
- Extensive customization panels.
  
- A complicated folder and tagging hierarchy.
  

The goal is a dependable sticky notes utility, not a competitor to full-scale note-taking applications.

## 6. Implementation Phases

### Phase 1: Technical Validation

Before building the full application:

1. Inspect the project structure and available tooling.
  
2. Choose the desktop framework and Markdown editor.
  
3. Prototype one independently movable and resizable note window.
  
4. Verify that Markdown editing and rendering work together naturally.
  
5. Verify that note content and window state can be persisted.
  
6. Identify any editor limitations that could affect the intended experience.
  

Resolve major technical risks before proceeding.

### Phase 2: Minimum Viable Product

Implement:

- Application startup and shutdown.
  
- Creation of independent note windows.
  
- Markdown editing and rendering.
  
- Automatic local persistence.
  
- Position and size persistence.
  
- Basic window controls.
  
- Basic note creation, closing, reopening, and deletion.
  

At the end of this phase, the app should be usable for everyday note-taking.

### Phase 3: Editing Experience

Improve:

- Markdown formatting behavior.
  
- Cursor placement and selection.
  
- Keyboard shortcuts.
  
- List continuation and indentation.
  
- Interactive checkboxes.
  
- Undo and redo.
  
- Code blocks and syntax highlighting.
  
- Links and other supported formatting.
  
- Handling of incomplete Markdown syntax.
  

Test these behaviors while editing both new and existing notes.

### Phase 4: Desktop Integration and Polish

Implement:

- Startup restoration.
  
- Optional always-on-top behavior.
  
- A convenient note management entry point.
  
- Per-note appearance settings.
  
- Reliable resizing and positioning.
  
- Edge cases involving multiple monitors and different display scaling settings.
  
- Application packaging and installation.
  

### Phase 5: Testing and Release

Test the app under realistic usage conditions before considering it complete.

Fix data loss, rendering bugs, focus issues, and window-management problems before adding optional features.

## 7. Acceptance Criteria

The application is considered ready for its initial release when all of the following are true:

1. A user can create several notes and keep them open simultaneously.
  
2. Each note can be independently moved and resized.
  
3. Notes can display and edit formatted Markdown without requiring a separate preview window.
  
4. Common Markdown formatting works correctly when creating and modifying text.
  
5. Checklists can be interacted with directly.
  
6. Closing and reopening the application does not lose saved notes.
  
7. Note positions, dimensions, and relevant settings persist.
  
8. Closing a note is distinct from deleting it.
  
9. Editing text does not trigger accidental window dragging or unexpected focus changes.
  
10. Notes remain usable at small sizes and on multiple monitors.
  
11. The application works offline.
  
12. The app does not require users to manually save every edit.
  
13. The application remains responsive during ordinary typing and window manipulation.
  
14. The packaged application can be installed and launched without a development environment.
  

## 8. Instructions for the Implementing LLM

Work incrementally. Do not attempt to generate the entire application in one step.

Start by examining the project, identifying constraints, and proposing a concrete architecture. Explain the most important technical choices briefly, especially the choice of Markdown editor and the strategy for managing independent note windows.

Then implement the smallest working vertical slice: one note window with inline Markdown editing and reliable persistence.

Validate that slice before expanding to multiple notes and desktop integration.

Before adding a feature, check whether an existing dependency already provides it. Avoid reinventing Markdown parsing, editing behavior, or operating-system window management without a compelling reason.

Maintain readable code, clear module boundaries, and consistent error handling. Test the actual application rather than relying solely on type-checking or successful compilation.

When encountering a significant design decision or technical limitation, explain the trade-off and recommend a solution rather than silently changing the intended behavior.

The final result should feel like a natural Windows utility: quick to open, unobtrusive, easy to edit, and reliable enough to keep important notes open on the desktop throughout the day.

### Global Keyboard Shortcuts

Implement the following application-wide keyboard shortcuts. They should work when the application is running, even if a note is not currently focused, unless the operating system or another application prevents the shortcut from being intercepted.

| Shortcut | Action | Expected behavior |
| --- | --- | --- |
| `Alt+V` | Paste into new note | Creates a new note containing the current clipboard contents, then shows and focuses that note. |
| `Alt+N` | New empty note | Creates an empty note, shows it, and focuses its editor. |
| `Alt+Del` | Delete selected note | Deletes the currently selected note. If no note is selected, do nothing. Consider a recovery mechanism or confirmation to prevent accidental data loss. |
| `Alt+H` | Hide all notes | Hides all open note windows without deleting them or losing unsaved changes. |
| `Alt+S` | Show all notes | Shows all existing notes that are currently hidden and restores their saved window positions. |
| `Alt+T` | Toggle always-on-top | Toggles the always-on-top state of the currently selected note. If no note is selected, do nothing. |

#### Shortcut behavior and implementation requirements

- **Global availability:** Register shortcuts at the application level so they work when focus is outside the note windows. Use the desktop framework's global shortcut facilities where appropriate.
  
- **Selected note:** Maintain a clear definition of the selected note. Prefer the most recently focused note window, updating the selection when the user activates another note.
  
- **Clipboard handling:** `Alt+V` should read the clipboard at the time the shortcut is invoked. Preserve plain text and, where practical, support clipboard content that can be converted into Markdown. Do not unexpectedly execute pasted HTML or other active content.
  
- **Show and hide:** Hiding notes must not close or delete them. Showing notes must restore their previous positions, dimensions, and always-on-top settings.
  
- **Always-on-top:** The toggle must affect only the selected note, not every note. Its current state should persist across application restarts.
  
- **Deletion:** Deleting a note must remove it from persistent storage and the note manager. If undo or recovery is implemented, make the recovery behavior clear.
  
- **Shortcut conflicts:** Global shortcuts may conflict with operating-system shortcuts or other applications. Test registration and failure handling on Windows, and document any unavoidable conflicts.
  
- **Focus and visibility:** `Alt+V` and `Alt+N` must leave the newly created note visible and ready for immediate typing. `Alt+S` must not create duplicate windows for notes that are already visible.
  

Add acceptance tests verifying that each shortcut works, that hiding and showing preserves note state, and that clipboard contents and selected-note behavior are handled correctly.
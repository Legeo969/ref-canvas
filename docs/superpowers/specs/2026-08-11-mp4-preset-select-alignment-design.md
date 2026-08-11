# MP4 Preset Select Alignment Design

## Problem

The three custom select triggers in each MP4 conversion preset row display their label and chevron on separate vertical tracks. The shared `.mp4-preset-row > button` rule intended for the default and delete icon buttons also matches `SelectMenu` triggers because those triggers render as direct child `<button>` elements. Its more specific grid layout overrides the select trigger's flex layout.

## Scope

- Fix alignment only inside MP4 conversion preset rows.
- Keep the existing dimensions, colors, spacing, behavior, and accessibility semantics.
- Do not change other `SelectMenu` instances or the MP4 preset data model.
- Preserve all unrelated uncommitted workspace changes.

## Chosen Approach

Narrow the MP4 icon-button selectors so they exclude `.select-menu-trigger`. Apply the same exclusion consistently to the base, hover/active, and disabled selectors. This lets the existing select-menu styles retain control of the three select triggers while leaving the default and delete buttons unchanged.

This is preferred over increasing the global select selector specificity because a global override could affect unrelated screens. It is also preferred over adding new JSX classes because the existing `.select-menu-trigger` class already provides the required distinction.

## Expected Result

- Codec, quality, and resolution labels remain horizontally aligned with their chevrons.
- Text and icons are vertically centered within the existing 34 px controls.
- Default and delete icon buttons retain their current 40 px layout and states.
- Other settings-page select menus remain visually unchanged.

## Verification

- Run the relevant renderer component tests for `SelectMenu` and settings behavior.
- Run TypeScript type checking.
- Inspect the final diff to confirm that implementation changes are limited to the MP4 preset selector scope and any narrowly targeted regression coverage.

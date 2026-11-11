# MeshForge shared brand assets

All Gear Apps frontends (Blade Tracking, Cutter Builder, Greenshed, Lapper) use this folder. The suite is
branded **MeshForge** — "by Dana Gear Apps Suite", "Connected Manufacturing Platform".

| File | Use |
| --- | --- |
| `meshforge-mark.svg` | Mark for dark backgrounds. Used by the sidebar and the login brand panel. |
| `meshforge-mark-light.svg` | Mark for light backgrounds. Used by the mobile login card. |
| `meshforge-mark-white.svg`, `meshforge-mark-black.svg` | Single-colour marks for engraving, print and overlays. |
| `meshforge-icon.svg` | App icon: the mark on its charcoal rounded tile. Source of the favicons. |
| `meshforge-logo.svg`, `meshforge-logo-light.svg` | Full lockup (icon, wordmark, tagline) for dark and light backgrounds. |
| `../branding/meshforge-favicon.png` | 256 px browser-tab icon referenced by every `index.html`. |
| `../branding/meshforge-icon-512.png`, `../branding/meshforge-logo*.png` | PNG renders for documents and installers. |
| `dana-logo.svg` | Dana parent-company mark. No longer shown by the application shell. |

The wordmark is outlined, so the SVGs have no font, image or web dependencies.

## Colours

| Role | Value |
| --- | --- |
| Charcoal background / sidebar | `#14171C` |
| Charcoal tile / raised sidebar | `#232830` |
| Forge orange (mark, accents on dark) | `#E48B43` |
| Action orange (buttons and links on light, 4.9:1 on white) | `#B4581A` |
| Steel grey | `#AEB6C2` |
| Anvil white | `#F5F5F2` |

The application palette lives in the Gear layer of `libs/shared/dana-ui/src/styles`: the `gear-apps/` modules
(tokens in `gear-apps/foundation/tokens.css`) and the "MeshForge theme for the Dana core" block at the top of
`gear-compat-overrides.css`. The Dana core (`dana-core/*.css`) is shared with other Dana apps and keeps its
own colours; do not recolour it. Informational (blue), success, danger and Greenshed machine-state colours are
operational signals and are not part of the brand palette.

## Replace the logo

Replace **`meshforge-mark.svg`** (and `meshforge-mark-light.svg`) with the new approved SVG and keep the same
filenames. The shared shell and login screens use the replacement after the apps are rebuilt/restarted.

Recommended SVG requirements:
- transparent background;
- tight viewBox around the artwork;
- no external font/image/web dependencies.

Do not create separate logo copies under each app. This folder is the single Gear Apps source of truth.

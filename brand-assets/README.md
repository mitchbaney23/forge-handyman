# Forge Handyman — Brand Assets

Shared home for everything brand-related: logos, source files from the
designer, and the brand guide. This folder is for **people**, not the
website — nothing in here is served to visitors, so files can be added,
renamed, or reorganized freely without touching the site.

## What goes where

| Folder | What belongs in it |
|---|---|
| `logo/source/` | The designer's original working files — `.ai`, `.eps`, `.psd`, layered files, anything editable. If the designer sent a zip, unzip it and put the contents here. |
| `logo/exports/` | Ready-to-use versions — PNG, SVG, JPG in various sizes/colors. Currently holds the logo and anvil mark the site uses today. |
| `brand-guide/` | The Forge brand guide (colors, fonts, voice). |

## How to add files (no coding needed)

1. Sign in at github.com and open this folder.
2. Click into the subfolder you want (e.g. `logo/source`).
3. Click **Add file → Upload files** (top right).
4. Drag the files in and click **Commit changes**.

Files up to 25 MB upload fine through the website. Bigger than that
(large layered Photoshop files, video), keep in Google Drive and add a
link to it in this README instead.

## Two things to know

- **This repository is public.** Anything here can be seen and downloaded
  by anyone on the internet. Fine for logos (they're on the website
  anyway) — but don't put anything private here: no passwords, contracts,
  customer info, or financials.
- **The website's live copies are separate.** The site reads its logo
  from the `public/` folder at the top of the repository, not from here.
  Adding a new logo here does **not** change the website — that's a
  deliberate second step (ask Claude or update `public/logo.png`).

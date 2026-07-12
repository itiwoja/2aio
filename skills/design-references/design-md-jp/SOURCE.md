# Source & Attribution — Japanese Design Token Reference

- **Dataset:** `awesome-design-md-jp` — 381 real-world Japanese web services as machine-readable DESIGN.md token specs (colors, typography, spacing, 禁則処理/kinsoku, palt/kern, 和欧混植 rules).
- **Vendored (template + samples only) from:** https://github.com/kzhrknt/awesome-design-md-jp
- **Original author:** kzhrknt (Japanese-focused sibling of VoltAgent/awesome-design-md)
- **License:** MIT

## Why only template + samples here
The full 381-site dataset (~1,150 files) is intentionally NOT vendored into the framework
to avoid bloat. It stays cloned at `dev/skills/awesome-design-md-jp/`. This module ships:
- `TEMPLATE-DESIGN.md` — the blank scaffold for authoring a new DESIGN.md
- `samples/` — a few representative specs so agents can learn the format offline

When an agent needs a specific site's tokens, read from the full local clone or upstream.

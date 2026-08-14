# AGENTS.md — Repository scripts

Gate scripts invoke pnpm shell-free, installer and SDK pack scripts spawn Node plus each tool's JavaScript entry, normalize repository-relative glob paths to `/` at ingestion, and keep platform adaptation in the gate that needs it instead of a shared platform layer.

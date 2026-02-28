# Repository Guidelines

This repository contains FluxTerm, a Tauri-based terminal app with a Rust backend and a Vite + React frontend. Use the sections below to stay consistent with current structure and tooling.

## Project Structure & Module Organization

- `src/`: Frontend source (React + TypeScript). UI components, hooks, and utilities live here.
- `public/`: Static assets served by Vite.
- `crates/engine/`: Core engine for SSH/SFTP and terminal features.
- `crates/tauri/`: Tauri desktop shell.
- `ARCHITECTURE_V1.md`: High-level architecture notes.

## Build, Test, and Development Commands

Frontend (from repo root):

- `pnpm dev` or `pnpm web:dev`: Start Vite dev server.
- `pnpm web:build`: Type-check and build frontend (`tsc && vite build`).
- `pnpm preview`: Preview the production Vite build.
- `pnpm format`: Format frontend files in `src/` with Prettier.

Desktop app:

- `pnpm build`: Build the Tauri app (Rust + frontend bundle).
- `pnpm tauri dev`: Run the Tauri dev app.

Rust workspace:

- `cargo build`: Build all crates in the workspace.
- `cargo test`: Run Rust tests (if present in a crate).

## Coding Style & Naming Conventions

- TypeScript/React: 2-space indentation and Prettier formatting (run `pnpm format`).
- Paths and imports: Prefer `@/` alias for `src/` imports (configured via Vite/TS).
- Rust: Follow standard `rustfmt` conventions.
- Rust formatting/linting: Run `cargo fmt` and `cargo clippy --all-targets --all-features -- -D warnings` before opening a PR.
- Naming: `PascalCase` for components, `camelCase` for functions and variables.
- Comments: Follow `cargo doc` conventions so generated docs are clear and readable; do not add meaningless comments.

## Testing Guidelines

There is no dedicated JS test runner configured yet. For Rust, use `cargo test` in the workspace or inside a crate once tests are added. If you add tests, place them near the module under test or in a `tests/` folder per Rust conventions.

## Documentation Guidelines

- Add Chinese documentation comments for frontend/backend functions, structs, and modules; Rust docs must use `//!` and `///` and comply with `cargo doc` conventions.
- CHANGELOG entries should be user-facing; avoid implementation details and internal refactors.
- Please use Chinese for document content (including README and design documents).

## Commit & Pull Request Guidelines

The Git history only contains an initial commit, so no established message convention exists yet. Use concise, imperative subjects (e.g., "Add SFTP path sync").

For pull requests:

- Describe the behavior change and scope clearly.
- Include screenshots or GIFs for UI changes.
- Link relevant issues if applicable.

## Configuration Tips

- `tsconfig.json` and `vite.config.ts` define path aliases and build settings.
- `ARCHITECTURE_V1.md` documents the design intent; update it when you introduce structural changes.

## Development Process

- If a task requires modifying more than three files, pause first and break it down into updated tasks.
- Before writing any code, please describe your proposed approach and wait for approval. If the requirements are unclear, make sure to ask clarifying questions before writing any code.
- During this development-stage refactor, compatibility is not required; prioritize a clean redesign.
- When a bug is caused by backend, engine, state machine, or lifecycle timing issues, do not add frontend “stopgap” patches to mask it. Fix the source of truth first, and only adjust frontend logic when the root cause is genuinely on the frontend side.

## Communication

- Please respond in chinese by default.

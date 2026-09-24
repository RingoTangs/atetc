# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the TypeScript implementation. Core archive logic is in `pak.ts`, LZSS handling in `lzss.ts`, and public exports in `index.ts`; command-line behavior is split across `src/cli/`, with `src/cli.ts` as the executable entry point. Tests are colocated with their subjects as `*.spec.ts`. Binary fixtures and expected unpacked files live under `sample/`. Build configuration is kept in `tsdown.config.ts`, TypeScript settings in `tsconfig*.json`, and generated package output in `dist/`; do not hand-edit `dist/`.

## Build, Test, and Development Commands

Use Node.js 22+ and pnpm 10 (the pinned versions are documented in `package.json`).

- `pnpm install --frozen-lockfile` installs the exact locked dependencies.
- `pnpm dev` runs tsdown in development/watch mode.
- `pnpm build` produces the minified ESM library, CLI, and declarations in `dist/`.
- `pnpm test` starts Vitest in watch mode; `pnpm test:run` runs the suite once.
- `pnpm typecheck`, `pnpm lint`, and `pnpm format` run the individual static checks.
- `pnpm check` runs all linting, formatting, type, and test checks expected before submission.
- `pnpm pack:check` previews the npm package contents without publishing.

## Coding Style & Naming Conventions

Write strict TypeScript using ESM imports. Follow the existing two-space indentation, LF line endings, single quotes, trailing commas, and no semicolons. Prettier and the Antfu ESLint configuration enforce these rules; use `pnpm check:fix` for safe automatic fixes. Prefer `camelCase` for functions and variables, `PascalCase` for types, and kebab-case filenames such as `pack-command.ts`. Keep archive parsing and compression APIs buffer-based and free of file I/O; isolate filesystem work in CLI modules.

## Testing Guidelines

Vitest runs in the Node environment. Place tests beside the implementation and name them `*.spec.ts`; use descriptive `describe`/`it` statements. Add focused unit tests for malformed input and boundary cases, plus fixture-backed tests when changing archive compatibility. No coverage threshold is configured, so prioritize meaningful regression coverage. Run `pnpm test:run` or the full `pnpm check` before opening a pull request.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commit prefixes such as `feat:`, `fix:`, `test:`, `docs:`, and `chore:`. Keep subjects imperative, concise, and scoped to one change. Pull requests should explain behavior changes, identify affected CLI/library APIs, link relevant issues, and include test results. For CLI output changes, add a short terminal example; for archive-format changes, describe the sample or compatibility case exercised. Do not commit unrelated generated artifacts.

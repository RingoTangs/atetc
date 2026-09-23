# tsdown-template

<p align="center">
  <strong>A minimal TypeScript library template powered by tsdown.</strong>
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D22-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10-F69220?logo=pnpm&logoColor=white">
  <img alt="tsdown" src="https://img.shields.io/badge/tsdown-0.23-0F172A?logo=vite&logoColor=white">
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white">
  <img alt="ESLint" src="https://img.shields.io/badge/ESLint-10-4B32C3?logo=eslint&logoColor=white">
  <img alt="Prettier" src="https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=1A2B34">
</p>

<p align="center">
  Build TypeScript libraries with dual ESM/CJS output, typed declarations, and a ready-to-use quality toolchain.
</p>

<p align="center">
  English | <a href="./README.zh-CN.md">简体中文</a>
</p>

## Requirements

- Node.js `>=22` to run the package
- Node.js `22.23.2` to develop this template
- pnpm `10`

## Development

- `pnpm i` installs dependencies
- `pnpm dev` creates an unminified local development build
- `pnpm build` creates a minified production build
- `pnpm test` starts Vitest in watch mode
- `pnpm test:run` runs the Vitest suite once
- `pnpm lint` runs ESLint over the repository
- `pnpm lint:fix` applies safe ESLint fixes
- `pnpm format` checks formatting with Prettier
- `pnpm format:fix` formats supported files with Prettier
- `pnpm typecheck` runs TypeScript project references with `tsc -b`
- `pnpm check` runs lint, format check, typecheck, and tests
- `pnpm fix` runs lint and format fixes
- `pnpm pack:check` previews the files npm will package

## Usage

1. Create a new repository from this template.
2. Update `package.json` metadata for your package.
3. Run `pnpm i`.
4. Use `pnpm dev` during development.
5. Verify changes with `pnpm check`.

## Publishing

Before publishing a real npm package:

1. Remove `private: true` from `package.json` or set it to `false`.
2. Update `name`, `version`, `description`, `author`, `repository`, `bugs`, and `homepage`.
3. Run `pnpm check` to verify linting, formatting, types, and tests.
4. Run `pnpm build` to create the package artifacts.
5. Run `pnpm pack:check` to inspect the package contents.
6. Run `npm publish` when the dry-run output looks correct.

Steps 3–5 provide an explicit preflight check. `npm publish` automatically repeats them through the `prepublishOnly` lifecycle script, running `pnpm check`, `pnpm build`, and `pnpm pack:check` in that order.

## Output

The published package includes minified ESM and CJS runtime files and declarations from `dist/`, along with npm metadata, README, and LICENSE. Runtime files start with a banner containing the package name and version.

# Engineering Rules

## Core Philosophy


Claude-Nim is a deterministic system.
Every component must be:

* Deterministic
* Fast
* Measurable
* Modular
* Testable

## Performance Rules

* Minimize allocations
* Minimize disk I/O
* Minimize token usage for the end-user agent
* Avoid duplicate work
* Prefer streaming over loading entire files
* Prefer incremental indexing
* Cache expensive operations
* Benchmark critical paths

## Runtime Rules

* **Strict Bun.js Runtime:** This project explicitly uses Bun.js as its runtime and package manager. Do not use Node.js, `npm`, or `npx` for executing scripts, testing, or building. Always use `bun run ...`, `bun install`, and `bunx`.

## Code Organization

* One feature per file
* One responsibility per class/module

Maximum file length: **700 lines**
Preferred target: **300 lines or less**
Soft cap: **420 lines** (refactor if a file exceeds this threshold)

## Object-Oriented & Trait-Based Design

Use structures that improve maintainability:

* Encapsulation
* Traits/Interfaces
* Dependency injection
* Composition over inheritance

Avoid: God classes, Massive utility files, Deep inheritance chains.


## Architecture Rules

Every subsystem must be modular

## Quality & Memory Rules

* Unit tests, integration tests, and performance tests are required.
* Avoid unnecessary copies; prefer references.
* Use streaming and incremental processing to avoid loading entire repositories into memory.
* No dead code or placeholder implementations.

## Security Rules

* No telemetry by default.
* No hidden network requests.
* No user data collection.
# sample-java-project (parser fixture)

A small but representative multi-file Java project used by the parser's
end-to-end determinism and contract-conformance tests
(`packages/parser/src/end-to-end.test.ts`).

It intentionally exercises the features the parser must handle:

- **Multiple packages** — `com.example` (root), `com.example.model`,
  `com.example.service`, `com.example.app`.
- **Nested / inner types** — `User.Role` (static nested) and
  `UserService.Session` (inner), producing `$`-joined class FQNs.
- **Method overloads** — `User.getName()` / `User.getName(String)` and
  `UserService.create(String, long)` / `UserService.create(String)`, each a
  distinct `function` node distinguished by its parameter-type list.
- **Cross-file imports that resolve into edges** — the service and app files
  import model/service types, so the stitcher emits `file → class` dependency
  edges.
- **A root-level file** — `Bootstrap.java` sits directly in the project root
  (empty `directoryPath`) while still declaring a package.

This fixture is checked in (not generated) so the determinism digest is stable
across machines and runs. It is **not** a build target — no Maven/Gradle wiring
is expected; the parser reads the `.java` source directly.

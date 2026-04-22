# return

Workflow-terminator components. Stub implementations: print the result to stdout. Real trigger modules are expected to plug in their own response delivery (e.g. via context/closures) — this module exists to give the editor a typed terminator.

Package name is `ret` because `return` is a Go keyword.

# log

`info(message: string)`. Side-effecting sink. The `message` input is `passthrough`, exposing a `message__pt` data output for builder-pattern chaining.

Package name is `logmod` to avoid colliding with Go's `log` standard library.

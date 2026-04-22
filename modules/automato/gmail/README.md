# gmail

`send(email: Email) -> message_id: string | error`. Stub implementation; real authentication/transport not wired. The error data port (`__errval__`) is a `string` — the compiler emits `err.Error()` when it is consumed.

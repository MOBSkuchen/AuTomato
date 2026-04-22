# webhook

Trigger module. `on_request` registers an HTTP handler on `:8080` (or `$WEBHOOK_ADDR`) and invokes the workflow callback for every request, passing the parsed `HTTPRequest`.

Trigger style: **callback**.

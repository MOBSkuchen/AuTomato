# http-request

`fetch(request: HTTPRequest) -> (body: string, status: int) | HTTPError`. Defaults method to `GET` when empty. 4xx/5xx responses are returned as `HTTPError` carrying the status code and body.

Imports `HTTPRequest` from the `webhook` module.

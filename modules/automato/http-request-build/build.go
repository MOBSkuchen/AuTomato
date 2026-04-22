package httprequestbuild

import "automato.local/automato/webhook"

func Build(url, method, body string) webhook.HTTPRequest {
	return webhook.HTTPRequest{Url: url, Method: method, Body: body}
}

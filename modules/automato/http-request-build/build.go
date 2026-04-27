package httprequestbuild

import "automato.local/automato/webhook"

//automato-infer:category=pure
//automato-infer:description=Construct an HTTPRequest.
//automato-infer:output=0:request
func Build(url, method, body string) webhook.HTTPRequest {
	return webhook.HTTPRequest{Url: url, Method: method, Body: body}
}

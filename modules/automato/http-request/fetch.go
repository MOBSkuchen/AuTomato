package httprequest

import (
	"io"
	"net/http"
	"strings"
	"time"

	"automato.local/automato/webhook"
)

type HTTPError struct {
	Code    int64
	Message string
}

func (e HTTPError) Error() string { return e.Message }

//automato-infer:category=action
//automato-infer:description=Perform an HTTP request and return the response body + status.
//automato-infer:tweak=timeoutMS
//automato-infer:tweak_desc=timeoutMS:Per-request timeout in milliseconds.
//automato-infer:tweak_default=timeoutMS:30000
//automato-infer:tweak=userAgent
//automato-infer:tweak_desc=userAgent:User-Agent header value.
//automato-infer:tweak_default=userAgent:AuTomato/0.2
//automato-infer:tweak=followRedirects
//automato-infer:tweak_desc=followRedirects:Whether to follow 3xx redirects automatically.
//automato-infer:tweak_default=followRedirects:true
//automato-infer:rename=req:request
//automato-infer:consumed=req
//automato-infer:output=0:body
//automato-infer:output=1:status
//automato-infer:error=2
//automato-infer:error_type=custom/HTTPError
func Fetch(timeoutMS int64, userAgent string, followRedirects bool, req webhook.HTTPRequest) (string, int64, error) {
	method := req.Method
	if method == "" {
		method = "GET"
	}
	httpReq, err := http.NewRequest(method, req.Url, strings.NewReader(req.Body))
	if err != nil {
		return "", 0, HTTPError{Code: 0, Message: err.Error()}
	}
	if userAgent != "" {
		httpReq.Header.Set("User-Agent", userAgent)
	}
	client := &http.Client{Timeout: time.Duration(timeoutMS) * time.Millisecond}
	if !followRedirects {
		client.CheckRedirect = func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", 0, HTTPError{Code: 0, Message: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return "", int64(resp.StatusCode), HTTPError{Code: int64(resp.StatusCode), Message: string(body)}
	}
	return string(body), int64(resp.StatusCode), nil
}

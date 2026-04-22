package httprequest

import (
	"io"
	"net/http"
	"strings"

	"automato.local/automato/webhook"
)

type HTTPError struct {
	Code    int64
	Message string
}

func (e HTTPError) Error() string { return e.Message }

func Fetch(req webhook.HTTPRequest) (string, int64, error) {
	method := req.Method
	if method == "" {
		method = "GET"
	}
	httpReq, err := http.NewRequest(method, req.Url, strings.NewReader(req.Body))
	if err != nil {
		return "", 0, HTTPError{Code: 0, Message: err.Error()}
	}
	resp, err := http.DefaultClient.Do(httpReq)
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

package webhook

import (
	"io"
	"net/http"
	"strings"
)

type HTTPDispatch struct {
	address string
	mux     *http.ServeMux
}

func NewHTTPDispatch(address string) *HTTPDispatch {
	return &HTTPDispatch{address: address, mux: http.NewServeMux()}
}

func (d *HTTPDispatch) Register(path string, method HTTPMethod, handler func(HTTPRequest, HTTPRequestContext)) {
	d.mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if method != HTTPMethodANY && string(method) != r.Method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		ctx := HTTPRequestContext{w: w, done: make(chan struct{}, 1)}
		handler(HTTPRequest{Url: r.URL.String(), Method: r.Method, Body: string(body), Headers: HeaderToMap(r.Header)}, ctx)
		select {
		case <-ctx.done:
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
}

func (d *HTTPDispatch) Run() {
	_ = http.ListenAndServe(d.address, d.mux)
}

type HTTPRequest struct {
	Url     string
	Method  string
	Body    string
	Headers map[string]string
}

type HTTPMethod string

const (
	HTTPMethodGET    HTTPMethod = "GET"
	HTTPMethodPOST   HTTPMethod = "POST"
	HTTPMethodPUT    HTTPMethod = "PUT"
	HTTPMethodDELETE HTTPMethod = "DELETE"
	HTTPMethodPATCH  HTTPMethod = "PATCH"
	HTTPMethodANY    HTTPMethod = "ANY"
)

func (m HTTPMethod) String() string { return string(m) }

// HTTPRequestContext carries the ResponseWriter and a completion signal so a
// downstream return component can write the response.
type HTTPRequestContext struct {
	w    http.ResponseWriter
	done chan struct{}
}

func HeaderToMap(h http.Header) map[string]string {
	result := make(map[string]string)
	for k, v := range h {
		result[k] = strings.Join(v, ", ")
	}
	return result
}

func OnRequest(address string, path string, method HTTPMethod, handler func(HTTPRequest, HTTPRequestContext)) {
	mux := http.NewServeMux()
	mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		if method != HTTPMethodANY && string(method) != r.Method {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		ctx := HTTPRequestContext{w: w, done: make(chan struct{}, 1)}
		handler(HTTPRequest{Url: r.URL.String(), Method: r.Method, Body: string(body), Headers: HeaderToMap(r.Header)}, ctx)
		select {
		case <-ctx.done:
		default:
			// no return fired: default 204
			w.WriteHeader(http.StatusNoContent)
		}
	})
	_ = http.ListenAndServe(address, mux)
}

func Respond(contentType string, ctx HTTPRequestContext, status int64, body string) {
	if ctx.w == nil {
		return
	}
	ctx.w.Header().Set("Content-Type", contentType)
	ctx.w.WriteHeader(int(status))
	_, _ = io.WriteString(ctx.w, body)
	select {
	case ctx.done <- struct{}{}:
	default:
	}
}

func RespondJSON(ctx HTTPRequestContext, status int64, body string) {
	Respond("application/json; charset=utf-8", ctx, status, body)
}

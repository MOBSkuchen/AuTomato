package webhook

import (
	"io"
	"net/http"
	"strings"
)

type HTTPRequest struct {
	Url     string
	Method  HTTPMethod
	Body    string
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

//automato-infer:sealed
type HTTPRequestContext struct {
	w    http.ResponseWriter
	done chan struct{}
}

//automato-infer:sealed
type HTTPDispatch struct {
	address string
	mux     *http.ServeMux
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
		handler(HTTPRequest{Url: r.URL.String(), Method: HTTPMethod(r.Method), Body: string(body)}, ctx)
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

func HeaderToMap(h http.Header) map[string]string {
	result := make(map[string]string)
	for k, v := range h {
		result[k] = strings.Join(v, ", ")
	}
	return result
}

//automato-infer:category=trigger
//automato-infer:trigger_style=callback
//automato-infer:dispatch_mode=none
//automato-infer:description=Standalone HTTP trigger. Starts its own server on the configured address. Use http_dispatch + on_route if you need multiple routes.
//automato-infer:tweak=address
//automato-infer:tweak_desc=address:Host:port the server binds to.
//automato-infer:tweak_default=address::8080
//automato-infer:tweak=path
//automato-infer:tweak_desc=path:URL path to register the handler on.
//automato-infer:tweak_default=path:/
//automato-infer:tweak=method
//automato-infer:tweak_desc=method:Accepted HTTP method (ANY matches all methods).
//automato-infer:tweak_default=method:ANY
//automato-infer:skip_input=handler
//automato-infer:emit_output=request:custom/HTTPRequest
//automato-infer:emit_output=ctx:custom/HTTPRequestContext
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
		handler(HTTPRequest{Url: r.URL.String(), Method: HTTPMethod(r.Method), Body: string(body)}, ctx)
		select {
		case <-ctx.done:
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	})
	_ = http.ListenAndServe(address, mux)
}

//automato-infer:category=trigger
//automato-infer:trigger_style=callback
//automato-infer:dispatch_mode=required
//automato-infer:dispatch_input=dispatch
//automato-infer:no_impl
//automato-infer:description=Handles HTTP requests matching a specific path and method. Wire its `dispatch` input to an http_dispatch node.
//automato-infer:tweak=path
//automato-infer:tweak_desc=path:URL path pattern to register (e.g. /api/users).
//automato-infer:tweak_default=path:/
//automato-infer:tweak=method
//automato-infer:tweak_desc=method:Accepted HTTP method.
//automato-infer:tweak_default=method:ANY
//automato-infer:consumed=dispatch
//automato-infer:emit_output=request:custom/HTTPRequest
//automato-infer:emit_output=ctx:custom/HTTPRequestContext
func OnRoute(dispatch *HTTPDispatch, path string, method HTTPMethod) {
	_ = dispatch
	_ = path
	_ = method
}

//automato-infer:category=dispatch
//automato-infer:component=http_dispatch
//automato-infer:description=Creates an HTTP server and dispatches incoming requests to registered route handlers. Wire its `dispatch` output into one or more on_route triggers, then wire exec into it from your origin/trigger.
//automato-infer:consumed=address
//automato-infer:output=0:dispatch
//automato-infer:dispatch_type=custom/HTTPDispatch
//automato-infer:run_method=Run
//automato-infer:register_method=on_route:Register
func NewHTTPDispatch(address string) *HTTPDispatch {
	return &HTTPDispatch{address: address, mux: http.NewServeMux()}
}

//automato-infer:category=return
//automato-infer:description=Writes an HTTP response for the given request context, then ends the workflow.
//automato-infer:tweak=contentType
//automato-infer:tweak_desc=contentType:Content-Type header value.
//automato-infer:tweak_default=contentType:text/plain; charset=utf-8
//automato-infer:consumed=ctx
//automato-infer:consumed=body
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

//automato-infer:category=return
//automato-infer:description=Writes a JSON body with Content-Type application/json and ends the workflow.
//automato-infer:consumed=ctx
//automato-infer:consumed=body
func RespondJSON(ctx HTTPRequestContext, status int64, body string) {
	Respond("application/json; charset=utf-8", ctx, status, body)
}

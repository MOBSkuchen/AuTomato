package webhook

import (
	"io"
	"net/http"
	"os"
)

type HTTPRequest struct {
	Url    string
	Method string
	Body   string
}

func OnRequest(handler func(HTTPRequest)) {
	addr := os.Getenv("WEBHOOK_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		handler(HTTPRequest{Url: r.URL.String(), Method: r.Method, Body: string(body)})
		w.WriteHeader(http.StatusOK)
	})
	_ = http.ListenAndServe(addr, mux)
}

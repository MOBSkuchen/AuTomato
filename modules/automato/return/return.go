package ret

import "fmt"

//automato-infer:category=return
//automato-infer:description=Return an HTTP response to the caller.
//automato-infer:consumed=body
func HttpResponse(status int64, body string) {
	fmt.Printf("[return.http_response] status=%d body=%s\n", status, body)
}

//automato-infer:category=return
//automato-infer:description=Terminate the workflow without a return payload.
func Ok() {
	fmt.Println("[return.ok]")
}

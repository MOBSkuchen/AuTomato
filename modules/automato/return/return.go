package ret

import "fmt"

func HttpResponse(status int64, body string) {
	fmt.Printf("[return.http_response] status=%d body=%s\n", status, body)
}

func Ok() {
	fmt.Println("[return.ok]")
}

package gmail

import (
	"errors"
	"fmt"
)

type Email struct {
	Subject string
	Sender  string
	Body    string
}

func Send(email Email) (string, error) {
	if email.Sender == "" {
		return "", errors.New("missing sender")
	}
	fmt.Printf("[gmail.send] from=%s subject=%s\n", email.Sender, email.Subject)
	return "msg-stub", nil
}

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

// GmailClient is an opaque handle obtained from Connect. Its internals are
// deliberately unexported so the workflow editor treats it as a sealed type.
type GmailClient struct {
	credentialsPath string
	fromAddress     string
}

func Connect(credentialsPath string, fromAddress string) GmailClient {
	return GmailClient{credentialsPath: credentialsPath, fromAddress: fromAddress}
}

func Send(client GmailClient, email Email) (string, error) {
	sender := email.Sender
	if sender == "" {
		sender = client.fromAddress
	}
	if sender == "" {
		return "", errors.New("missing sender and no default from_address configured")
	}
	fmt.Printf("[gmail.send] creds=%s from=%s subject=%s\n", client.credentialsPath, sender, email.Subject)
	return "msg-stub", nil
}

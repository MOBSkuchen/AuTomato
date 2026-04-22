package logmod

import (
	"fmt"
	"time"
)

func Info(message string) {
	fmt.Printf("[%s] %s\n", time.Now().UTC().Format(time.RFC3339), message)
}

package logmod

import (
	"fmt"
	"time"
)

type LogLevel string

const (
	LogLevelDEBUG LogLevel = "DEBUG"
	LogLevelINFO  LogLevel = "INFO"
	LogLevelWARN  LogLevel = "WARN"
	LogLevelERROR LogLevel = "ERROR"
)

func (l LogLevel) String() string { return string(l) }

func Log(level LogLevel, prefix string, message string) {
	ts := time.Now().UTC().Format(time.RFC3339)
	if prefix != "" {
		fmt.Printf("[%s] [%s] %s %s\n", ts, level, prefix, message)
	} else {
		fmt.Printf("[%s] [%s] %s\n", ts, level, message)
	}
}

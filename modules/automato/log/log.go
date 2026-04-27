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

//automato-infer:category=action
//automato-infer:description=Log a message at the configured level.
//automato-infer:tweak=level
//automato-infer:tweak_desc=level:Severity of the log entry.
//automato-infer:tweak_default=level:INFO
//automato-infer:tweak=prefix
//automato-infer:tweak_desc=prefix:Prefix prepended to every message.
//automato-infer:tweak_default=prefix:
//automato-infer:passthrough=message
func Log(level LogLevel, prefix string, message string) {
	ts := time.Now().UTC().Format(time.RFC3339)
	if prefix != "" {
		fmt.Printf("[%s] [%s] %s %s\n", ts, level, prefix, message)
	} else {
		fmt.Printf("[%s] [%s] %s\n", ts, level, message)
	}
}

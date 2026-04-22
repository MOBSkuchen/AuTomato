package cron

import (
	"os"
	"time"
)

func OnTick() (string, bool) {
	interval := time.Second
	if v := os.Getenv("CRON_INTERVAL_MS"); v != "" {
		if d, err := time.ParseDuration(v + "ms"); err == nil {
			interval = d
		}
	}
	time.Sleep(interval)
	return time.Now().UTC().Format(time.RFC3339), true
}

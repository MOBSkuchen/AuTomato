package cron

import "time"

type CronUnit string

const (
	CronUnitMs CronUnit = "ms"
	CronUnitS  CronUnit = "s"
	CronUnitM  CronUnit = "m"
	CronUnitH  CronUnit = "h"
)

func (u CronUnit) String() string { return string(u) }

func OnTick(interval int64, unit CronUnit) (string, bool) {
	d := time.Second
	switch unit {
	case CronUnitMs:
		d = time.Millisecond
	case CronUnitS:
		d = time.Second
	case CronUnitM:
		d = time.Minute
	case CronUnitH:
		d = time.Hour
	}
	if interval <= 0 {
		interval = 1
	}
	time.Sleep(d * time.Duration(interval))
	return time.Now().UTC().Format(time.RFC3339), true
}

// Package cron provides HTTP trigger and dispatch components
// for the AuTomato workflow engine.
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

//automato-infer:category=trigger
//automato-infer:trigger_style=polling
//automato-infer:dispatch_mode=none
//automato-infer:description=Fires at each scheduled tick; emits an RFC3339 timestamp.
//automato-infer:tweak=interval
//automato-infer:tweak_desc=interval:Interval value (combined with unit).
//automato-infer:tweak_default=interval:1
//automato-infer:tweak=unit
//automato-infer:tweak_desc=unit:Time unit for the interval.
//automato-infer:tweak_default=unit:s
//automato-infer:output=0:fired_at
//automato-infer:output_skip=1
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

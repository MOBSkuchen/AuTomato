package strops

import "strconv"

func Concat(a, b string) string {
	return a + b
}

func FromInt(n int64) string {
	return strconv.FormatInt(n, 10)
}

package strops

import "strconv"

//automato-infer:category=pure
//automato-infer:description=Concatenate two strings.
//automato-infer:output=0:out
func Concat(a, b string) string {
	return a + b
}

//automato-infer:category=pure
//automato-infer:description=Format an int as a decimal string.
//automato-infer:output=0:out
func FromInt(n int64) string {
	return strconv.FormatInt(n, 10)
}

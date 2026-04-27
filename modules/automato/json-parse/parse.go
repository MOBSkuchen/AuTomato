package jsonparse

import (
	"encoding/json"
	"fmt"
)

type JSONParseError struct {
	Message string
}

func (e JSONParseError) Error() string { return e.Message }

//automato-infer:category=pure
//automato-infer:description=Parse a JSON string. Non-string leaves are stringified.
//automato-infer:passthrough=input
//automato-infer:output=0:value
//automato-infer:error=1
//automato-infer:error_type=custom/JSONParseError
func Parse(input string) (map[string]string, error) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(input), &raw); err != nil {
		return nil, JSONParseError{Message: err.Error()}
	}
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		out[k] = fmt.Sprintf("%v", v)
	}
	return out, nil
}

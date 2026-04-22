package jsonparse

import (
	"encoding/json"
	"fmt"
)

type JSONParseError struct {
	Message string
}

func (e JSONParseError) Error() string { return e.Message }

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

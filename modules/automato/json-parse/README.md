# json-parse

`parse(input: string) -> value: dict<string> | JSONParseError`. Pure component. Non-string leaves are stringified via `fmt.Sprintf("%v", v)`. The `input` port is `passthrough` for builder-style chaining.

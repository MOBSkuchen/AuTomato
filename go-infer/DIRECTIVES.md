# go-infer directives

`go-infer` parses an annotated Go source file and emits the matching
`definitions.json`. AST inference is the default; **directive comments override
whatever the AST would otherwise infer**.

A directive is a comment line of the form

```
//automato-infer:KEY
//automato-infer:KEY=VALUE
```

A leading space after `//` is allowed (`// automato-infer:KEY` works too).
Multiple directives stack; each must be on its own comment line. Directives can
appear in:

- A doc comment (the comment block immediately preceding a declaration).
- A line-end comment (`field T //automato-infer:string`) — only field-level
  directives use this form.

If a directive is irrelevant to the declaration it sits on, it is silently
ignored.

---

## Type-level directives (on `type X ...`)

Apply to a `type` declaration. Must be in the doc comment.

| Directive | Effect |
| --- | --- |
| `ignore` | Skip this type entirely. |
| `sealed` | Mark a struct as `"sealed": true` and emit no fields (intended for opaque runtime types like server handles). |
| `enum` | Force enum kind. Rarely needed — any non-struct named type is treated as an enum stub by default. |
| `rename=<name>` | Rename the type in the output JSON. |
| Type-spec flag (e.g. `string`, `int`, `array/string`, `dict/custom/Foo`) | Currently only meaningful on **fields**, not on types themselves. |

Example:

```go
//automato-infer:sealed
type HTTPDispatch struct {
    address string
    mux     *http.ServeMux
}
```

→

```json
{ "name": "HTTPDispatch", "kind": "struct", "sealed": true, "fields": [] }
```

---

## Field-level directives (on a struct field)

Apply per struct field. Field directives can be in either a leading doc comment
or a trailing line comment.

| Directive | Effect |
| --- | --- |
| `ignore` | Skip the field. |
| `rename=<name>` | Override the JSON field name (default: snake_case of the Go name). |
| Type-spec (`string` / `int` / `bool` / `float` / `any` / `array/<spec>` / `dict/<spec>` / `custom/<Name>`) | Override the inferred field type. |

Example:

```go
type HTTPRequest struct {
    Url     string
    Method  HTTPMethod //automato-infer:string
    Body    string
    Headers map[string]string
}
```

The `Method` field is downgraded from `custom/HTTPMethod` to `string`.

Unexported fields are always skipped.

---

## Enum variants (on `const ( ... )` blocks)

A `type X string` (or any named non-struct type) is registered as an enum. Its
variants come from `const` declarations whose declared type is that enum.

By default, the **literal const value** is used as the variant name and forced
into UPPERCASE (e.g. `HTTPMethodGet HTTPMethod = "get"` → `"GET"`).

| Directive | Effect |
| --- | --- |
| `ignore` (on a const spec) | Skip that const. |
| `variant=<NAME>` (on a const spec) | Override the emitted variant name. The override is still uppercased. |

If you need lowercase variants, change the const value in source to lowercase
and accept the uppercase output, or use `variant=` and post-process.

Example:

```go
type LogLevel string

const (
    LogLevelDEBUG LogLevel = "DEBUG"
    LogLevelINFO  LogLevel = "INFO"
    LogLevelWARN  LogLevel = "WARN"
    LogLevelERROR LogLevel = "ERROR"
)
```

→

```json
{ "name": "LogLevel", "kind": "enum", "variants": ["DEBUG", "INFO", "WARN", "ERROR"] }
```

---

## Component directives (on a top-level func)

Apply to a top-level (non-method) exported function. **A function is only
emitted as a component if it has `category=` set.** Methods (functions with a
receiver) and unexported functions are always skipped.

### Required

| Directive | Effect |
| --- | --- |
| `category=<value>` | One of `trigger`, `action`, `pure`, `return`, `dispatch`, `logic`, `origin`. Required for emission. |

### Component metadata

| Directive | Effect |
| --- | --- |
| `component=<name>` | Override the component name (default: snake_case of the Go func name). |
| `description=<text>` | Override the description. If absent, the doc comment is used (with the func name and trailing `:`/`-` stripped). |
| `trigger_style=<value>` | Free-form trigger style tag (e.g. `polling`, `callback`). |
| `dispatch_mode=<value>` | One of `none`, `required`, `either`. Sub-trigger requirement. |
| `dispatch_input=<name>` | Sets `dispatch_input_name` on the emitted JSON. The matching input port must exist. |
| `dispatch_type=<typespec>` | For `dispatch` components: the type of the dispatcher value. |
| `run_method=<MethodName>` | For `dispatch` components: the method on the dispatch type that runs the server. |
| `register_method=<sub_trigger_name>:<MethodName>` | For `dispatch` components: maps a sub-trigger component name to the registration method on the dispatch type. May appear multiple times. |
| `no_impl` | Suppress the `impl` field. Used for placeholder funcs whose component has no real Go implementation (e.g. `on_route`). |

### Per-parameter directives

Each refers to a Go parameter by its **Go identifier** (not the snake-cased
output name).

| Directive | Effect |
| --- | --- |
| `tweak=<param>` | Mark a parameter as a tweak (a config-time constant) instead of a runtime input. |
| `tweak_default=<param>:<value>` | Set the tweak's default. Parsed as `int`/`float`/`bool` if the type allows, else as a literal string. Empty values are preserved (`tweak_default=prefix:` → `"default": ""`). |
| `tweak_desc=<param>:<text>` | Tweak description. Colons in the text are fine — only the first `:` is the separator. |
| `consumed=<param>` | Mark the input port as `"consumption": "consumed"` (single-source, no fan-out). |
| `passthrough=<param>` | Mark the input port as `"consumption": "passthrough"` (auto-emits a matching `<name>__pt` data output). |
| `rename=<param>:<name>` | Override the JSON port name (default: snake_case of the Go name). |
| `input_type=<param>:<typespec>` | Override the inferred port type. |
| `skip_input=<param>` | Drop the parameter entirely (used for callback-handler args that have no port representation). |

### Per-output directives

Outputs are addressed by **0-based positional index** of the function's return
list (counting each name in a multi-name return as a separate index).

| Directive | Effect |
| --- | --- |
| `output=<idx>:<name>` | Override the JSON name of output #idx. Default: snake_case of the Go return name, or `out_<idx>` if unnamed. |
| `output_type=<idx>:<typespec>` | Override the inferred output type. |
| `output_skip=<idx>` | Drop output #idx (e.g. an unused secondary boolean). |
| `error=<idx>` | Mark output #idx as the component's error output. It does not appear in `outputs[]`; it sets `error_type` instead. |
| `error_type=<typespec>` | Override the type of the error output. Useful when the Go type is the bare `error` interface but you want a custom error struct. |
| `emit_output=<name>:<typespec>` | Append a synthetic output port. Used when outputs come from somewhere other than the function's return values (e.g. a callback's arguments). May appear multiple times. |

### Skipping

| Directive | Effect |
| --- | --- |
| `ignore` | Skip the function entirely (no component emitted). |

---

## Type-spec mini-syntax

Used by `input_type`, `output_type`, `error_type`, `emit_output`,
`dispatch_type`, and field-level type overrides:

```
int  string  bool  float  any
array/<spec>            # e.g. array/int
dict/<spec>             # value type only; keys are always string. e.g. dict/string
custom/<Name>           # custom type by name. e.g. custom/HTTPRequest
```

Specs nest: `array/dict/custom/Foo` is `[][string]Foo`.

---

## Snake-case conversion

When a Go identifier becomes a JSON name (default port/field/component name),
it is converted from CamelCase / mixedCase / SCREAMING to snake_case:

| Go | JSON |
| --- | --- |
| `Concat` | `concat` |
| `FromInt` | `from_int` |
| `OnTick` | `on_tick` |
| `RespondJSON` | `respond_json` |
| `timeoutMS` | `timeout_ms` |
| `userAgent` | `user_agent` |
| `HttpResponse` | `http_response` |

All-uppercase runs are kept together unless followed by a lowercase rune
(`HTTPRequest` → `http_request`, `RespondJSON` → `respond_json`).

---

## Worked example: a callback-style trigger

`OnRequest` blocks on a callback whose arguments become the trigger's outputs.
The handler parameter has no port, and the function returns nothing.

```go
//automato-infer:category=trigger
//automato-infer:trigger_style=callback
//automato-infer:dispatch_mode=none
//automato-infer:description=Standalone HTTP trigger.
//automato-infer:tweak=address
//automato-infer:tweak_default=address::8080
//automato-infer:tweak=path
//automato-infer:tweak_default=path:/
//automato-infer:tweak=method
//automato-infer:tweak_default=method:ANY
//automato-infer:skip_input=handler
//automato-infer:emit_output=request:custom/HTTPRequest
//automato-infer:emit_output=ctx:custom/HTTPRequestContext
func OnRequest(address, path string, method HTTPMethod,
               handler func(HTTPRequest, HTTPRequestContext)) { ... }
```

Resulting component:

- 3 tweaks (`address`, `path`, `method`) from the first three params.
- `inputs: []` because the only remaining param (`handler`) is `skip_input`.
- 2 outputs (`request`, `ctx`) from the `emit_output` directives.
- `impl: "OnRequest"` from the function name.

---

## Worked example: a virtual sub-trigger

`on_route` is a virtual component — there's no real Go function backing it,
but we still need its metadata in the JSON. Use a placeholder function plus
`no_impl` to suppress the `impl` field:

```go
//automato-infer:category=trigger
//automato-infer:trigger_style=callback
//automato-infer:dispatch_mode=required
//automato-infer:dispatch_input=dispatch
//automato-infer:no_impl
//automato-infer:tweak=path
//automato-infer:tweak_default=path:/
//automato-infer:tweak=method
//automato-infer:tweak_default=method:ANY
//automato-infer:consumed=dispatch
//automato-infer:emit_output=request:custom/HTTPRequest
//automato-infer:emit_output=ctx:custom/HTTPRequestContext
func OnRoute(dispatch *HTTPDispatch, path string, method HTTPMethod) {
    _, _, _ = dispatch, path, method
}
```

---

## Worked example: a dispatcher

```go
//automato-infer:category=dispatch
//automato-infer:component=http_dispatch
//automato-infer:consumed=address
//automato-infer:output=0:dispatch
//automato-infer:dispatch_type=custom/HTTPDispatch
//automato-infer:run_method=Run
//automato-infer:register_method=on_route:Register
func NewHTTPDispatch(address string) *HTTPDispatch { ... }
```

`run_method` and `register_method` refer to methods on the dispatcher's
receiver type. The compiler uses them to drive the dispatcher (`d.Run()`) and
to wire sub-triggers (`d.Register(path, method, handler)`).

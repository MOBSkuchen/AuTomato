package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"strings"
	"unicode"
)

type TypeSpec struct {
	Kind  string    `json:"kind"`
	Of    *TypeSpec `json:"of,omitempty"`
	Value *TypeSpec `json:"value,omitempty"`
	Name  string    `json:"name,omitempty"`
}

type Field struct {
	Name string   `json:"name"`
	Type TypeSpec `json:"type"`
}

type CustomType struct {
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`
	Sealed   bool     `json:"sealed,omitempty"`
	Fields   *[]Field `json:"fields,omitempty"`
	Variants []string `json:"variants,omitempty"`
}

type Tweak struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Type        TypeSpec        `json:"type"`
	Default     json.RawMessage `json:"default,omitempty"`
}

type Port struct {
	Name        string   `json:"name"`
	Type        TypeSpec `json:"type"`
	Consumption string   `json:"consumption,omitempty"`
}

type Component struct {
	Name              string            `json:"name"`
	Category          string            `json:"category"`
	TriggerStyle      string            `json:"trigger_style,omitempty"`
	DispatchMode      string            `json:"dispatch_mode,omitempty"`
	DispatchInputName string            `json:"dispatch_input_name,omitempty"`
	Description       string            `json:"description,omitempty"`
	Tweaks            []Tweak           `json:"tweaks,omitempty"`
	Inputs            []Port            `json:"inputs"`
	Outputs           []Port            `json:"outputs"`
	ErrorType         *TypeSpec         `json:"error_type,omitempty"`
	Impl              string            `json:"impl,omitempty"`
	DispatchType      *TypeSpec         `json:"dispatch_type,omitempty"`
	RunMethod         string            `json:"run_method,omitempty"`
	RegisterMethods   map[string]string `json:"register_methods,omitempty"`
}

type Definitions struct {
	Types      []CustomType `json:"types"`
	Components []Component  `json:"components"`
}

type directive struct {
	Key string
	Val string
}

func parseDirectives(doc *ast.CommentGroup) []directive {
	if doc == nil {
		return nil
	}
	var out []directive
	for _, c := range doc.List {
		body := c.Text
		if strings.HasPrefix(body, "//") {
			body = body[2:]
		} else if strings.HasPrefix(body, "/*") {
			body = strings.TrimSuffix(body[2:], "*/")
		}
		body = strings.TrimSpace(body)
		if !strings.HasPrefix(body, "automato-infer:") {
			continue
		}
		body = strings.TrimSpace(strings.TrimPrefix(body, "automato-infer:"))
		if i := strings.Index(body, "="); i >= 0 {
			out = append(out, directive{
				Key: strings.TrimSpace(body[:i]),
				Val: strings.TrimSpace(body[i+1:]),
			})
		} else {
			out = append(out, directive{Key: body})
		}
	}
	return out
}

func dirHasFlag(ds []directive, key string) bool {
	for _, d := range ds {
		if d.Key == key && d.Val == "" {
			return true
		}
	}
	return false
}

func dirGet(ds []directive, key string) (string, bool) {
	for _, d := range ds {
		if d.Key == key {
			return d.Val, true
		}
	}
	return "", false
}

func dirAll(ds []directive, key string) []string {
	var out []string
	for _, d := range ds {
		if d.Key == key {
			out = append(out, d.Val)
		}
	}
	return out
}

func dirFieldVal(ds []directive, key, target string) (string, bool) {
	for _, d := range ds {
		if d.Key != key {
			continue
		}
		if i := strings.Index(d.Val, ":"); i >= 0 && d.Val[:i] == target {
			return d.Val[i+1:], true
		}
	}
	return "", false
}

func dirHasFieldFlag(ds []directive, key, target string) bool {
	for _, d := range ds {
		if d.Key == key && d.Val == target {
			return true
		}
	}
	return false
}

func parseTypeSpec(s string) *TypeSpec {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	switch s {
	case "int", "string", "bool", "float", "any":
		return &TypeSpec{Kind: s}
	}
	if i := strings.Index(s, "/"); i >= 0 {
		head, rest := s[:i], s[i+1:]
		switch head {
		case "array":
			sub := parseTypeSpec(rest)
			if sub == nil {
				return nil
			}
			return &TypeSpec{Kind: "array", Of: sub}
		case "dict":
			sub := parseTypeSpec(rest)
			if sub == nil {
				return nil
			}
			return &TypeSpec{Kind: "dict", Value: sub}
		case "custom":
			return &TypeSpec{Kind: "custom", Name: rest}
		}
	}
	return nil
}

func findTypeOverride(ds []directive) *TypeSpec {
	for _, d := range ds {
		if d.Val != "" {
			continue
		}
		switch d.Key {
		case "ignore", "sealed", "enum":
			continue
		}
		if t := parseTypeSpec(d.Key); t != nil {
			return t
		}
	}
	return nil
}

func inferType(e ast.Expr) *TypeSpec {
	switch t := e.(type) {
	case *ast.Ident:
		switch t.Name {
		case "int", "int8", "int16", "int32", "int64",
			"uint", "uint8", "uint16", "uint32", "uint64",
			"byte", "rune", "uintptr":
			return &TypeSpec{Kind: "int"}
		case "float32", "float64":
			return &TypeSpec{Kind: "float"}
		case "string":
			return &TypeSpec{Kind: "string"}
		case "bool":
			return &TypeSpec{Kind: "bool"}
		case "any":
			return &TypeSpec{Kind: "any"}
		}
		return &TypeSpec{Kind: "custom", Name: t.Name}
	case *ast.MapType:
		return &TypeSpec{Kind: "dict", Value: inferType(t.Value)}
	case *ast.ArrayType:
		return &TypeSpec{Kind: "array", Of: inferType(t.Elt)}
	case *ast.StarExpr:
		return inferType(t.X)
	case *ast.SelectorExpr:
		return &TypeSpec{Kind: "custom", Name: t.Sel.Name}
	case *ast.InterfaceType:
		return &TypeSpec{Kind: "any"}
	}
	return &TypeSpec{Kind: "any"}
}

func snakeCase(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	var out []rune
	for i, r := range runes {
		if unicode.IsUpper(r) {
			if i > 0 {
				prev := runes[i-1]
				var next rune
				if i+1 < len(runes) {
					next = runes[i+1]
				}
				if unicode.IsLower(prev) || unicode.IsDigit(prev) ||
					(unicode.IsUpper(prev) && unicode.IsLower(next)) {
					out = append(out, '_')
				}
			}
			out = append(out, unicode.ToLower(r))
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}

func parseDefault(s string, typ *TypeSpec) interface{} {
	if typ != nil {
		switch typ.Kind {
		case "int":
			if i, err := strconv.ParseInt(s, 10, 64); err == nil {
				return i
			}
		case "float":
			if f, err := strconv.ParseFloat(s, 64); err == nil {
				return f
			}
		case "bool":
			if b, err := strconv.ParseBool(s); err == nil {
				return b
			}
		}
	}
	return s
}

func extractDocText(doc *ast.CommentGroup, funcName string) string {
	if doc == nil {
		return ""
	}
	var lines []string
	for _, c := range doc.List {
		body := c.Text
		if strings.HasPrefix(body, "//") {
			body = body[2:]
		} else if strings.HasPrefix(body, "/*") {
			body = strings.TrimSuffix(body[2:], "*/")
		}
		body = strings.TrimSpace(body)
		if strings.HasPrefix(body, "automato-infer:") {
			continue
		}
		if body != "" {
			lines = append(lines, body)
		}
	}
	text := strings.TrimSpace(strings.Join(lines, " "))
	if strings.HasPrefix(text, funcName) {
		rest := strings.TrimSpace(strings.TrimPrefix(text, funcName))
		rest = strings.TrimLeft(rest, " :-—–")
		text = strings.TrimSpace(rest)
	}
	return text
}

func buildStruct(ts *ast.TypeSpec, st *ast.StructType, ds []directive) CustomType {
	name := ts.Name.Name
	if v, ok := dirGet(ds, "rename"); ok && v != "" {
		name = v
	}
	sealed := dirHasFlag(ds, "sealed")
	fields := []Field{}
	if !sealed && st.Fields != nil {
		for _, f := range st.Fields.List {
			fds := append(parseDirectives(f.Doc), parseDirectives(f.Comment)...)
			if dirHasFlag(fds, "ignore") {
				continue
			}
			var typ *TypeSpec
			if override := findTypeOverride(fds); override != nil {
				typ = override
			} else {
				typ = inferType(f.Type)
			}
			for _, fname := range f.Names {
				if !fname.IsExported() {
					continue
				}
				jsonName := snakeCase(fname.Name)
				if v, ok := dirGet(fds, "rename"); ok && v != "" {
					jsonName = v
				}
				fields = append(fields, Field{Name: jsonName, Type: *typ})
			}
		}
	}
	ct := CustomType{Name: name, Kind: "struct"}
	if sealed {
		ct.Sealed = true
	}
	ct.Fields = &fields
	return ct
}

func buildEnumStub(ts *ast.TypeSpec, ds []directive) CustomType {
	name := ts.Name.Name
	if v, ok := dirGet(ds, "rename"); ok && v != "" {
		name = v
	}
	return CustomType{Name: name, Kind: "enum", Variants: []string{}}
}

func buildComponent(fd *ast.FuncDecl, ds []directive, cat string) Component {
	name := snakeCase(fd.Name.Name)
	if v, ok := dirGet(ds, "component"); ok && v != "" {
		name = v
	}
	comp := Component{
		Name:     name,
		Category: cat,
		Inputs:   []Port{},
		Outputs:  []Port{},
		Impl:     fd.Name.Name,
	}
	if v, ok := dirGet(ds, "description"); ok {
		comp.Description = v
	} else {
		comp.Description = extractDocText(fd.Doc, fd.Name.Name)
	}
	if v, ok := dirGet(ds, "trigger_style"); ok {
		comp.TriggerStyle = v
	}
	if v, ok := dirGet(ds, "dispatch_mode"); ok {
		comp.DispatchMode = v
	}
	if v, ok := dirGet(ds, "dispatch_input"); ok {
		comp.DispatchInputName = v
	}
	if v, ok := dirGet(ds, "dispatch_type"); ok && v != "" {
		comp.DispatchType = parseTypeSpec(v)
	}
	if v, ok := dirGet(ds, "run_method"); ok {
		comp.RunMethod = v
	}
	for _, raw := range dirAll(ds, "register_method") {
		if i := strings.Index(raw, ":"); i >= 0 {
			if comp.RegisterMethods == nil {
				comp.RegisterMethods = map[string]string{}
			}
			comp.RegisterMethods[strings.TrimSpace(raw[:i])] =
				strings.TrimSpace(raw[i+1:])
		}
	}
	tweakSet := map[string]bool{}
	for _, t := range dirAll(ds, "tweak") {
		tweakSet[t] = true
	}
	skipInputSet := map[string]bool{}
	for _, t := range dirAll(ds, "skip_input") {
		skipInputSet[t] = true
	}
	if fd.Type.Params != nil {
		for _, fl := range fd.Type.Params.List {
			for _, n := range fl.Names {
				paramName := n.Name
				if skipInputSet[paramName] {
					continue
				}
				var typ *TypeSpec
				if override, ok := dirFieldVal(ds, "input_type", paramName); ok {
					if t := parseTypeSpec(override); t != nil {
						typ = t
					}
				}
				if typ == nil {
					typ = inferType(fl.Type)
				}
				jsonName := snakeCase(paramName)
				if v, ok := dirFieldVal(ds, "rename", paramName); ok && v != "" {
					jsonName = v
				}
				if tweakSet[paramName] {
					tw := Tweak{Name: jsonName, Type: *typ}
					if d, ok := dirFieldVal(ds, "tweak_default", paramName); ok {
						if raw, err := json.Marshal(parseDefault(d, typ)); err == nil {
							tw.Default = raw
						}
					}
					if d, ok := dirFieldVal(ds, "tweak_desc", paramName); ok {
						tw.Description = d
					}
					comp.Tweaks = append(comp.Tweaks, tw)
				} else {
					p := Port{Name: jsonName, Type: *typ}
					if dirHasFieldFlag(ds, "consumed", paramName) {
						p.Consumption = "consumed"
					} else if dirHasFieldFlag(ds, "passthrough", paramName) {
						p.Consumption = "passthrough"
					}
					comp.Inputs = append(comp.Inputs, p)
				}
			}
		}
	}
	errorIdx := -1
	if v, ok := dirGet(ds, "error"); ok {
		if i, err := strconv.Atoi(v); err == nil {
			errorIdx = i
		}
	}
	skipOutput := map[int]bool{}
	for _, v := range dirAll(ds, "output_skip") {
		if i, err := strconv.Atoi(v); err == nil {
			skipOutput[i] = true
		}
	}
	idx := 0
	if fd.Type.Results != nil {
		for _, fl := range fd.Type.Results.List {
			n := len(fl.Names)
			if n == 0 {
				n = 1
			}
			for k := 0; k < n; k++ {
				if skipOutput[idx] {
					idx++
					continue
				}
				var typ *TypeSpec
				if override, ok := dirFieldVal(ds, "output_type", strconv.Itoa(idx)); ok {
					if t := parseTypeSpec(override); t != nil {
						typ = t
					}
				}
				if typ == nil {
					typ = inferType(fl.Type)
				}
				if idx == errorIdx {
					if v, ok := dirGet(ds, "error_type"); ok && v != "" {
						if t := parseTypeSpec(v); t != nil {
							typ = t
						}
					}
					comp.ErrorType = typ
					idx++
					continue
				}
				jsonName := ""
				if len(fl.Names) > 0 && k < len(fl.Names) {
					jsonName = snakeCase(fl.Names[k].Name)
				}
				if v, ok := dirFieldVal(ds, "output", strconv.Itoa(idx)); ok && v != "" {
					jsonName = v
				}
				if jsonName == "" {
					jsonName = fmt.Sprintf("out_%d", idx)
				}
				comp.Outputs = append(comp.Outputs, Port{Name: jsonName, Type: *typ})
				idx++
			}
		}
	}
	for _, raw := range dirAll(ds, "emit_output") {
		parts := strings.SplitN(raw, ":", 2)
		if len(parts) < 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		typ := parseTypeSpec(parts[1])
		if typ == nil {
			continue
		}
		comp.Outputs = append(comp.Outputs, Port{Name: name, Type: *typ})
	}
	if dirHasFlag(ds, "no_impl") {
		comp.Impl = ""
	}
	return comp
}

func Infer(path string) (string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, path, nil, parser.ParseComments)
	if err != nil {
		return "", err
	}

	defs := Definitions{
		Types:      []CustomType{},
		Components: []Component{},
	}
	enumIdx := map[string]int{}

	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.TYPE {
			continue
		}
		for _, spec := range gd.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok {
				continue
			}
			doc := ts.Doc
			if doc == nil {
				doc = gd.Doc
			}
			ds := parseDirectives(doc)
			if dirHasFlag(ds, "ignore") {
				continue
			}
			if st, ok := ts.Type.(*ast.StructType); ok {
				defs.Types = append(defs.Types, buildStruct(ts, st, ds))
			} else {
				enumIdx[ts.Name.Name] = len(defs.Types)
				defs.Types = append(defs.Types, buildEnumStub(ts, ds))
			}
		}
	}

	for _, decl := range file.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		for _, spec := range gd.Specs {
			vs, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			doc := vs.Doc
			if doc == nil {
				doc = gd.Doc
			}
			ds := parseDirectives(doc)
			if dirHasFlag(ds, "ignore") {
				continue
			}
			id, ok := vs.Type.(*ast.Ident)
			if !ok {
				continue
			}
			tIdx, ok := enumIdx[id.Name]
			if !ok {
				continue
			}
			for i := range vs.Names {
				if i >= len(vs.Values) {
					continue
				}
				lit, ok := vs.Values[i].(*ast.BasicLit)
				if !ok {
					continue
				}
				val, err := strconv.Unquote(lit.Value)
				if err != nil {
					val = lit.Value
				}
				if v, ok := dirGet(ds, "variant"); ok && v != "" {
					val = v
				}
				defs.Types[tIdx].Variants = append(
					defs.Types[tIdx].Variants,
					strings.ToUpper(val),
				)
			}
		}
	}

	for _, decl := range file.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok {
			continue
		}
		if fd.Recv != nil {
			continue
		}
		if !fd.Name.IsExported() {
			continue
		}
		ds := parseDirectives(fd.Doc)
		if dirHasFlag(ds, "ignore") {
			continue
		}
		cat, ok := dirGet(ds, "category")
		if !ok || cat == "" {
			continue
		}
		defs.Components = append(defs.Components, buildComponent(fd, ds, cat))
	}

	out, err := json.MarshalIndent(defs, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func main() {
	path := "modules/automato/webhook/webhook.go"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	out, err := Infer(path)
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(out)
}

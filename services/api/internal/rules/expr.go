package rules

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// The closed JSON expression language (BACKEND.md §4.2). There is no eval:
// expressions are parsed into a small tree at pack-load time, statically
// checked (known operators, known facts, known params, depth <= maxDepth) and
// interpreted by a pure function. The TS mirror (packages/rules/src/expr.ts)
// implements exactly the same semantics.
//
// Values: nil, bool, int64, string (ISO dates are strings), []any, map[string]any.
// Semantics:
//   - all/any/not treat only `true` as true.
//   - lt/lte/gt/gte/between compare two int64s or two strings (ISO dates);
//     any other pairing (including nil) yields false.
//   - eq/ne compare deeply; nil == nil.
//   - in [x, list] / has [list, x] test membership; a nil list yields false.
//   - ageOn {on, bound}: completed years on date `on`; bound "min" uses the
//     latest plausible birth date (31 Dec for a year-only DOB, EC-01), bound
//     "max" uses the earliest (1 Jan). nil date yields nil.
//   - birthday {age, bound}: the date the age is reached under that bound.
//   - daysBetween [a, b] = b - a in days; addDays [d, n]; addMonths [d, n]
//     (end-of-month clamp). nil operands yield nil.
//   - fact "name" reads the closed Facts set; param {id, path} reads a param
//     row's output.value (by its own ID or the base ID it overrides).

const maxExprDepth = 8

var knownFacts = map[string]bool{
	"asOf": true, "state": true, "dobPrecision": true, "dobLatest": true, "dobEarliest": true,
	"aadhaarAddressMatches": true, "aadhaarRelationLine": true, "aadhaarMobileLinked": true, "homeTestDevice": true,
	"disability": true, "hasDisability": true, "foreignLicence": true, "nri": true, "movingState": true, "holdsDl": true, "lmvDlHeldSince": true,
	"wantsIdp": true, "hasTestVehicle": true, "llIssuedOn": true, "requestedClasses": true, "anyTransport": true, "anyNonTransport": true, "anyForm1aAlways": true, "packPartial": true,
	"llDate": true, "dlTestUnlock": true, "llExpiresOn": true, "earliestLicence": true,
	"class.code": true, "class.minAge": true, "class.transport": true, "class.form1a": true,
}

type exprNode struct {
	op        string // "lit", "list", or an operator name
	lit       any
	args      []*exprNode
	fact      string
	paramID   string
	paramPath string
	bound     string
}

// normalizeJSON converts json.Number to int64 (rejecting non-integers) recursively.
func normalizeJSON(v any) (any, error) {
	switch t := v.(type) {
	case json.Number:
		n, err := strconv.ParseInt(string(t), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("only integer numbers are allowed, got %s", string(t))
		}
		return n, nil
	case float64:
		if t != float64(int64(t)) {
			return nil, fmt.Errorf("only integer numbers are allowed, got %v", t)
		}
		return int64(t), nil
	case int:
		return int64(t), nil
	case []any:
		out := make([]any, len(t))
		for i, e := range t {
			n, err := normalizeJSON(e)
			if err != nil {
				return nil, err
			}
			out[i] = n
		}
		return out, nil
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, e := range t {
			n, err := normalizeJSON(e)
			if err != nil {
				return nil, err
			}
			out[k] = n
		}
		return out, nil
	default:
		return v, nil
	}
}

// parseExpr builds an expression tree from a normalized JSON value.
func parseExpr(v any, depth int) (*exprNode, error) {
	if depth > maxExprDepth {
		return nil, fmt.Errorf("expression deeper than %d", maxExprDepth)
	}
	switch t := v.(type) {
	case nil, bool, int64, string:
		return &exprNode{op: "lit", lit: t}, nil
	case []any:
		n := &exprNode{op: "list"}
		for _, e := range t {
			c, err := parseExpr(e, depth+1)
			if err != nil {
				return nil, err
			}
			n.args = append(n.args, c)
		}
		return n, nil
	case map[string]any:
		if len(t) != 1 {
			return nil, fmt.Errorf("operator object must have exactly one key, got %d", len(t))
		}
		var op string
		var arg any
		for k, a := range t {
			op, arg = k, a
		}
		return parseOp(op, arg, depth)
	default:
		return nil, fmt.Errorf("unsupported expression value %T", v)
	}
}

func parseArgs(op string, arg any, depth, min, max int) ([]*exprNode, error) {
	list, ok := arg.([]any)
	if !ok {
		return nil, fmt.Errorf("%s expects an array", op)
	}
	if len(list) < min || (max >= 0 && len(list) > max) {
		return nil, fmt.Errorf("%s expects %d..%d arguments, got %d", op, min, max, len(list))
	}
	out := make([]*exprNode, 0, len(list))
	for _, e := range list {
		c, err := parseExpr(e, depth+1)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func parseOp(op string, arg any, depth int) (*exprNode, error) {
	n := &exprNode{op: op}
	var err error
	switch op {
	case "all", "any":
		n.args, err = parseArgs(op, arg, depth, 1, -1)
	case "not":
		var c *exprNode
		c, err = parseExpr(arg, depth+1)
		n.args = []*exprNode{c}
	case "eq", "ne", "lt", "lte", "gt", "gte", "in", "has", "daysBetween", "addDays", "addMonths":
		n.args, err = parseArgs(op, arg, depth, 2, 2)
	case "between":
		n.args, err = parseArgs(op, arg, depth, 3, 3)
	case "fact":
		name, ok := arg.(string)
		if !ok || !knownFacts[name] {
			return nil, fmt.Errorf("unknown fact %v", arg)
		}
		n.fact = name
	case "param":
		m, ok := arg.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("param expects an object")
		}
		id, _ := m["id"].(string)
		if id == "" {
			return nil, fmt.Errorf("param needs an id")
		}
		for k := range m {
			if k != "id" && k != "path" {
				return nil, fmt.Errorf("param: unknown key %q", k)
			}
		}
		n.paramID = id
		if p, ok := m["path"]; ok {
			ps, ok := p.(string)
			if !ok || ps == "" {
				return nil, fmt.Errorf("param path must be a string")
			}
			n.paramPath = ps
		}
	case "ageOn", "birthday":
		m, ok := arg.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s expects an object", op)
		}
		key := "on"
		if op == "birthday" {
			key = "age"
		}
		if len(m) != 2 {
			return nil, fmt.Errorf("%s expects keys %s and bound", op, key)
		}
		b, _ := m["bound"].(string)
		if b != "min" && b != "max" {
			return nil, fmt.Errorf("%s bound must be min or max", op)
		}
		inner, ok := m[key]
		if !ok {
			return nil, fmt.Errorf("%s needs %s", op, key)
		}
		var c *exprNode
		c, err = parseExpr(inner, depth+1)
		n.args = []*exprNode{c}
		n.bound = b
	case "const":
		n.op = "lit"
		n.lit = arg
	default:
		return nil, fmt.Errorf("unknown operator %q", op)
	}
	if err != nil {
		return nil, err
	}
	return n, nil
}

// walk visits every node.
func (n *exprNode) walk(f func(*exprNode)) {
	if n == nil {
		return
	}
	f(n)
	for _, c := range n.args {
		c.walk(f)
	}
}

// evalEnv is the read-only environment of one evaluation.
type evalEnv struct {
	facts       map[string]any
	params      map[string]*Rule
	dobLatest   Date
	dobEarliest Date
	used        map[string]bool // effective IDs of params read
}

func truthy(v any) bool { b, ok := v.(bool); return ok && b }

func (e *evalEnv) eval(n *exprNode) any {
	switch n.op {
	case "lit":
		return n.lit
	case "list":
		out := make([]any, len(n.args))
		for i, c := range n.args {
			out[i] = e.eval(c)
		}
		return out
	case "all":
		for _, c := range n.args {
			if !truthy(e.eval(c)) {
				return false
			}
		}
		return true
	case "any":
		for _, c := range n.args {
			if truthy(e.eval(c)) {
				return true
			}
		}
		return false
	case "not":
		return !truthy(e.eval(n.args[0]))
	case "eq":
		return deepEqual(e.eval(n.args[0]), e.eval(n.args[1]))
	case "ne":
		return !deepEqual(e.eval(n.args[0]), e.eval(n.args[1]))
	case "lt", "lte", "gt", "gte":
		c, ok := compare(e.eval(n.args[0]), e.eval(n.args[1]))
		if !ok {
			return false
		}
		switch n.op {
		case "lt":
			return c < 0
		case "lte":
			return c <= 0
		case "gt":
			return c > 0
		default:
			return c >= 0
		}
	case "between":
		x := e.eval(n.args[0])
		lo, ok1 := compare(e.eval(n.args[1]), x)
		hi, ok2 := compare(x, e.eval(n.args[2]))
		return ok1 && ok2 && lo <= 0 && hi <= 0
	case "in":
		return contains(e.eval(n.args[1]), e.eval(n.args[0]))
	case "has":
		return contains(e.eval(n.args[0]), e.eval(n.args[1]))
	case "fact":
		return e.facts[n.fact]
	case "param":
		r := e.params[n.paramID]
		if r == nil {
			return nil
		}
		e.used[r.ID] = true
		v := r.Output["value"]
		if n.paramPath == "" {
			return v
		}
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		return m[n.paramPath]
	case "ageOn":
		d, ok := asDate(e.eval(n.args[0]))
		if !ok {
			return nil
		}
		dob := e.dobLatest
		if n.bound == "max" {
			dob = e.dobEarliest
		}
		return int64(AgeOn(dob, d))
	case "birthday":
		age, ok := e.eval(n.args[0]).(int64)
		if !ok {
			return nil
		}
		dob := e.dobLatest
		if n.bound == "max" {
			dob = e.dobEarliest
		}
		return BirthdayAt(dob, int(age)).String()
	case "daysBetween":
		a, ok1 := asDate(e.eval(n.args[0]))
		b, ok2 := asDate(e.eval(n.args[1]))
		if !ok1 || !ok2 {
			return nil
		}
		return int64(a.DaysUntil(b))
	case "addDays", "addMonths":
		d, ok1 := asDate(e.eval(n.args[0]))
		k, ok2 := e.eval(n.args[1]).(int64)
		if !ok1 || !ok2 {
			return nil
		}
		if n.op == "addDays" {
			return d.AddDays(int(k)).String()
		}
		return d.AddMonths(int(k)).String()
	}
	return nil
}

func asDate(v any) (Date, bool) {
	s, ok := v.(string)
	if !ok {
		return Date{}, false
	}
	d, err := ParseDate(s)
	return d, err == nil
}

func compare(a, b any) (int, bool) {
	switch x := a.(type) {
	case int64:
		y, ok := b.(int64)
		if !ok {
			return 0, false
		}
		switch {
		case x < y:
			return -1, true
		case x > y:
			return 1, true
		}
		return 0, true
	case string:
		y, ok := b.(string)
		if !ok {
			return 0, false
		}
		return strings.Compare(x, y), true
	}
	return 0, false
}

func contains(list, x any) bool {
	l, ok := list.([]any)
	if !ok {
		return false
	}
	for _, e := range l {
		if deepEqual(e, x) {
			return true
		}
	}
	return false
}

func deepEqual(a, b any) bool {
	switch x := a.(type) {
	case nil:
		return b == nil
	case bool, int64, string:
		return a == b
	case []any:
		y, ok := b.([]any)
		if !ok || len(x) != len(y) {
			return false
		}
		for i := range x {
			if !deepEqual(x[i], y[i]) {
				return false
			}
		}
		return true
	case map[string]any:
		y, ok := b.(map[string]any)
		if !ok || len(x) != len(y) {
			return false
		}
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			yv, ok := y[k]
			if !ok || !deepEqual(x[k], yv) {
				return false
			}
		}
		return true
	}
	return false
}

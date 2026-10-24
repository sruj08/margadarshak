package rules

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"unicode/utf8"
)

// CanonicalJSON encodes v as canonical JSON: object keys sorted, no
// whitespace, integers only, and string escaping identical to JavaScript's
// JSON.stringify. The TS mirror (packages/rules/src/canon.ts) produces the
// same bytes, which is how Go/TS parity is proven on every golden case and
// how the pack hash is computed.
func CanonicalJSON(v any) ([]byte, error) {
	g, err := toGeneric(v)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := writeCanonical(&buf, g); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// toGeneric turns structs into map/slice/json.Number values.
func toGeneric(v any) (any, error) {
	switch v.(type) {
	case map[string]any, []any, string, bool, nil, json.Number, int64:
		return v, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var g any
	if err := dec.Decode(&g); err != nil {
		return nil, err
	}
	return g, nil
}

func writeCanonical(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if t {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case json.Number:
		n, err := strconv.ParseInt(string(t), 10, 64)
		if err != nil {
			return fmt.Errorf("canonical JSON allows integers only, got %s", string(t))
		}
		buf.WriteString(strconv.FormatInt(n, 10))
	case int64:
		buf.WriteString(strconv.FormatInt(t, 10))
	case int:
		buf.WriteString(strconv.Itoa(t))
	case string:
		writeJSString(buf, t)
	case []any:
		buf.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonical(buf, e); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			writeJSString(buf, k)
			buf.WriteByte(':')
			if err := writeCanonical(buf, t[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		g, err := toGeneric(v)
		if err != nil {
			return err
		}
		if fmt.Sprintf("%T", g) == fmt.Sprintf("%T", v) {
			return fmt.Errorf("canonical JSON: unsupported type %T", v)
		}
		return writeCanonical(buf, g)
	}
	return nil
}

const hexDigits = "0123456789abcdef"

func writeJSString(buf *bytes.Buffer, s string) {
	buf.WriteByte('"')
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		switch {
		case r == '"':
			buf.WriteString(`\"`)
		case r == '\\':
			buf.WriteString(`\\`)
		case r == '\b':
			buf.WriteString(`\b`)
		case r == '\f':
			buf.WriteString(`\f`)
		case r == '\n':
			buf.WriteString(`\n`)
		case r == '\r':
			buf.WriteString(`\r`)
		case r == '\t':
			buf.WriteString(`\t`)
		case r < 0x20:
			buf.WriteString(`\u00`)
			buf.WriteByte(hexDigits[r>>4])
			buf.WriteByte(hexDigits[r&0xf])
		default:
			buf.WriteString(s[i : i+size])
		}
		i += size
	}
	buf.WriteByte('"')
}
